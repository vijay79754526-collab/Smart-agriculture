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
  if (currentUser) renderProfileDetails(currentUser);
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
  if (selector === "#appMessage" && /requested information was not found|not found|(?:http\s*)?404/i.test(message)) {
    console.warn("Dashboard request returned no matching resource:", message);
    element.hidden = false;
    element.textContent = "";
    element.dataset.translationSource = "";
    element.classList.remove("visible");
    element.classList.add("suppressed");
    return;
  }
  if (selector === "#appMessage") {
    element.hidden = false;
    element.classList.remove("suppressed");
  }
  element.dataset.translationSource = message;
  element.textContent = window.agriI18n.translate(message);
  if (element.id === "diseaseResult") {
    element.replaceChildren();
    const result = document.createElement("p");
    result.textContent = window.agriI18n.translate(message);
    element.appendChild(result);
    element.hidden = false;
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
    const message = response.status === 404
      ? "The requested information was not found."
      : `The request could not be completed (HTTP ${response.status}).`;
    throw new Error(data.error || message);
  }

  return data;
}

async function saveSearch(feature, query, result) {
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
      query,
      ...(result ? { result } : {})
    })
  });
}

async function recordSearch(feature, query, result) {
  try {
    await saveSearch(feature, query, result);
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
    if (entry.feature === "crop-recommendations" && entry.result) {
      const link = document.createElement("a");
      link.href = `/recommendation-results?id=${encodeURIComponent(entry.id)}`;
      link.textContent = "View saved recommendations";
      item.appendChild(link);
    }
    list.appendChild(item);
  });
}

async function loadSearchHistory() {
  renderSearchHistory(await api("/api/search-history"));
}

function renderDiseaseResult(result) {
  const container = $("#diseaseResult");
  container.replaceChildren();

  const heading = document.createElement("h4");
  heading.textContent = result.healthy ? "Healthy leaf detected" : result.diseaseName || "Disease result unavailable";
  container.appendChild(heading);
  if (result.crop) {
    const crop = document.createElement("p");
    crop.textContent = `Crop: ${result.crop}`;
    container.appendChild(crop);
  }
  const confidence = document.createElement("p");
  confidence.textContent = `Confidence: ${result.confidencePercent}%`;
  container.appendChild(confidence);
  const appendDetail = (label, value) => {
    const section = document.createElement("p");
    const items = Array.isArray(value) ? value : value ? [value] : [];
    const format = item => typeof item === "string" ? item :
      item.name || item.description || JSON.stringify(item);
    section.textContent = `${label}: ${items.length ? items.map(format).join("; ") : "Not provided by the diagnosis provider."}`;
    container.appendChild(section);
  };
  appendDetail("Symptoms", result.symptoms);
  appendDetail("Causes", result.causes);
  appendDetail("Prevention", result.prevention);
  appendDetail("Organic/biological treatments", result.organicTreatments);
  appendDetail("Chemical treatments", result.chemicalTreatments);
  if (result.alternativeDiagnoses?.length) {
    const alternatives = document.createElement("p");
    alternatives.textContent = `Other AI suggestions: ${result.alternativeDiagnoses
      .map(item => `${item.name} (${item.confidencePercent}%)`)
      .join("; ")}`;
    container.appendChild(alternatives);
  }
  const provider = document.createElement("small");
  provider.textContent = `Assessment provider: ${result.provider || "AI image assessment"}.`;
  container.appendChild(provider);
  const caution = document.createElement("small");
  caution.textContent = result.note;
  container.appendChild(caution);
  container.hidden = false;
}

function renderWeatherResult(weather) {
  const result = $("#weatherResult");
  result.classList.remove("result-error");
  result.hidden = false;
  result.replaceChildren();
  const current = document.createElement("p");
  current.textContent = `${weather.location} · ${weather.source} · ${weather.mode}: ${weather.temperatureC}°C, humidity ${weather.humidityPercent}%, precipitation ${weather.rainfallMm} mm, wind ${weather.windSpeedKmh} km/h.`;
  result.appendChild(current);
  weather.daily.forEach(day => {
    const forecast = document.createElement("p");
    forecast.textContent = `${day.date}: ${day.minTemperatureC}–${day.maxTemperatureC}°C · ${day.rainfallMm} mm rain · wind up to ${day.maxWindSpeedKmh} km/h`;
    result.appendChild(forecast);
  });
  if (weather.geocodingSource === "OpenStreetMap") {
    const attribution = document.createElement("small");
    attribution.append("District location data © ");
    const link = document.createElement("a");
    link.href = "https://www.openstreetmap.org/copyright";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "OpenStreetMap contributors";
    attribution.appendChild(link);
    result.appendChild(attribution);
  }
}

function renderMarketResult(market) {
  const container = $("#marketResult");
  container.replaceChildren();
  container.classList.remove("result-error");
  container.hidden = false;

  const heading = document.createElement("p");
  heading.textContent = `${market.crop || "Crop"} prices in ${market.district}, ${market.state} · ${
    market.status === "stale" ? "Last known official data" :
      market.status === "current" ? "Official market data" : "Official prices unavailable"
  }`;
  container.appendChild(heading);

  if (market.message) {
    const message = document.createElement("p");
    message.textContent = market.message;
    container.appendChild(message);
  }
  if (market.fetchedAt) {
    const fetched = new Date(market.fetchedAt);
    if (!Number.isNaN(fetched.getTime())) {
      const timestamp = document.createElement("small");
      timestamp.textContent = `Retrieved: ${fetched.toLocaleString()} · Latest reported arrival date: ${market.latestArrivalDate || "not provided"}`;
      container.appendChild(timestamp);
    }
  }
  const source = document.createElement("small");
  source.textContent = `Source: ${market.source || "data.gov.in AGMARKNET"} · Reported prices are ₹ per quintal. Market data may be delayed; compare arrival dates before trading.`;
  container.appendChild(source);

  const formatPrice = value => new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2
  }).format(value);
  const appendTable = (title, rows, columns) => {
    if (!rows || !rows.length) return;
    const subheading = document.createElement("h4");
    subheading.textContent = title;
    container.appendChild(subheading);
    const table = document.createElement("table");
    table.className = "market-price-table";
    const header = document.createElement("tr");
    columns.forEach(column => {
      const cell = document.createElement("th");
      cell.textContent = column.label;
      header.appendChild(cell);
    });
    table.appendChild(header);
    rows.forEach(row => {
      const tr = document.createElement("tr");
      columns.forEach(column => {
        const cell = document.createElement("td");
        const value = column.value(row);
        cell.textContent = column.price && Number.isFinite(value)
          ? `₹${formatPrice(value)}`
          : String(value ?? "—");
        tr.appendChild(cell);
      });
      table.appendChild(tr);
    });
    container.appendChild(table);
  };

  appendTable("Selected district markets", market.prices, [
    { label: "Market", value: row => row.market },
    { label: "Minimum", value: row => row.minPrice, price: true },
    { label: "Maximum", value: row => row.maxPrice, price: true },
    { label: "Modal", value: row => row.modalPrice, price: true },
    { label: "Arrival date", value: row => row.arrivalDate }
  ]);
  appendTable("State price comparison (distance and transport costs are not provided)", market.comparisons, [
    { label: "District", value: row => row.district },
    { label: "Market", value: row => row.market },
    { label: "Modal ₹/quintal", value: row => row.modalPrice, price: true },
    { label: "Arrival date", value: row => row.arrivalDate }
  ]);
  if (market.comparisons?.length) {
    const best = market.comparisons[0];
    const recommendation = document.createElement("p");
    recommendation.textContent =
      `Highest reported modal price in this state: ${best.market}, ${best.district} — ₹${formatPrice(best.modalPrice)}/quintal (${best.arrivalDate}). Distance and transport costs are unavailable; verify before traveling.`;
    container.appendChild(recommendation);
  }
  appendTable("90-day modal price trend for the selected district", market.trend, [
    { label: "Date", value: row => row.date },
    { label: "Average modal ₹/quintal", value: row => row.modalPrice, price: true }
  ]);
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
      ? "Top crops align with most available EcoCrop climate and soil ranges."
      : "These are the closest matches to the available EcoCrop ranges. Confirm locally before planting."
  );
  container.appendChild(summary);
  if (result.soilTest) {
    const submittedInputs = document.createElement("p");
    submittedInputs.textContent =
      `Entered for ${result.season}: soil texture ${result.soilTest.soilTexture}; N ${result.soilTest.nitrogen}, P ${result.soilTest.phosphorus}, K ${result.soilTest.potassium}. NPK and season are recorded but are not scored.`;
    container.appendChild(submittedInputs);
  }
  if (!result.recommendations.length) {
    const empty = document.createElement("p");
    empty.textContent = "No crops in the source dataset matched the submitted conditions.";
    container.appendChild(empty);
  }

  result.recommendations.forEach((recommendation, index) => {
    const card = document.createElement("article");
    card.className = "crop-recommendation-card";

    const cropHeading = document.createElement("h5");
    cropHeading.textContent =
      `${index + 1}. ${translate(recommendation.crop)} — ${recommendation.score}% ${translate("match")}`;
    card.appendChild(cropHeading);
    if (recommendation.commonNames?.length) {
      const commonNames = document.createElement("p");
      commonNames.textContent = `EcoCrop common names: ${recommendation.commonNames.join(", ")}`;
      card.appendChild(commonNames);
    }

    const factorList = document.createElement("ul");
    factorList.className = "recommendation-factors";
    recommendation.factors.forEach(factor => {
      const item = document.createElement("li");
      const formatValue = value => {
        if (factor.key === "Season") return translateSeason(value);
        const unit = factor.unit || (factor.key === "Soil pH" ? "" :
          factor.key === "Estimated temperature" ? "°C" :
            factor.key === "Estimated daily rainfall" ? ` ${translate("mm")}` : "%");
        return `${value}${unit}`;
      };
      const range = factor.range
        ? factor.range.map(formatValue).join("–")
        : "No crop-specific source range";
      const value = formatValue(factor.value);
      const fit = factor.suitable
        ? translate("Within optimal source range")
        : factor.tolerated
          ? translate("Within tolerated source range")
          : factor.range
            ? translate("Outside crop guide range")
            : "";
      item.textContent =
        `${translate(factor.key)}: ${value} — ${fit} (${translate("Preferred range")}: ${range})`;
      factorList.appendChild(item);
    });
    card.appendChild(factorList);
    if (recommendation.growingDurationDays) {
      const duration = document.createElement("p");
      duration.textContent = `Growing duration in EcoCrop: ${recommendation.growingDurationDays[0]}–${recommendation.growingDurationDays[1]} days`;
      card.appendChild(duration);
    }
    container.appendChild(card);
  });

  const weather = document.createElement("p");
  weather.textContent = window.agriI18n.format(
    Number.isFinite(result.weather.annualRainfallMm)
      ? "Observed weather: {temperature}°C, humidity {humidity}%, current precipitation {rainfall} mm. Annual observed rainfall: {annualRainfall} mm."
      : "Observed weather: {temperature}°C, humidity {humidity}%, current precipitation {rainfall} mm.",
    {
      temperature: result.weather.temperatureC,
      humidity: result.weather.humidityPercent,
      rainfall: result.weather.rainfallMm,
      annualRainfall: Number.isFinite(result.weather.annualRainfallMm)
        ? Math.round(result.weather.annualRainfallMm)
        : ""
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
    $("#totalIrrigationRecords").textContent = summary.totalIrrigationRecords;
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
  $("#resetDashboardBtn").hidden = Boolean(featureId);
  $("#featureBackLink").hidden = true;
  if (!featureId) return;

  const targetPanel = document.querySelector(`.feature-panel[data-feature="${featureId}"]`);
  if (!targetPanel) {
    window.location.replace("/dashboard");
    return;
  }

  targetPanel.hidden = false;
  $("#overviewCards").hidden = true;
  $("#firstLoginWelcome").hidden = true;
  $(".feature-dashboard-panel").hidden = true;
  $("#featureBackLink").hidden = false;

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
  $("#profileAccountLocation").textContent = profile.state && profile.district
    ? `${profile.district}, ${profile.state}`
    : "Not set";
  const form = $("#profileForm");
  form.elements.namedItem("name").value = profile.name || "";
  form.elements.namedItem("email").value = profile.email || "";
  form.elements.namedItem("mobileNumber").value = profile.mobileNumber || "";
  form.elements.namedItem("state").value = profile.state || "";
  populateDistrictSelector(
    form.elements.namedItem("district"),
    profile.state || "",
    profile.district || ""
  );
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
        mobileNumber: form.get("mobileNumber"),
        state: form.get("state"),
        district: form.get("district")
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
  latestDiseaseResult = null;
  clearResult("#diseaseResult");
  const button = event.target.querySelector('button[type="submit"], button:not([type])');
  const originalLabel = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Analyzing leaf image...";
  }

  try {
    const result = await api("/api/disease", {
      method: "POST",
      body: form
    });

    latestDiseaseResult = result;
    renderDiseaseResult(result);
    await recordSearch("disease-guidance", { Crop: form.get("crop") || "Not specified" }, result);
  } catch (error) {
    showMessage("#diseaseResult", error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
});

$("#soilForm").addEventListener("submit", async event => {
  event.preventDefault();
  clearResult("#soilResult");
  const form = new FormData(event.target);

  const body = Object.fromEntries(form.entries());
  ["ph", "nitrogen", "phosphorus", "potassium", "moisture"].forEach(key => {
    body[key] = Number(body[key]);
  });

  try {
    const result = await api("/api/soil", {
      method: "POST",
      body: JSON.stringify(body)
    });

    latestSoilGuidance = result.guidance;
    $("#soilResult").textContent = window.agriI18n.translate(latestSoilGuidance);
    $("#soilResult").hidden = false;
    await loadSoilTests();
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

async function loadSoilTests() {
  try {
    const records = await api("/api/soil");
    const list = $("#soilTestList");
    list.replaceChildren();
    if (!records.length) {
      const empty = document.createElement("li");
      empty.textContent = "No soil reports yet.";
      list.appendChild(empty);
      return;
    }

    records.forEach(record => {
      const item = document.createElement("li");
      item.textContent = `${record.state && record.district ? `${record.district}, ${record.state} · ` : ""}pH ${record.ph} · N ${record.nitrogen} · P ${record.phosphorus} · K ${record.potassium} · moisture ${record.moisture}% · ${new Date(record.createdAt).toLocaleString()}`;
      list.appendChild(item);
    });
  } catch (error) {
    showMessage("#appMessage", error.message);
  }
}

$("#cropRecommendationForm").addEventListener("submit", async event => {
  event.preventDefault();
  clearResult("#cropRecommendationResult");
  latestCropRecommendation = null;
  const form = new FormData(event.target);
  const state = form.get("state");
  const district = form.get("district");

  try {
    const result = await api("/api/crop-recommendations", {
      method: "POST",
      body: JSON.stringify({
        season: form.get("season"),
        ph: Number(form.get("ph")),
        nitrogen: Number(form.get("nitrogen")),
        phosphorus: Number(form.get("phosphorus")),
        potassium: Number(form.get("potassium")),
        soilType: form.get("soilType"),
        state,
        district
      })
    });
    latestCropRecommendation = result;
    renderCropRecommendation(result);
    await recordSearch("crop-recommendations", {
      Season: form.get("season"),
      "Soil pH": Number(form.get("ph")),
      Nitrogen: Number(form.get("nitrogen")),
      Phosphorus: Number(form.get("phosphorus")),
      Potassium: Number(form.get("potassium")),
      "Soil texture": form.get("soilType"),
      State: state,
      District: district
    }, result);
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
    await recordSearch("weather-management", { State: state, District: district }, latestWeather);
  } catch (error) {
    showMessage("#weatherResult", error.message);
  }
});

$("#marketForm").addEventListener("submit", async event => {
  event.preventDefault();
  clearResult("#marketResult");
  const form = new FormData(event.target);
  const crop = form.get("crop");
  const state = form.get("state");
  const district = form.get("district");

  try {
    const result = await api(`/api/market?crop=${encodeURIComponent(crop)}&state=${encodeURIComponent(state)}&district=${encodeURIComponent(district)}`);
    latestMarket = { ...result, crop, state, district };
    renderMarketResult(latestMarket);
    await recordSearch("market-prices", { Crop: crop, State: state, District: district }, latestMarket);
  } catch (error) {
    showMessage("#marketResult", "Market prices could not be loaded. Check your connection and try again. No sample prices are shown.");
  }
});

setInterval(async () => {
  const marketPanel = document.querySelector('.feature-panel[data-feature="market-prices"]');
  if (!latestMarket || !marketPanel || marketPanel.hidden || document.hidden) return;
  const { crop, state, district } = latestMarket;
  try {
    const result = await api(`/api/market?crop=${encodeURIComponent(crop)}&state=${encodeURIComponent(state)}&district=${encodeURIComponent(district)}`);
    latestMarket = { ...result, crop, state, district };
    renderMarketResult(latestMarket);
  } catch {
    showMessage("#marketResult", "Market prices could not be refreshed. The displayed government report is unchanged.");
  }
}, 15 * 60 * 1000);

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

$("#irrigationForm").addEventListener("submit", async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const button = formElement.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api("/api/irrigation", {
      method: "POST",
      body: JSON.stringify({
        crop: form.get("crop"),
        method: form.get("method"),
        amount: Number(form.get("amount")),
        unit: form.get("unit"),
        notes: form.get("notes")
      })
    });
    formElement.reset();
    await loadIrrigationRecords();
    showMessage("#appMessage", "Irrigation record saved.");
  } catch (error) {
    showMessage("#appMessage", error.message);
  } finally {
    button.disabled = false;
  }
});

async function loadIrrigationRecords() {
  try {
    const records = await api("/api/irrigation");
    const list = $("#irrigationList");
    list.replaceChildren();
    if (!records.length) {
      const empty = document.createElement("li");
      empty.textContent = "No irrigation records yet.";
      list.appendChild(empty);
      return;
    }

    records.forEach(record => {
      const item = document.createElement("li");
      const details = document.createElement("span");
      details.textContent = `${record.crop} · ${record.method} · ${record.amount} ${record.unit} · ${new Date(record.createdAt).toLocaleString()}`;
      item.appendChild(details);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary-btn";
      remove.textContent = "Delete";
      remove.setAttribute("aria-label", `Delete irrigation record for ${record.crop}`);
      remove.addEventListener("click", async () => {
        if (!window.confirm(`Delete the irrigation record for ${record.crop}?`)) return;
        try {
          await api(`/api/irrigation/${encodeURIComponent(record.id)}`, { method: "DELETE" });
          await loadIrrigationRecords();
          await loadDashboardSummary();
        } catch (error) {
          showMessage("#appMessage", error.message);
        }
      });
      item.appendChild(remove);
      list.appendChild(item);
    });
  } catch (error) {
    showMessage("#appMessage", error.message);
  }
}

$("#resetDashboardBtn").addEventListener("click", async () => {
  if (!window.confirm(
    "Archive all your current farm data and reset your dashboard? Your account and login will not be changed."
  )) return;
  const button = $("#resetDashboardBtn");
  button.disabled = true;
  try {
    const result = await api("/api/dashboard/reset", { method: "POST" });
    showMessage("#appMessage", result.message);
    await Promise.all([
      loadCrops(),
      loadExpenses(),
      loadFeedbacks(),
      loadIrrigationRecords(),
      loadSoilTests(),
      loadDashboardSummary()
    ]);
  } catch (error) {
    showMessage("#appMessage", error.message);
  } finally {
    button.disabled = false;
  }
});

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
  $("#appMessage").textContent = "";
  $("#appMessage").dataset.translationSource = "";
  $("#appMessage").hidden = false;
  $("#appMessage").classList.remove("suppressed", "visible");
  window.agriI18n.applyLanguage();
  profileMenuToggle.hidden = false;
  $("#welcome").textContent = window.agriI18n.greeting(currentUser.name);
  showFeaturePage();
  const dashboardParams = new URLSearchParams(window.location.search);
  $("#firstLoginWelcome").hidden = dashboardParams.get("welcome") !== "1";
  if (dashboardParams.get("login") === "success") {
    showMessage("#appMessage", "Login successful.");
  }
  loadStateDistrictData().catch(error => {
    console.error(error);
    showMessage("#appMessage", error.message);
  });
  loadCrops();
  loadExpenses();
  loadSoilTests();
  loadIrrigationRecords();
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