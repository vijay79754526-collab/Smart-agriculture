const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_FILE = path.join(__dirname, "agriculture-data", "EcoCrop_DB.csv");
const WEATHER_CACHE_MS = 10 * 60 * 1000;
const geocodeCache = new Map();
const weatherCache = new Map();
const climateCache = new Map();
let boundaryGeocodeQueue = Promise.resolve();
let lastBoundaryGeocodeAt = 0;
const districtAliases = {
  "Bengaluru Urban": ["Bengaluru", "Bangalore"],
  "Bengaluru Rural": ["Devanahalli"],
  Chikkaballapur: ["Chikkaballapura"],
  Davanagere: ["Davangere"],
  Chikkamagaluru: ["Chikmagalur"],
  Kalaburagi: ["Gulbarga"],
  Mysuru: ["Mysore"],
  Shivamogga: ["Shimoga"],
  Vijayapura: ["Bijapur"],
  Ballari: ["Bellary"],
  "Dakshina Kannada": ["Mangaluru", "Mangalore"],
  "Uttara Kannada": ["Karwar"],
  Vijayanagara: ["Hosapete", "Hospet"],
  Anantapur: ["Anantapuramu"],
  Gurugram: ["Gurgaon"],
  Prayagraj: ["Allahabad"],
  Ayodhya: ["Faizabad"],
  "Sri Potti Sriramulu Nellore": ["Nellore"],
  Sepahijala: ["Sipahijala"]
};
const stateAliases = new Map([
  ["orissa", "odisha"],
  ["uttaranchal", "uttarakhand"],
  ["nationalcapitalterritoryofdelhi", "delhi"],
  ["pondicherry", "puducherry"]
]);

function normalizePlace(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeDistrictName(value) {
  return normalizePlace(value).replace(/(district|zila)$/, "");
}
// Karnataka district headquarters fallback coordinates.
// Used when online district geocoding cannot find a match.

const karnatakaDistrictHeadquarters = new Map([
  ["Bagalkot", 16.1817, 75.6961],
  ["Ballari", 15.1394, 76.9214],
  ["Belagavi", 15.8497, 74.4977],
  ["Bengaluru Rural", 13.2472, 77.7139],
  ["Bengaluru Urban", 12.9716, 77.5946],
  ["Bidar", 17.9104, 77.5199],
  ["Chamarajanagar", 11.9261, 76.9437],
  ["Chikkaballapur", 13.4355, 77.7315],
  ["Chikkamagaluru", 13.3161, 75.7720],
  ["Chitradurga", 14.2251, 76.3980],
  ["Dakshina Kannada", 12.9141, 74.8560],
  ["Davanagere", 14.4644, 75.9218],
  ["Dharwad", 15.4589, 75.0078],
  ["Gadag", 15.4167, 75.6167],
  ["Hassan", 13.0068, 76.0996],
  ["Haveri", 14.7951, 75.3991],
  ["Kalaburagi", 17.3297, 76.8343],
  ["Kodagu", 12.4244, 75.7382],
  ["Kolar", 13.1367, 78.1292],
  ["Koppal", 15.3500, 76.1540],
  ["Mandya", 12.5218, 76.8951],
  ["Mysuru", 12.2958, 76.6394],
  ["Raichur", 16.2120, 77.3439],
  ["Ramanagara", 12.7150, 77.2810],
  ["Shivamogga", 13.9299, 75.5681],
  ["Tumakuru", 13.3409, 77.1010],
  ["Udupi", 13.3409, 74.7421],
  ["Uttara Kannada", 14.8136, 74.1297],
  ["Vijayapura", 16.8302, 75.7100],
  ["Yadgir", 16.7700, 77.1370],
  ["Vijayanagara", 15.2695, 76.3871]
].map(([name, latitude, longitude]) => [
  normalizeDistrictName(name),
  { latitude, longitude }
]));

function getKarnatakaDistrictFallback(state, district) {
  if (canonicalState(state) !== "karnataka") {
    return null;
  }

  const coordinates = karnatakaDistrictHeadquarters.get(
    normalizeDistrictName(district)
  );

  if (!coordinates) return null;

  return {
    ...coordinates,
    name: district,
    admin1: state,
    timezone: "Asia/Kolkata",
    geocodingSource: "Karnataka district headquarters fallback"
  };
}
function canonicalState(value) {
  const state = normalizePlace(value);
  return stateAliases.get(state) || state;
}

function getDistrictSearchNames(district) {
  const alias = Object.keys(districtAliases)
    .find(name => normalizePlace(name) === normalizePlace(district));
  return [...new Set([district, ...(alias ? districtAliases[alias] : [])])];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  const headers = rows.shift() || [];
  return rows
    .filter(values => values.length === headers.length)
    .map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
}

function numberOrNull(value) {
  const number = Number(value);
  return value && value !== "NA" && Number.isFinite(number) ? number : null;
}

const ecocropData = parseCsv(fs.readFileSync(DATA_FILE, "utf8"));

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`Agriculture data provider returned HTTP ${response.status}.`);
  }
  return response.json();
}

function fetchBoundarySearch(url) {
  const request = boundaryGeocodeQueue.then(async () => {
    const delay = Math.max(0, 1000 - (Date.now() - lastBoundaryGeocodeAt));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    lastBoundaryGeocodeAt = Date.now();
    const response = await fetch(url, {
      headers: { "User-Agent": "SmartAgricultureManagement/1.0 (district weather lookup)" },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      throw new Error(`District geocoding provider returned HTTP ${response.status}.`);
    }
    return response.json();
  });
  boundaryGeocodeQueue = request.then(() => undefined, () => undefined);
  return request;
}

async function findDistrictBoundary(state, district, searchNames) {
  for (const searchName of searchNames) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.search = new URLSearchParams({
      q: `${searchName}, ${state}, India`,
      format: "jsonv2",
      addressdetails: "1",
      limit: "5"
    }).toString();
    const data = await fetchBoundarySearch(url);
    const matches = data.filter(result => {
      if (!["administrative", "county"].includes(result.type)) return false;
      const address = result.address || {};
      if (canonicalState(address.state) !== canonicalState(state)) return false;
      return searchNames.some(name =>
        [address.state_district, address.county, result.name]
          .filter(Boolean)
          .some(candidate => normalizeDistrictName(candidate) === normalizeDistrictName(name))
      );
    });
    if (matches.length) {
      matches.sort((a, b) => {
        const districtName = result => normalizeDistrictName(result.address?.state_district);
        return Number(districtName(b) === normalizeDistrictName(district)) -
          Number(districtName(a) === normalizeDistrictName(district));
      });
      const result = matches[0];
      const latitude = Number(result.lat);
      const longitude = Number(result.lon);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return {
          latitude,
          longitude,
          name: district,
          admin1: state,
          timezone: "Asia/Kolkata",
          geocodingSource: "OpenStreetMap"
        };
      }
    }
  }
  return null;
}

async function getLocation(state, district) {
  const key = `${normalizePlace(district)}, ${canonicalState(state)}`;

  const cached = geocodeCache.get(key);
  if (cached) return cached;

  const searchNames = getDistrictSearchNames(district);
  let result = null;

  // First attempt: Open-Meteo geocoding
  for (const searchName of searchNames) {
    try {
      const url = new URL(
        "https://geocoding-api.open-meteo.com/v1/search"
      );

      url.search = new URLSearchParams({
        name: searchName,
        count: "10",
        language: "en",
        format: "json",
        countryCode: "IN"
      }).toString();

      const data = await fetchJson(url);

      const matches = (data.results || []).filter(location =>
        searchNames.some(name =>
          normalizePlace(location.name) === normalizePlace(name)
        ) &&
        canonicalState(location.admin1) === canonicalState(state)
      );

      if (matches.length) {
        result = matches.sort(
          (a, b) => Number(b.population || 0) -
                    Number(a.population || 0)
        )[0];
        break;
      }
    } catch (error) {
      console.warn(
        `Open-Meteo geocoding failed for ${searchName}:`,
        error.message
      );
    }
  }

  if (
    result &&
    Number.isFinite(result.latitude) &&
    Number.isFinite(result.longitude)
  ) {
    const location = {
      latitude: result.latitude,
      longitude: result.longitude,
      name: result.name,
      admin1: result.admin1 || state,
      timezone: result.timezone || "Asia/Kolkata",
      geocodingSource: "Open-Meteo"
    };

    geocodeCache.set(key, location);
    return location;
  }

  // Second attempt: OpenStreetMap district boundary
  try {
    const boundary = await findDistrictBoundary(
      state,
      district,
      searchNames
    );

    if (boundary) {
      geocodeCache.set(key, boundary);
      return boundary;
    }
  } catch (error) {
    console.warn(
      `Boundary lookup failed for ${district}:`,
      error.message
    );
  }

  // Third attempt: Karnataka headquarters coordinates
  const fallback = getKarnatakaDistrictFallback(
    state,
    district
  );

  if (fallback) {
    console.warn(
      `Using headquarters coordinates for ${district}, ${state}`
    );

    geocodeCache.set(key, fallback);
    return fallback;
  }

  throw new Error(
    `No weather location was found for ${district}, ${state}.`
  );
}

async function getWeather(state, district) {
  const cacheKey = `${normalizePlace(district)}, ${canonicalState(state)}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < WEATHER_CACHE_MS) return cached.value;

  const location = await getLocation(state, district);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max",
    forecast_days: "7",
    timezone: location.timezone
  }).toString();
  const data = await fetchJson(url);
  const currentValues = [
    data.current?.temperature_2m,
    data.current?.relative_humidity_2m,
    data.current?.precipitation,
    data.current?.wind_speed_10m
  ];
  if (!data.current || !data.daily || !Array.isArray(data.daily.time) ||
      currentValues.some(value => !Number.isFinite(value)) ||
      data.daily.time.length !== 7 ||
      data.daily.time.some((_, index) => [
        data.daily.temperature_2m_max[index],
        data.daily.temperature_2m_min[index],
        data.daily.precipitation_sum[index],
        data.daily.wind_speed_10m_max[index]
      ].some(value => !Number.isFinite(value)))) {
    throw new Error("The weather provider returned incomplete forecast data.");
  }

  const weather = {
    location: `${district}, ${state}`,
    source: "Open-Meteo",
    geocodingSource: location.geocodingSource,
    mode: "Live weather and 7-day forecast",
    temperatureC: data.current.temperature_2m,
    humidityPercent: data.current.relative_humidity_2m,
    rainfallMm: data.current.precipitation,
    windSpeedKmh: data.current.wind_speed_10m,
    daily: data.daily.time.map((date, index) => ({
      date,
      maxTemperatureC: data.daily.temperature_2m_max[index],
      minTemperatureC: data.daily.temperature_2m_min[index],
      rainfallMm: data.daily.precipitation_sum[index],
      maxWindSpeedKmh: data.daily.wind_speed_10m_max[index]
    })),
    message: `Live weather conditions for ${district}.`
  };
  weatherCache.set(cacheKey, { savedAt: Date.now(), value: weather });
  return weather;
}

async function getAnnualRainfall(weather) {
  const key = `${weather.location}:${new Date().toISOString().slice(0, 10)}`;
  const cached = climateCache.get(key);
  if (cached && Date.now() - cached.savedAt < WEATHER_CACHE_MS) return cached.value;

  const [district, state] = weather.location.split(",").map(value => value.trim());
  const location = await getLocation(state, district);
  const end = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - 364 * 24 * 60 * 60 * 1000);
  const formatDate = date => date.toISOString().slice(0, 10);
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    start_date: formatDate(start),
    end_date: formatDate(end),
    daily: "precipitation_sum",
    timezone: location.timezone
  }).toString();
  const data = await fetchJson(url);
  const values = data.daily?.precipitation_sum;
  if (!Array.isArray(values) || values.length < 350 ||
      values.some(rainfall => !Number.isFinite(rainfall))) {
    throw new Error("The weather provider returned no annual rainfall observations.");
  }
  const value = values.reduce((total, rainfall) => total + rainfall, 0);
  climateCache.set(key, { savedAt: Date.now(), value });
  return value;
}

function inRange(value, minimum, maximum) {
  return minimum !== null && maximum !== null && value >= minimum && value <= maximum;
}

function rangeFactor(key, value, optimalMin, optimalMax, toleratedMin, toleratedMax, unit = "") {
  const optimumKnown = optimalMin !== null && optimalMax !== null;
  const toleranceKnown = toleratedMin !== null && toleratedMax !== null;
  const suitable = optimumKnown
    ? inRange(value, optimalMin, optimalMax)
    : toleranceKnown && inRange(value, toleratedMin, toleratedMax);
  const tolerated = suitable || (toleranceKnown && inRange(value, toleratedMin, toleratedMax));
  return {
    key,
    value,
    unit,
    suitable: Boolean(suitable),
    tolerated: Boolean(tolerated && !suitable),
    scoreValue: suitable ? 1 : tolerated ? 0.5 : 0,
    range: optimumKnown ? [optimalMin, optimalMax] : toleranceKnown ? [toleratedMin, toleratedMax] : null,
    ...(optimumKnown && toleranceKnown ? { toleratedRange: [toleratedMin, toleratedMax] } : {}),
    evidence: tolerated ? "source-range" : "outside-source-range"
  };
}

function normalizeTexture(value) {
  return String(value || "")
    .toLowerCase()
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function recommendCrops(input, weather, annualRainfallMm) {
  const soilPH = Number(input.ph);
  const soilTexture = String(input.soilType || "").trim().toLowerCase();
  const temperature = Number(weather.temperatureC);
  const rainfall = Number(annualRainfallMm);

  const candidates = ecocropData.filter(crop =>
    String(crop.PLAT || "").toLowerCase().includes("grown on") &&
    (crop.COMNAME || crop.ScientificName)
  );
  const recommendations = candidates.map(crop => {
    const factors = [
      rangeFactor(
        "Soil pH",
        soilPH,
        numberOrNull(crop.PHOPMN),
        numberOrNull(crop.PHOPMX),
        numberOrNull(crop.PHMIN),
        numberOrNull(crop.PHMAX)
      ),
      rangeFactor(
        "Current temperature",
        temperature,
        numberOrNull(crop.TOPMN),
        numberOrNull(crop.TOPMX),
        numberOrNull(crop.TMIN),
        numberOrNull(crop.TMAX),
        "°C"
      ),
      rangeFactor(
        "Annual rainfall",
        rainfall,
        numberOrNull(crop.ROPMN),
        numberOrNull(crop.ROPMX),
        numberOrNull(crop.RMIN),
        numberOrNull(crop.RMAX),
        "mm"
      )
    ];
    if (soilTexture) {
      const optimalTextures = normalizeTexture(crop.TEXT);
      const toleratedTextures = normalizeTexture(crop.TEXTR);
      const optimalMatch = optimalTextures.includes(soilTexture);
      const toleratedMatch = toleratedTextures.includes(soilTexture);
      const suitable = optimalMatch || (!optimalTextures.length && toleratedMatch);
      const tolerated = toleratedMatch && !optimalMatch;
      factors.push({
        key: "Soil texture",
        value: soilTexture,
        suitable,
        tolerated,
        scoreValue: suitable ? 1 : tolerated ? 0.5 : 0,
        range: optimalTextures.length || toleratedTextures.length
          ? optimalTextures.length ? optimalTextures : toleratedTextures
          : null,
        ...(optimalTextures.length && toleratedTextures.length ? { toleratedRange: toleratedTextures } : {}),
        evidence: optimalMatch || toleratedMatch ? "source-range" : "outside-source-range"
      });
    }

    const scoredFactors = factors.filter(factor => factor.range);
    const score = scoredFactors.length
      ? Math.round(scoredFactors.reduce((sum, factor) => sum + factor.scoreValue, 0) / scoredFactors.length * 100)
      : 0;
    const commonNames = String(crop.COMNAME || "").split(",")
      .map(value => value.trim())
      .filter(value => value && value.length < 45)
      .slice(0, 5);
    const growingDaysMin = numberOrNull(crop.GMIN);
    const growingDaysMax = numberOrNull(crop.GMAX);
    return {
      crop: crop.ScientificName,
      commonNames,
      scientificName: crop.ScientificName,
      score,
      factors,
      annualRainfallRangeMm: [
        numberOrNull(crop.ROPMN),
        numberOrNull(crop.ROPMX)
      ],
      growingDurationDays: growingDaysMin !== null && growingDaysMax !== null
        ? [growingDaysMin, growingDaysMax]
        : null
    };
  }).filter(crop => crop.score > 0)
    .sort((a, b) => b.score - a.score || a.crop.localeCompare(b.crop))
    .slice(0, 5);

  return {
    season: input.season,
    state: input.state,
    district: input.district,
    soilTest: {
      ph: soilPH,
      soilTexture: soilTexture || null,
      nitrogen: Number(input.nitrogen),
      phosphorus: Number(input.phosphorus),
      potassium: Number(input.potassium)
    },
    recommendations,
    weather: {
      temperatureC: weather.temperatureC,
      humidityPercent: weather.humidityPercent,
      rainfallMm: weather.rainfallMm,
      annualRainfallMm
    },
    source: "OpenCLIM EcoCrop database",
    advisory: "Suitability is ranked against EcoCrop climate and soil pH/texture ranges and recent observed annual rainfall. The source does not include crop-specific NPK thresholds, planting calendars, relative humidity requirements, regional crop distributions, yield, or water-demand estimates; NPK, season, and humidity are not scored. Location is used to retrieve local weather, but not a regional crop calendar. Confirm locally with an agricultural extension officer."
  };
}

function getProviderDiseases(data) {
  const result = data.result || {};
  const health = result.is_healthy || {};
  const diseases = Array.isArray(result.disease?.suggestions)
    ? result.disease.suggestions
      .filter(suggestion => suggestion?.redundant !== true)
    : [];
  const probability = Number(health.probability);
  if (typeof health.binary !== "boolean" ||
      !Number.isFinite(probability) || probability < 0 || probability > 1) {
    const error = new Error("Plant disease provider returned an invalid health confidence.");
    error.status = 502;
    throw error;
  }
  return {
    healthy: health.binary,
    confidence: Math.round(probability * 100),
    diseases,
    plants: Array.isArray(result.classification?.suggestions)
      ? result.classification.suggestions
      : []
  };
}

async function detectDisease(imagePath, userId, crop) {
  const apiKey = String(process.env.PLANT_ID_API_KEY || "").trim();
  if (!apiKey) {
    const error = new Error(
      "AI disease detection is not configured. Set PLANT_ID_API_KEY in Back end/.env for local development or in the server environment, then restart the server."
    );
    error.status = 503;
    throw error;
  }

  const imageBase64 = fs.readFileSync(imagePath).toString("base64");
  const url = new URL("https://plant.id/api/v3/health_assessment");
  url.searchParams.set(
    "details",
    "local_name,description,url,treatment,classification,common_names,cause"
  );
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": apiKey
    },
    body: JSON.stringify({
      images: [imageBase64]
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? "Plant.id rejected the API key. Check PLANT_ID_API_KEY in the server environment."
      : response.status === 429
        ? "Plant.id has no available API credits. Add credits to the configured account to run a disease assessment; no diagnosis was made."
        : `Plant.id health assessment failed with HTTP ${response.status}.`;
    const error = new Error(message);
    error.status = 502;
    throw error;
  }
  const data = await response.json();
  if (!data.result || !data.result.is_healthy) {
    const error = new Error("Plant disease provider returned an unsupported response.");
    error.status = 502;
    throw error;
  }
  if (data.result.is_plant?.binary === false) {
    const error = new Error("The uploaded image does not appear to contain a plant leaf. Upload a clear crop-leaf photo and try again.");
    error.status = 422;
    throw error;
  }
  const assessment = getProviderDiseases(data);

  const disease = assessment.diseases[0];
  if (!assessment.healthy && !disease) {
    const error = new Error("The image could not be classified reliably. Upload a clear leaf photo and try again.");
    error.status = 422;
    throw error;
  }
  const details = disease?.details || {};
  const treatments = details.treatment || {};
  const diseaseName = assessment.healthy ? null :
    details.local_name ||
    details.common_names?.[0] ||
    disease?.name ||
    null;
  const diseaseProbability = Number(disease?.probability);
  if (!assessment.healthy && (!diseaseName ||
      !Number.isFinite(diseaseProbability) || diseaseProbability < 0 || diseaseProbability > 1)) {
    const error = new Error("Plant disease provider returned an invalid disease result.");
    error.status = 502;
    throw error;
  }
  const alternativeDiagnoses = assessment.diseases.slice(1, 4)
    .filter(candidate =>
      typeof candidate.name === "string" &&
      Number.isFinite(Number(candidate.probability)) &&
      Number(candidate.probability) >= 0 &&
      Number(candidate.probability) <= 1
    )
    .map(candidate => ({
      name: candidate.details?.local_name ||
        candidate.details?.common_names?.[0] ||
        candidate.name,
      confidencePercent: Math.round(Number(candidate.probability) * 100)
    }));
  const result = {
    crop: crop || assessment.plants[0]?.name || null,
    healthy: assessment.healthy,
    diseaseName,
    confidencePercent: assessment.healthy
      ? assessment.confidence
      : Math.round(diseaseProbability * 100),
    alternativeDiagnoses,
    symptoms: details.description || null,
    causes: details.cause || null,
    prevention: treatments.prevention || [],
    organicTreatments: treatments.biological || [],
    chemicalTreatments: treatments.chemical || [],
    provider: "Plant.id (Kindwise) v3",
    note: "AI image assessment; symptoms can resemble other problems. Follow local label directions for any pesticide and confirm uncertain results with an agricultural expert."
  };
  return {
    result,
    scan: {
      id: crypto.randomUUID(),
      userId,
      result: result.healthy ? "Healthy leaf" : result.diseaseName,
      ...result,
      date: new Date().toISOString()
    }
  };
}

function buildWeatherAlerts(weather) {
  const alerts = [];
  const today = weather.daily[0]?.date;
  const next24Hours = weather.daily.slice(0, 2);
  const next7DaysRainfall = weather.daily.reduce((sum, day) => sum + (Number(day.rainfallMm) || 0), 0);
  const maxHumidity = Number(weather.humidityPercent);
  const maxTemperature = Math.max(...weather.daily.map(day => Number(day.maxTemperatureC)).filter(Number.isFinite));
  const maxWind = Math.max(Number(weather.windSpeedKmh), ...weather.daily.map(day => Number(day.maxWindSpeedKmh)).filter(Number.isFinite));

  const add = (type, title, message) => alerts.push({
    type,
    title,
    message,
    forecastDate: today,
    fingerprint: `${type}:${today}`
  });
  if (next24Hours.some(day => Number(day.rainfallMm) >= 50)) {
    add("heavy-rain", "Heavy rain expected", `Forecast rainfall is at least 50 mm in a day near ${weather.location}.`);
  }
  if (maxTemperature >= 40) {
    add("high-temperature", "High temperature alert", `Forecast temperature may reach ${Math.round(maxTemperature)}°C near ${weather.location}.`);
  }
  if (next7DaysRainfall < 5) {
    add("low-rainfall", "Low rainfall outlook", `Only ${next7DaysRainfall.toFixed(1)} mm of rain is forecast over the next 7 days near ${weather.location}.`);
  }
  const currentTemperature = Number(weather.temperatureC);
  if (maxHumidity >= 85 && currentTemperature >= 18 && currentTemperature <= 35) {
    add("disease-risk", "Crop disease-favorable weather", `High humidity (${Math.round(maxHumidity)}%) and warm temperatures may increase disease pressure near ${weather.location}. Inspect crops; this is not a disease diagnosis.`);
  }
  if (maxWind >= 40) {
    add("high-wind", "Strong wind alert", `Wind may reach ${Math.round(maxWind)} km/h near ${weather.location}.`);
  }
  return alerts;
}

function persistWeatherAlerts(user, weather, readDB, saveDB) {
  const db = readDB();
  db.weatherAlerts = db.weatherAlerts || [];
  const existing = new Set(db.weatherAlerts
    .filter(alert => String(alert.userId) === String(user.id))
    .map(alert => alert.fingerprint));
  const newAlerts = buildWeatherAlerts(weather)
    .filter(alert => !existing.has(alert.fingerprint))
    .map(alert => ({
      id: crypto.randomUUID(),
      userId: user.id,
      ...alert,
      createdAt: new Date().toISOString(),
      readAt: null
    }));
  if (newAlerts.length) {
    db.weatherAlerts.push(...newAlerts);
    saveDB(db);
  }
  return newAlerts;
}

module.exports = {
  getWeather,
  getAnnualRainfall,
  recommendCrops,
  detectDisease,
  persistWeatherAlerts,
  buildWeatherAlerts
};
