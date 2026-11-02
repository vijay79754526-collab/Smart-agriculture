const $ = selector => document.querySelector(selector);

let token = sessionStorage.getItem("agri-token");
let currentUser = null;
let latestDiseaseResult = null;
let latestSoilGuidance = "";
let latestWeather = null;
let latestMarket = null;
let latestCropRecommendation = null;
let latestSearchHistory = [];
const themeToggle = $("#themeToggle");
const profileMenuToggle = $("#profileMenuToggle");
const profileMenu = $("#profileMenu");

try {
  currentUser = JSON.parse(sessionStorage.getItem("agri-user") || "null");
} catch {
  sessionStorage.removeItem("agri-token");
  sessionStorage.removeItem("agri-user");
}

if (!token || !currentUser) {
  window.location.replace("/login");
}

let stateDistrictMap = {};

async function loadStateDistrictData() {
  document.querySelectorAll(".state-select, .district-select").forEach(select => {
    select.disabled = true;
  });

  const response = await fetch("/data/india-states-districts.json");
  if (!response.ok) {
    throw new Error("Could not load the state and district list. Please refresh and try again.");
  }

  const records = await response.json();
  if (!Array.isArray(records) || records.length === 0 ||
      records.some(record => !record.name || !Array.isArray(record.districts))) {
    throw new Error("The state and district list is invalid.");
  }

  stateDistrictMap = Object.fromEntries(
    records.map(record => [
      record.name,
      record.districts.map(district => district.name)
    ])
  );
  populateLocationSelectors();
  document.querySelectorAll(".state-select, .district-select").forEach(select => {
    select.disabled = false;
  });
}

function populateLocationSelectors() {
  const stateSelects = document.querySelectorAll(".state-select");
  const stateNames = Object.keys(stateDistrictMap).sort();

  stateSelects.forEach(select => {
    stateNames.forEach(state => {
      let option = Array.from(select.options).find(entry => entry.value === state);
      if (!option) {
        option = document.createElement("option");
        option.value = state;
        select.appendChild(option);
      }
      option.textContent = window.agriI18n.translate(state);
    });
    select.dataset.ready = "true";
  });

  document.querySelectorAll(".district-select").forEach(districtSelect => {
    const stateSelect = districtSelect.closest("form")?.querySelector(".state-select");
    if (!stateSelect) return;

    const state = stateSelect.value;
    const selectedDistrict = districtSelect.value;
    populateDistrictSelector(districtSelect, state, selectedDistrict);
  });
}

document.addEventListener("change", event => {
  if (event.target.matches(".state-select")) {
    const form = event.target.closest("form");
    const districtSelect = form?.querySelector(".district-select");
    if (!districtSelect) return;

    populateDistrictSelector(districtSelect, event.target.value);
  }
});

function populateDistrictSelector(districtSelect, state, selectedDistrict = "") {
  districtSelect.replaceChildren(new Option(
    window.agriI18n.translate("Select district"), ""
  ));
  (stateDistrictMap[state] || []).forEach(district => {
    const option = document.createElement("option");
    option.value = district;
    option.textContent = window.agriI18n.translate(district);
    districtSelect.appendChild(option);
  });
  districtSelect.value = selectedDistrict;
}

function showMessage(selector, message) {
  const element = $(selector);
  element.dataset.translationSource = message;
  element.textContent = window.agriI18n.translate(message);
  if (element.id === "diseaseResult") {
    element.replaceChildren();
    const result = document.createElement("p");
    result.textContent = window.agriI18n.translate(message);
    element.appendChild(result);
    element.hidden = false;
    $(".disease-more").hidden = true;
  } else if (element.classList.contains("result-panel")) {
    element.hidden = false;
    element.classList.add("result-error");
  } else if (element.classList.contains("app-message")) {
    element.classList.add("visible");
  }
}

function clearResult(selector) {
  const element = $(selector);
  element.textContent = "";
  element.hidden = true;
  element.classList.remove("result-error");
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (token) headers.Authorization = `Bearer ${token}`;

  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

async function saveSearch(feature, query) {
  const featureLabels = {
    "crop-recommendations": "Crop Recommendations",
    "disease-guidance": "Disease Guidance",
    "soil-testing": "Soil Testing",
    "weather-management": "Weather",
    "market-prices": "Market Prices"
  };
  const state = query.state;
  const district = query.district;
  await api("/api/search-history", {
    method: "POST",
    body: JSON.stringify({
      feature,
      summary: [state, district].filter(Boolean).join(", ") || featureLabels[feature],
      query
    })
  });
}

async function recordSearch(feature, query) {
  try {
    await saveSearch(feature, query);
    if (window.location.pathname === "/feature/saved-searches") {
      await loadSearchHistory();
    }
  } catch (error) {
    console.error("Could not save search history:", error);
    showMessage("#appMessage", `${window.agriI18n.translate("Search could not be saved")}: ${error.message}`);
  }
}

function renderSearchHistory(entries) {
  latestSearchHistory = entries;
  const list = $("#savedSearchList");
  list.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.textContent = window.agriI18n.translate(
      "Your completed crop, disease, soil, weather, and market searches will appear here."
    );
    list.appendChild(empty);
    return;
  }

  const featureLabels = {
    "crop-recommendations": "Crop Recommendations",
    "disease-guidance": "Disease Guidance",
    "soil-testing": "Soil Testing",
    "weather-management": "Weather",
    "market-prices": "Market Prices"
  };
  entries.forEach(entry => {
    const item = document.createElement("li");
    const heading = document.createElement("strong");
    heading.textContent = window.agriI18n.translate(featureLabels[entry.feature] || entry.feature);
    item.appendChild(heading);

    const date = document.createElement("small");
    date.textContent = new Date(entry.createdAt).toLocaleString();
    item.appendChild(date);

    const searchDetails = Object.entries(entry.query || {}).map(([key, value]) => {
      const normalizedValue = key === "Symptom"
        ? ({ spots: "Spots", yellow: "Yellow", wilt: "Wilt", other: "Other" }[value] || value)
        : value;
      const translatedValue = normalizedValue === "Monsoon"
        ? window.agriI18n.translate("Rainy season (Monsoon)")
        : window.agriI18n.translate(String(normalizedValue));
      const label = window.agriI18n.translate(key);
      return `${label}: ${translatedValue}`;
    }).join(" · ");
    const details = document.createElement("p");
    details.textContent = searchDetails || entry.summary;
    item.appendChild(details);
    list.appendChild(item);
  });
}

async function loadSearchHistory() {
  renderSearchHistory(await api("/api/search-history"));
}

function renderDiseaseResult(result) {
  const container = $("#diseaseResult");
  container.replaceChildren();

  const guidance = document.createElement("p");
  guidance.textContent = window.agriI18n.translate(result.result);
  container.appendChild(guidance);

  const caution = document.createElement("small");
  caution.textContent = window.agriI18n.translate(result.note);
  container.appendChild(caution);
  container.hidden = false;
  $(".disease-more").hidden = false;
}

function renderWeatherResult(weather) {
  const translate = window.agriI18n.translate;
  const district = translate(weather.district);
  const location = `${district}, ${translate(weather.state)}`;

  const result = $("#weatherResult");
  result.classList.remove("result-error");
  result.hidden = false;
  result.textContent =
    `${location}: ${translate(weather.mode)}: ${translate("Temperature")} ${weather.temperatureC}°C, ${translate("humidity")} ${weather.humidityPercent}%, ${translate("rainfall")} ${weather.rainfallMm} mm. ${window.agriI18n.format("Weather is suitable for routine crop monitoring and careful irrigation planning in {district}.", { district })}`;
}

function renderMarketResult(market) {
  const translate = window.agriI18n.translate;
  const district = translate(market.district);
  const location = `${district}, ${translate(market.state)}`;
  const container = $("#marketResult");
  container.replaceChildren();
  container.classList.remove("result-error");
  container.hidden = false;

  const heading = document.createElement("p");
  heading.textContent = market.estimate
    ? `${location}: ${translate("Indicative estimated prices")}`
    : `${location}: ${translate("Latest official mandi prices")}`;
  container.appendChild(heading);

  const dateNote = document.createElement("p");
  dateNote.textContent = market.estimate
    ? translate("These are guessed India-wide planning estimates, not live or district-specific market prices. Confirm today's rate with your local mandi before buying or selling.")
    : market.arrivalDate
      ? `${translate("Arrival date")}: ${market.arrivalDate}. ${translate("Wholesale mandi reports may not be updated in real time.")}`
      : translate("No vegetable or flower prices were reported for this district.");
  container.appendChild(dateNote);

  if (!market.estimate) {
    const source = document.createElement("small");
    source.textContent = `${translate("Source")}: data.gov.in · ${translate("Current Daily Price of Various Commodities from Various Markets (Mandi)")}`;
    container.appendChild(source);
  }

  if (!market.prices.length) {
    return;
  }

  ["Vegetables", "Flowers"].forEach(category => {
    const rows = market.prices.filter(row => row.category === category);
    if (!rows.length) return;

    const subheading = document.createElement("h4");
    subheading.textContent = translate(category);
    container.appendChild(subheading);

    rows.forEach(row => {
      const item = document.createElement("p");
      const marketName = row.market.replace(/\b(Mandi|Market|Yard)\b/g, word => translate(word));
      const variety = row.variety ? ` · ${translate(row.variety)}` : "";
      const formatPrice = value => new Intl.NumberFormat("en-IN", {
        maximumFractionDigits: 2
      }).format(value);
      const unit = translate(row.unit || "per quintal");
      item.textContent =
        `${translate(row.crop)}${variety} — ${translate("Min")}: ₹${formatPrice(row.minPrice)} · ${translate("Max")}: ₹${formatPrice(row.maxPrice)} · ${translate("Modal")}: ₹${formatPrice(row.modalPrice)} ${unit}${market.estimate ? "" : ` (${marketName})`}`;
      container.appendChild(item);
    });
  });

}

function renderCropRecommendation(result) {
  const translate = window.agriI18n.translate;
  const translateSeason = season => translate(
    season === "Monsoon" ? "Rainy season (Monsoon)" : season
  );
  const container = $("#cropRecommendationResult");
  container.replaceChildren();
  container.hidden = false;
  container.classList.remove("result-error", "recommendation-good", "recommendation-caution");
  const bestScore = result.recommendations[0]?.score || 0;
  container.classList.add(bestScore >= 75 ? "recommendation-good" : "recommendation-caution");

  const heading = document.createElement("h4");
  heading.textContent = translate("Best crop matches for your conditions");
  container.appendChild(heading);

  const summary = document.createElement("p");
  summary.textContent = translate(
    bestScore >= 75
      ? "Crops below match most of the soil, season, and weather guide ranges."
      : "No strong match found. These are the closest crops; consider adjusting the season or checking soil conditions."
  );
  container.appendChild(summary);

  result.recommendations.forEach((recommendation, index) => {
    const card = document.createElement("article");
    card.className = "crop-recommendation-card";

    const cropHeading = document.createElement("h5");
    cropHeading.textContent =
      `${index + 1}. ${translate(recommendation.crop)} — ${recommendation.score}% ${translate("match")}`;
    card.appendChild(cropHeading);
    const matchingFactors = recommendation.factors.filter(factor => factor.suitable).length;
    const scoreSummary = document.createElement("p");
    scoreSummary.textContent = `${matchingFactors} / ${recommendation.factors.length} ${translate("conditions match")}`;
    card.appendChild(scoreSummary);

    const factorList = document.createElement("ul");
    factorList.className = "recommendation-factors";
    recommendation.factors.forEach(factor => {
      const item = document.createElement("li");
      const formatValue = value => {
        if (factor.key === "Season") return translateSeason(value);
        const unit = factor.key === "Soil pH" ? "" :
          factor.key === "Estimated temperature" ? "°C" :
            factor.key === "Estimated daily rainfall" ? ` ${translate("mm")}` : "%";
        return `${value}${unit}`;
      };
      const range = factor.range.map(formatValue).join("–");
      const value = formatValue(factor.value);
      item.textContent =
        `${translate(factor.key)}: ${value} — ${translate(factor.suitable ? "Within crop guide range" : "Outside crop guide range")} (${translate("Preferred range")}: ${range})`;
      factorList.appendChild(item);
    });
    card.appendChild(factorList);
    container.appendChild(card);
  });

  const weather = document.createElement("p");
  weather.textContent = window.agriI18n.format(
    "District weather estimate: {temperature}°C, humidity {humidity}%, rainfall {rainfall} mm. These weather estimates are included in the crop-match score.",
    {
      temperature: result.weather.temperatureC,
      humidity: result.weather.humidityPercent,
      rainfall: result.weather.rainfallMm
    }
  );
  container.appendChild(weather);

  const advisory = document.createElement("small");
  advisory.textContent = translate(result.advisory);
  container.appendChild(advisory);
}

async function loadDashboardSummary() {
  try {
    const summary = await api("/api/dashboard");
    $("#totalCrops").textContent = summary.totalCrops;
    $("#totalExpenses").textContent = `₹${Number(summary.totalExpenses || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
    $("#totalReadings").textContent = summary.totalReadings;
    $("#totalHealthScans").textContent = summary.totalHealthScans;
  } catch (error) {
    showMessage("#appMessage", error.message);
  }
}

function setTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("dark-theme", isDark);
  themeToggle.textContent = isDark ? "☀️" : "🌙";
  localStorage.setItem("agri-theme", theme);
}

const savedTheme = localStorage.getItem("agri-theme") || "light";
setTheme(savedTheme);

function showFeaturePage() {
  const featurePanels = document.querySelectorAll(".feature-panel");
  featurePanels.forEach(panel => {
    panel.hidden = true;
  });

  const featureId = window.location.pathname.match(/^\/feature\/([^/]+)$/)?.[1];
  if (!featureId) return;

  const targetPanel = document.querySelector(`.feature-panel[data-feature="${featureId}"]`);
  if (!targetPanel) {
    window.location.replace("/dashboard");
    return;
  }

  targetPanel.hidden = false;
  $("#overviewCards").hidden = true;
  $(".feature-dashboard-panel").hidden = true;
  $(".feature-page-heading").hidden = false;

  const heading = targetPanel.querySelector("h3").textContent.trim();
  const category = document.querySelector(`.feature-category[href="/feature/${featureId}"]`);
  const title = category?.textContent.trim() || heading.replace(/^[^ ]+ /, "");
  $(".dashboard-header .eyebrow").textContent = window.agriI18n.translate("Farm feature");
  $("#welcome").textContent = title;
  $(".dashboard-header .subheading").textContent =
    window.agriI18n.translate("Manage this area of your farm.");
  document.querySelector('.feature-category[href="/dashboard"]').classList.remove("active");
  document.querySelector(`.feature-category[href="/feature/${featureId}"]`)?.classList.add("active");
  document.title = `${title} · ${window.agriI18n.translate("Smart Agriculture")}`;

}

function renderFeatureSearchResults(query = "") {
  const results = $("#featureSearchResults");
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  results.replaceChildren();

  const matches = Array.from(document.querySelectorAll(".feature-category")).map(link => {
    const featureId = link.getAttribute("href").match(/^\/feature\/([^/]+)$/)?.[1];
    const panel = featureId
      ? document.querySelector(`.feature-panel[data-feature="${featureId}"]`)
      : null;
    const searchableText = `${link.textContent} ${panel?.textContent || ""}`.toLocaleLowerCase();
    return { href: link.getAttribute("href"), label: link.textContent.trim(), searchableText };
  }).filter(entry => terms.every(term => entry.searchableText.includes(term)));

  if (!matches.length) {
    const empty = document.createElement("li");
    empty.textContent = window.agriI18n.translate("No matching project features or categories found.");
    results.appendChild(empty);
    return;
  }

  matches.forEach(entry => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = entry.href;
    link.textContent = entry.label;
    item.appendChild(link);
    results.appendChild(item);
  });
}

const featureSearchPanel = $("#featureSearchPanel");
const featureSearchToggle = $("#featureSearchToggle");
const featureSearchInput = $("#featureSearchInput");

function setFeatureSearchOpen(open) {
  featureSearchPanel.hidden = !open;
  featureSearchToggle.setAttribute("aria-expanded", String(open));
  if (open) {
    renderFeatureSearchResults(featureSearchInput.value);
    featureSearchInput.focus();
  } else {
    featureSearchInput.value = "";
  }
}

featureSearchToggle.addEventListener("click", () => {
  setFeatureSearchOpen(featureSearchPanel.hidden);
});
featureSearchInput.addEventListener("input", () => {
  renderFeatureSearchResults(featureSearchInput.value);
});
featureSearchInput.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    setFeatureSearchOpen(false);
    featureSearchToggle.focus();
  }
});

themeToggle.addEventListener("click", () => {
  const nextTheme = document.body.classList.contains("dark-theme") ? "light" : "dark";
  setTheme(nextTheme);
});

function setProfileMenuMessage(message, isError = false) {
  const element = $("#profileMenuMessage");
  element.dataset.translationSource = message;
  element.textContent = window.agriI18n.translate(message);
  element.hidden = !message;
  element.classList.toggle("form-message-error", isError);
}

function renderProfileDetails(profile) {
  $("#profileAccountName").textContent = profile.name || "";
  $("#profileAccountEmail").textContent = profile.email || "";
  $("#profileAccountMobile").textContent = profile.mobileNumber || "";
  const form = $("#profileForm");
  form.elements.namedItem("name").value = profile.name || "";
  form.elements.namedItem("email").value = profile.email || "";
  form.elements.namedItem("mobileNumber").value = profile.mobileNumber || "";
}

function setProfileEditing(editing) {
  $("#profileForm").hidden = !editing;
  $(".profile-account-details").hidden = editing;
  $("#editProfileBtn").hidden = editing;
  if (editing) $("#profileForm").elements.namedItem("name").focus();
}

$("#editProfileBtn").addEventListener("click", () => {
  setProfileEditing(true);
  setProfileMenuMessage("");
});

$("#cancelProfileEditBtn").addEventListener("click", () => {
  renderProfileDetails(currentUser);
  setProfileEditing(false);
  setProfileMenuMessage("");
});

$("#profileForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.target);
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await api("/api/profile", {
      method: "PUT",
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        mobileNumber: form.get("mobileNumber")
      })
    });
    currentUser = result.user;
    token = result.token;
    sessionStorage.setItem("agri-user", JSON.stringify(currentUser));
    sessionStorage.setItem("agri-token", token);
    renderProfileDetails(currentUser);
    setProfileEditing(false);
    setProfileMenuMessage("Profile saved successfully.");
    $("#welcome").textContent = window.agriI18n.greeting(currentUser.name);
  } catch (error) {
    setProfileMenuMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

profileMenuToggle.addEventListener("click", async () => {
  const open = profileMenu.hidden;
  profileMenu.hidden = !open;
  profileMenuToggle.setAttribute("aria-expanded", String(open));
  if (!open) return;

  setProfileMenuMessage("");
  renderProfileDetails(currentUser);
  try {
    currentUser = await api("/api/profile");
    sessionStorage.setItem("agri-user", JSON.stringify(currentUser));
    renderProfileDetails(currentUser);
  } catch (error) {
    setProfileMenuMessage(error.message, true);
  }
});

document.addEventListener("click", event => {
  if (!profileMenu.closest(".profile-menu-wrap").contains(event.target)) {
    profileMenu.hidden = true;
    profileMenuToggle.setAttribute("aria-expanded", "false");
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !profileMenu.hidden) {
    profileMenu.hidden = true;
    profileMenuToggle.setAttribute("aria-expanded", "false");
    profileMenuToggle.focus();
  }
});

$("#profilePasswordForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.target);
  if (form.get("newPassword") !== form.get("confirmPassword")) {
    setProfileMenuMessage("New password and confirmation do not match.", true);
    return;
  }

  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await api("/api/profile/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: form.get("currentPassword"),
        newPassword: form.get("newPassword")
      })
    });
    event.target.reset();
    setProfileMenuMessage(result.message);
  } catch (error) {
    setProfileMenuMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("#logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem("agri-token");
  sessionStorage.removeItem("agri-user");
  window.location.replace("/login");
});

$("#clearSearchHistory").addEventListener("click", async () => {
  if (!window.confirm(window.agriI18n.translate("Clear all saved searches?"))) return;
  try {
    await api("/api/search-history", { method: "DELETE" });
    await loadSearchHistory();
  } catch (error) {
    showMessage("#appMessage", error.message);
  }
});

$("#cropForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.target);

  try {
    await api("/api/crops", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        area: Number(form.get("area")),
        category: form.get("category"),
        state: form.get("state"),
        district: form.get("district"),
        season: form.get("season")
      })
    });

    event.target.reset();
    populateLocationSelectors();
    await loadCrops();
    showMessage("#appMessage", "Crop added successfully.");
  } catch (error) {
    showMessage("#appMessage", error.message);
  }
});

async function loadCrops() {
  try {
    const crops = await api("/api/crops");
    const list = $("#cropList");
    list.replaceChildren();

    if (!crops.length) {
      const empty = document.createElement("li");
      empty.textContent = window.agriI18n.translate("No crops added yet. Add a crop to see it here.");
      list.appendChild(empty);
      return;
    }

    crops.forEach(crop => {
      const item = document.createElement("li");
      const translate = window.agriI18n.translate;
      const season = crop.season === "Kharif"
        ? translate("Rainy season (Monsoon)")
        : crop.season === "Rabi"
          ? translate("Winter")
          : translate(crop.season);
      item.textContent =
        `${translate(crop.name)} — ${translate(crop.category || "General")} — ${crop.area} ${translate("acres")} — ${season}`;
      list.appendChild(item);
    });
  } catch (error) {
    showMessage("#appMessage", error.message);
  }
}

$("#diseaseForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.target);
  $("#diseaseResult").hidden = true;
  $(".disease-more").hidden = true;

  try {
    const result = await api("/api/disease", {
      method: "POST",
      body: form
    });

    latestDiseaseResult = result;
    renderDiseaseResult(result);
    await recordSearch("disease-guidance", {
      Symptom: form.get("symptom"),
      State: form.get("state"),
      District: form.get("district")
    });
  } catch (error) {
    showMessage("#diseaseResult", error.message);
  }
});

$("#soilForm").addEventListener("submit", async event => {
  event.preventDefault();
  clearResult("#soilResult");
  const form = new FormData(event.target);

  const body = Object.fromEntries(form.entries());
  for (const key of Object.keys(body)) body[key] = Number(body[key]);

  try {
    const result = await api("/api/soil", {
      method: "POST",
      body: JSON.stringify(body)
    });

    latestSoilGuidance = result.guidance;
    $("#soilResult").textContent = window.agriI18n.translate(latestSoilGuidance);
    $("#soilResult").hidden = false;
    await recordSearch("soil-testing", {
      "Soil pH": Number(form.get("ph")),
      Nitrogen: Number(form.get("nitrogen")),
      Phosphorus: Number(form.get("phosphorus")),
      Potassium: Number(form.get("potassium")),
      "Soil moisture": Number(form.get("moisture")),
      State: form.get("state"),
      District: form.get("district")
    });
    event.target.reset();
  } catch (error) {
    showMessage("#soilResult", error.message);
  }
});

$("#cropRecommendationForm").addEventListener("submit", async event => {
  event.preventDefault();
  clearResult("#cropRecommendationResult");
  latestCropRecommendation = null;
  const form = new FormData(event.target);
  const state = form.get("state");
  const district = form.get("district");

  try {
    const weather = await api(
      `/api/weather?state=${encodeURIComponent(state)}&district=${encodeURIComponent(district)}`
    );
    const result = await api("/api/crop-recommendations", {
      method: "POST",
      body: JSON.stringify({
        season: form.get("season"),
        ph: Number(form.get("ph")),
        moisture: Number(form.get("moisture")),
        state,
        district,
        weather
      })
    });
    latestCropRecommendation = result;
    renderCropRecommendation(result);
    await recordSearch("crop-recommendations", {
      Season: form.get("season"),
      "Soil pH": Number(form.get("ph")),
      "Soil moisture": Number(form.get("moisture")),
      State: state,
      District: district
    });
  } catch (error) {
    showMessage("#cropRecommendationResult", error.message);
  }
});

$("#weatherForm").addEventListener("submit", async event => {
  event.preventDefault();
  clearResult("#weatherResult");
  const form = new FormData(event.target);
  const state = form.get("state");
  const district = form.get("district");

  try {
    const w = await api(`/api/weather?state=${encodeURIComponent(state)}&district=${encodeURIComponent(district)}`);
    latestWeather = { ...w, state, district };
    renderWeatherResult(latestWeather);
    await recordSearch("weather-management", { State: state, District: district });
  } catch (error) {
    showMessage("#weatherResult", error.message);
  }
});

$("#marketForm").addEventListener("submit", async event => {
  event.preventDefault();
  clearResult("#marketResult");
  const form = new FormData(event.target);
  const state = form.get("state");
  const district = form.get("district");

  try {
    const result = await api(`/api/market?state=${encodeURIComponent(state)}&district=${encodeURIComponent(district)}`);
    latestMarket = { ...result, state, district };
    renderMarketResult(latestMarket);
    await recordSearch("market-prices", { State: state, District: district });
  } catch (error) {
    showMessage("#marketResult", error.message);
  }
});

$("#expenseForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.target);

  try {
    await api("/api/expenses", {
      method: "POST",
      body: JSON.stringify({
        item: form.get("item"),
        category: form.get("category"),
        amount: Number(form.get("amount"))
      })
    });

    event.target.reset();
    await loadExpenses();
    showMessage("#appMessage", "Expense added successfully.");
  } catch (error) {
    showMessage("#appMessage", error.message);
  }
});

async function loadExpenses() {
  try {
    const expenses = await api("/api/expenses");
    const list = $("#expenseList");
    list.replaceChildren();

    if (!expenses.length) {
      const empty = document.createElement("li");
      empty.textContent = window.agriI18n.translate("No expenses recorded yet. Add an expense to see it here.");
      list.appendChild(empty);
      return;
    }

    expenses.forEach(expense => {
      const item = document.createElement("li");
      const translate = window.agriI18n.translate;
      item.textContent =
        `${expense.item} — ${translate(expense.category || "General")} — ₹${Number(expense.amount || 0).toFixed(2)}`;
      list.appendChild(item);
    });
  } catch (error) {
    showMessage("#appMessage", error.message);
  }
}

$("#feedbackForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.target);

  try {
    const result = await api("/api/feedback", {
      method: "POST",
      body: JSON.stringify({
        category: form.get("category"),
        rating: Number(form.get("rating")),
        message: form.get("message")
      })
    });

    event.target.reset();
    await loadFeedbacks();
    showMessage("#appMessage", result.message || "Feedback submitted successfully.");
  } catch (error) {
    showMessage("#appMessage", error.message);
  }
});

async function loadFeedbacks() {
  try {
    const feedbacks = await api("/api/feedback");
    const list = $("#feedbackList");
    list.replaceChildren();

    if (!feedbacks.length) {
      const empty = document.createElement("li");
      empty.textContent = window.agriI18n.translate(
        "No feedback yet. Share your experience to help improve the farm tools."
      );
      list.appendChild(empty);
      return;
    }

    feedbacks.forEach(entry => {
      const item = document.createElement("li");
      const stars = "★".repeat(Number(entry.rating || 0)) + "☆".repeat(Math.max(0, 5 - Number(entry.rating || 0)));
      item.textContent = `${window.agriI18n.translate(entry.category || "General")} — ${stars} — ${entry.message}`;
      list.appendChild(item);
    });
  } catch (error) {
    showMessage("#appMessage", error.message);
  }
}

if (token && currentUser) {
  window.agriI18n.applyLanguage();
  profileMenuToggle.hidden = false;
  $("#welcome").textContent = window.agriI18n.greeting(currentUser.name);
  showFeaturePage();
  loadStateDistrictData().catch(error => {
    console.error(error);
    showMessage("#appMessage", error.message);
  });
  loadCrops();
  loadExpenses();
  loadFeedbacks();
  loadDashboardSummary();
  if (window.location.pathname === "/feature/saved-searches") {
    loadSearchHistory().catch(error => {
      console.error(error);
      showMessage("#appMessage", error.message);
    });
  }
}

document.addEventListener("agri-language-change", () => {
  if (currentUser) {
    $("#welcome").textContent = window.agriI18n.greeting(currentUser.name);
    const message = $("#appMessage");
    if (message.classList.contains("visible")) {
      message.textContent = window.agriI18n.translate(message.dataset.translationSource || "");
    }
    ["#soilResult", "#weatherResult", "#marketResult", "#cropRecommendationResult"].forEach(selector => {
      const result = $(selector);
      if (!result.hidden && result.classList.contains("result-error")) {
        result.textContent = window.agriI18n.translate(result.dataset.translationSource || "");
      }
    });
    populateLocationSelectors();
    showFeaturePage();
    renderSearchHistory(latestSearchHistory);
    if (!featureSearchPanel.hidden) {
      renderFeatureSearchResults(featureSearchInput.value);
    }
    loadCrops();
    loadExpenses();
    loadFeedbacks();
    if (latestDiseaseResult) renderDiseaseResult(latestDiseaseResult);
    if (latestSoilGuidance) {
      $("#soilResult").textContent = window.agriI18n.translate(latestSoilGuidance);
      $("#soilResult").hidden = false;
    }
    if (latestWeather) renderWeatherResult(latestWeather);
    if (latestMarket) renderMarketResult(latestMarket);
    if (latestCropRecommendation) renderCropRecommendation(latestCropRecommendation);
  }
});