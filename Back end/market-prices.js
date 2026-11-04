const DATASET_ID = "9ef84268-d588-465a-a308-a864a43d0070";
const SOURCE_NAME = "data.gov.in — AGMARKNET daily mandi prices";
const CACHE_DURATION_MS = 5 * 60 * 1000;
const MAX_RECORDS = 1000;
const MAX_TREND_DAYS = 90;

const CROPS = [
  "Banana", "Brinjal", "Cotton", "Garlic", "Ginger", "Green Chilli",
  "Groundnut", "Maize", "Mustard", "Onion", "Paddy", "Potato", "Soyabean",
  "Tomato", "Turmeric", "Wheat"
];

const memoryCache = new Map();

function normalize(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function parsePrice(value) {
  const raw = String(value ?? "").replace(/,/g, "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseArrivalDate(value) {
  const raw = String(value || "").trim();
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const date = dmy
    ? new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])))
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeRecord(record) {
  const minPrice = parsePrice(record.Min_Price ?? record.min_price);
  const maxPrice = parsePrice(record.Max_Price ?? record.max_price);
  const modalPrice = parsePrice(record.Modal_Price ?? record.modal_price);
  const market = String(record.Market ?? record.market ?? "").trim();
  const crop = String(record.Commodity ?? record.commodity ?? "").trim();
  const state = String(record.State ?? record.state ?? "").trim();
  const district = String(record.District ?? record.district ?? "").trim();
  const arrivalDate = parseArrivalDate(record.Arrival_Date ?? record.arrival_date);

  if (!market || !crop || !state || !district || !arrivalDate ||
      minPrice === null || maxPrice === null || modalPrice === null) {
    return null;
  }

  return {
    crop,
    state,
    district,
    market,
    variety: String(record.Variety ?? record.variety ?? "").trim(),
    minPrice,
    maxPrice,
    modalPrice,
    unit: "₹/quintal",
    arrivalDate
  };
}

function newestPerMarket(records) {
  const latest = new Map();
  for (const record of records) {
    const key = `${normalize(record.district)}|${normalize(record.market)}`;
    const previous = latest.get(key);
    if (!previous || record.arrivalDate > previous.arrivalDate) {
      latest.set(key, record);
    }
  }
  return [...latest.values()];
}

function buildTrend(records, district) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - MAX_TREND_DAYS);
  const daily = new Map();

  for (const record of records) {
    if (normalize(record.district) !== normalize(district) ||
        new Date(`${record.arrivalDate}T00:00:00Z`) < cutoff) {
      continue;
    }
    const prices = daily.get(record.arrivalDate) || [];
    prices.push(record.modalPrice);
    daily.set(record.arrivalDate, prices);
  }

  return [...daily.entries()]
    .map(([date, prices]) => ({
      date,
      modalPrice: Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length * 100) / 100
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildReport(records, { crop, state, district }) {
  const latestByMarket = newestPerMarket(records);
  const districtPrices = latestByMarket
    .filter(record => normalize(record.district) === normalize(district))
    .sort((a, b) => a.market.localeCompare(b.market));
  const comparisons = [...latestByMarket]
    .sort((a, b) => b.modalPrice - a.modalPrice)
    .slice(0, 10);
  const trend = buildTrend(records, district);

  return {
    status: "current",
    source: SOURCE_NAME,
    datasetId: DATASET_ID,
    crop,
    state,
    district,
    fetchedAt: new Date().toISOString(),
    latestArrivalDate: records.reduce(
      (latest, record) => record.arrivalDate > latest ? record.arrivalDate : latest,
      ""
    ),
    prices: districtPrices,
    comparisons,
    trend,
    message: districtPrices.length
      ? ""
      : `No official ${crop} price observations were returned for ${district}, ${state}.`
  };
}

function snapshotKey({ crop, state, district }) {
  return [normalize(crop), normalize(state), normalize(district)].join("|");
}

function readSnapshot(db, key) {
  return (db.marketPriceSnapshots || []).find(snapshot => snapshot.key === key) || null;
}

function saveSnapshot(db, key, report, saveDB) {
  const snapshots = db.marketPriceSnapshots || [];
  const next = snapshots.filter(snapshot => snapshot.key !== key);
  next.push({ key, report });
  db.marketPriceSnapshots = next.slice(-500);
  saveDB(db);
}

function staleReport(snapshot, message) {
  return {
    ...snapshot.report,
    status: "stale",
    isStale: true,
    message: `${message} Showing the last successfully retrieved government data; check its arrival date before trading.`
  };
}

async function getMarketPriceReport({
  crop,
  state,
  district,
  apiKey,
  readDB,
  saveDB,
  fetchImpl = globalThis.fetch,
  now = Date.now()
}) {
  const selection = { crop: String(crop || "").trim(), state: String(state || "").trim(), district: String(district || "").trim() };
  if (!selection.crop || !selection.state || !selection.district) {
    return {
      status: "unavailable",
      source: SOURCE_NAME,
      prices: [],
      comparisons: [],
      trend: [],
      message: "Select a crop, state, and district to search official market data."
    };
  }

  const key = snapshotKey(selection);
  const cached = memoryCache.get(key);
  if (cached && now - cached.cachedAt < CACHE_DURATION_MS) {
    return cached.report;
  }

  const configuredApiKey = String(apiKey || "").trim();
  const db = readDB();
  const saved = readSnapshot(db, key);
  if (!configuredApiKey) {
    return saved
      ? staleReport(saved, "The data.gov.in API key is not configured.")
      : {
          status: "unavailable",
          source: SOURCE_NAME,
          crop: selection.crop,
          state: selection.state,
          district: selection.district,
          prices: [],
          comparisons: [],
          trend: [],
          message: "Live government prices are unavailable because DATA_GOV_IN_API_KEY is not configured. Set it in Back end/.env for local development or in the server environment, then restart the server. No estimated prices are shown."
        };
  }

  try {
    const url = new URL(`https://api.data.gov.in/resource/${DATASET_ID}`);
    url.searchParams.set("api-key", configuredApiKey);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", String(MAX_RECORDS));
    url.searchParams.set("sort[Arrival_Date]", "desc");
    url.searchParams.set("filters[State]", selection.state);
    url.searchParams.set("filters[Commodity]", selection.crop);

    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      throw new Error(`data.gov.in responded with HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.records)) {
      throw new Error("data.gov.in returned an invalid market-price response");
    }

    const records = payload.records
      .map(normalizeRecord)
      .filter(record =>
        record &&
        normalize(record.crop) === normalize(selection.crop) &&
        normalize(record.state) === normalize(selection.state)
      );
    if (records.length) {
      const report = buildReport(records, selection);
      memoryCache.set(key, { cachedAt: now, report });
      saveSnapshot(db, key, report, saveDB);
      return report;
    }

    return saved
      ? staleReport(saved, `No current ${selection.crop} observations were returned by data.gov.in.`)
      : {
          status: "unavailable",
          source: SOURCE_NAME,
          crop: selection.crop,
          state: selection.state,
          district: selection.district,
          prices: [],
          comparisons: [],
          trend: [],
          message: `No official ${selection.crop} price records were returned for ${selection.state}. No estimated prices are shown.`
        };
  } catch (error) {
    console.error(`data.gov.in market-price lookup failed for ${selection.crop}, ${selection.state}: ${error.message}`);
    return saved
      ? staleReport(saved, "The government market-price service could not be refreshed.")
      : {
          status: "unavailable",
          source: SOURCE_NAME,
          crop: selection.crop,
          state: selection.state,
          district: selection.district,
          prices: [],
          comparisons: [],
          trend: [],
          message: "The government market-price service could not be reached. No estimated prices are shown."
        };
  }
}

module.exports = {
  CROPS,
  DATASET_ID,
  buildReport,
  getMarketPriceReport,
  normalizeRecord,
  parseArrivalDate,
  parsePrice,
  snapshotKey
};
