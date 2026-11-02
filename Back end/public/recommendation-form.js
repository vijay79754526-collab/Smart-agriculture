const token = sessionStorage.getItem("agri-token");

if (!token || !sessionStorage.getItem("agri-user")) {
  window.location.replace("/login");
}

const form = document.querySelector("#recommendationForm");
const message = document.querySelector("#formMessage");
const stateSelect = form.elements.namedItem("state");
const districtSelect = form.elements.namedItem("district");
let districtsByState = {};

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not complete the request.");
  return data;
}

function updateDistricts(state, selected = "") {
  districtSelect.replaceChildren(new Option("Select district", ""));
  const districts = districtsByState[state] || [];
  districts.forEach(district => {
    districtSelect.add(new Option(district.name, district.name));
  });
  districtSelect.value = selected;
  districtSelect.disabled = districts.length === 0;
}

async function loadLocations() {
  const response = await fetch("/data/india-states-districts.json");
  if (!response.ok) throw new Error("Could not load the state and district list.");
  const records = await response.json();
  if (!Array.isArray(records) || !records.length ||
      records.some(record => !record.name || !Array.isArray(record.districts))) {
    throw new Error("The state and district list is invalid.");
  }
  records.sort((a, b) => a.name.localeCompare(b.name));
  districtsByState = Object.fromEntries(records.map(record => [record.name, record.districts]));
  records.forEach(record => stateSelect.add(new Option(record.name, record.name)));
  stateSelect.disabled = false;
}

stateSelect.addEventListener("change", () => updateDistricts(stateSelect.value));

form.addEventListener("submit", async event => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(form).entries());
  button.disabled = true;
  message.textContent = "";

  try {
    const query = {
      "Soil type": values.soilType,
      "Soil pH": Number(values.ph),
      "Soil moisture": Number(values.moisture),
      Season: values.season,
      State: values.state,
      District: values.district,
      Temperature: Number(values.temperatureC),
      Humidity: Number(values.humidityPercent),
      "Daily rainfall": Number(values.rainfallMm)
    };
    const result = await api("/api/crop-recommendations", {
      method: "POST",
      body: JSON.stringify({
        soilType: values.soilType,
        ph: Number(values.ph),
        moisture: Number(values.moisture),
        season: values.season,
        state: values.state,
        district: values.district,
        weather: {
          temperatureC: Number(values.temperatureC),
          humidityPercent: Number(values.humidityPercent),
          rainfallMm: Number(values.rainfallMm)
        }
      })
    });
    const saved = await api("/api/search-history", {
      method: "POST",
      body: JSON.stringify({
        feature: "crop-recommendations",
        summary: `${values.district}, ${values.state}`,
        query,
        result
      })
    });
    window.location.assign(`/recommendation-results?id=${encodeURIComponent(saved.id)}`);
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("form-message-error");
  } finally {
    button.disabled = false;
  }
});

loadLocations().catch(error => {
  message.textContent = error.message;
  message.classList.add("form-message-error");
});
