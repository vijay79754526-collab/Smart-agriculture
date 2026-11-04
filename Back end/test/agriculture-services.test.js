const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildWeatherAlerts,
  detectDisease,
  persistWeatherAlerts,
  recommendCrops
} = require("../agriculture-services");

function weatherFixture() {
  return {
    location: "Bengaluru, Karnataka",
    temperatureC: 29,
    humidityPercent: 90,
    rainfallMm: 0,
    windSpeedKmh: 45,
    daily: Array.from({ length: 7 }, (_, index) => ({
      date: new Date(Date.now() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      maxTemperatureC: index === 0 ? 41 : 30,
      minTemperatureC: 20,
      rainfallMm: index === 0 ? 55 : 0,
      maxWindSpeedKmh: index === 0 ? 45 : 20
    }))
  };
}

test("EcoCrop recommendations use sourced climate and soil ranges", () => {
  const input = {
    season: "Monsoon",
    state: "Karnataka",
    district: "Bengaluru",
    ph: 6.5,
    nitrogen: 100,
    phosphorus: 50,
    potassium: 120,
    soilType: "medium"
  };
  const result = recommendCrops(input, weatherFixture(), 900);

  assert.equal(result.source, "OpenCLIM EcoCrop database");
  assert.equal(result.recommendations.length, 5);
  assert.ok(result.recommendations[0].scientificName);
  assert.ok(result.recommendations[0].factors.some(factor => factor.key === "Soil pH"));
  assert.match(result.advisory, /NPK.*not scored/);
  assert.equal(result.soilTest.nitrogen, 100);
});

test("NPK is retained as context but does not change unsupported suitability scores", () => {
  const input = {
    season: "Winter",
    state: "Karnataka",
    district: "Bengaluru",
    ph: 6.5,
    nitrogen: 1,
    phosphorus: 2,
    potassium: 3,
    soilType: "medium"
  };
  const weather = weatherFixture();
  const first = recommendCrops(input, weather, 900);
  const second = recommendCrops({
    ...input,
    nitrogen: 100000,
    phosphorus: 200000,
    potassium: 300000
  }, weather, 900);

  assert.deepEqual(
    first.recommendations.map(crop => [crop.scientificName, crop.score]),
    second.recommendations.map(crop => [crop.scientificName, crop.score])
  );
});

test("weather alerts cover rain, heat, drought outlook, disease risk, and wind", () => {
  const wetTypes = buildWeatherAlerts(weatherFixture()).map(alert => alert.type);
  assert.deepEqual(wetTypes.sort(), [
    "disease-risk", "heavy-rain", "high-temperature", "high-wind"
  ]);
  const dryWeather = weatherFixture();
  dryWeather.daily.forEach(day => { day.rainfallMm = 0; });
  assert.ok(buildWeatherAlerts(dryWeather).some(alert => alert.type === "low-rainfall"));
});

test("weather alert records are deduplicated for a user and forecast date", () => {
  let saved = { weatherAlerts: [] };
  const readDB = () => structuredClone(saved);
  const saveDB = db => { saved = db; };
  const user = { id: "user-1" };
  const weather = weatherFixture();

  const first = persistWeatherAlerts(user, weather, readDB, saveDB);
  const second = persistWeatherAlerts(user, weather, readDB, saveDB);

  assert.equal(first.length, 4);
  assert.equal(second.length, 0);
  assert.equal(saved.weatherAlerts.length, 4);
});

test("disease detection fails explicitly when the provider key is missing", async () => {
  const originalKey = process.env.PLANT_ID_API_KEY;
  delete process.env.PLANT_ID_API_KEY;
  try {
    await assert.rejects(
      detectDisease("unused-image.jpg", "user-1", ""),
      error => error.status === 503 && /PLANT_ID_API_KEY/.test(error.message)
    );
  } finally {
    if (originalKey === undefined) delete process.env.PLANT_ID_API_KEY;
    else process.env.PLANT_ID_API_KEY = originalKey;
  }
});

test("disease provider responses preserve disease and healthy-leaf details", async () => {
  const originalKey = process.env.PLANT_ID_API_KEY;
  const originalFetch = global.fetch;
  const imageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agri-disease-test-"));
  const firstImage = path.join(imageDirectory, "tomato-leaf.jpg");
  const secondImage = path.join(imageDirectory, "potato-leaf.jpg");
  const healthyImage = path.join(imageDirectory, "healthy-leaf.jpg");
  fs.writeFileSync(firstImage, "tomato leaf image");
  fs.writeFileSync(secondImage, "potato leaf image");
  fs.writeFileSync(healthyImage, "healthy leaf image");
  process.env.PLANT_ID_API_KEY = "test-provider-key";
  let requestCount = 0;
  const tomatoResult = {
    result: {
      is_healthy: { binary: false, probability: 0.8 },
      classification: {
        suggestions: [{ name: "Tomato", probability: 0.91 }]
      },
      disease: {
        suggestions: [{
          name: "leaf spot",
          probability: 0.75,
          details: {
            local_name: "Tomato leaf spot",
            description: "Dark lesions on leaves",
            cause: "Fungal pathogen",
            treatment: {
              biological: ["Remove affected leaves"],
              chemical: ["Use a locally approved fungicide"],
              prevention: ["Use disease-free seed", "Avoid overhead irrigation"]
            }
          }
        }, {
          name: "bacterial spot",
          probability: 0.18,
          details: { local_name: "Bacterial spot" }
        }]
      }
    }
  };
  const potatoResult = {
    result: {
      is_healthy: { binary: false, probability: 0.2 },
      disease: {
        suggestions: [{
          name: "early blight",
          probability: 0.84,
          details: {
            description: "Brown concentric lesions on lower leaves",
            cause: "Alternaria solani",
            treatment: {
              biological: ["Remove infected plant debris"],
              prevention: ["Rotate crops for at least three years"]
            }
          }
        }]
      }
    }
  };
  const healthyResult = {
    result: {
      is_healthy: { binary: true, probability: 0.9 },
      disease: { suggestions: [] }
    }
  };
  global.fetch = async (url, options) => {
    assert.match(String(url), /plant\.id\/api\/v3\/health_assessment/);
    assert.match(String(url), /details=.*treatment/);
    assert.equal(options.headers["Api-Key"], "test-provider-key");
    const image = JSON.parse(options.body).images[0];
    assert.ok(image);
    requestCount += 1;
    const providerResult = image === Buffer.from("tomato leaf image").toString("base64")
      ? tomatoResult
      : image === Buffer.from("potato leaf image").toString("base64")
        ? potatoResult
        : healthyResult;
    return { ok: true, json: async () => providerResult };
  };
  try {
    const disease = await detectDisease(firstImage, "user-1", "tomato");
    assert.equal(disease.result.diseaseName, "Tomato leaf spot");
    assert.equal(disease.result.confidencePercent, 75);
    assert.equal(disease.result.causes, "Fungal pathogen");
    assert.deepEqual(disease.result.organicTreatments, ["Remove affected leaves"]);
    assert.deepEqual(disease.result.prevention, ["Use disease-free seed", "Avoid overhead irrigation"]);
    assert.deepEqual(disease.result.alternativeDiagnoses, [
      { name: "Bacterial spot", confidencePercent: 18 }
    ]);
    assert.equal(disease.result.provider, "Plant.id (Kindwise) v3");

    const differentDisease = await detectDisease(secondImage, "user-1", "potato");
    assert.equal(differentDisease.result.diseaseName, "early blight");
    assert.equal(differentDisease.result.confidencePercent, 84);
    assert.equal(differentDisease.result.crop, "potato");
    assert.deepEqual(differentDisease.result.prevention, ["Rotate crops for at least three years"]);

    const healthy = await detectDisease(healthyImage, "user-1", "");
    assert.equal(healthy.result.healthy, true);
    assert.equal(healthy.result.confidencePercent, 90);
    assert.equal(healthy.result.diseaseName, null);
    assert.equal(requestCount, 3);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(imageDirectory, { recursive: true, force: true });
    if (originalKey === undefined) delete process.env.PLANT_ID_API_KEY;
    else process.env.PLANT_ID_API_KEY = originalKey;
  }
});
