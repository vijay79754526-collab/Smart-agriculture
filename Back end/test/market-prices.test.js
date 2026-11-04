const test = require("node:test");
const assert = require("node:assert/strict");
const marketPrices = require("../market-prices");

function fixtureRecords() {
  const today = new Date();
  const date = daysAgo => {
    const value = new Date(today);
    value.setUTCDate(value.getUTCDate() - daysAgo);
    return value.toISOString().slice(0, 10);
  };
  return [
    { Commodity: "Tomato", State: "Karnataka", District: "Mysuru", Market: "Mysuru APMC", Arrival_Date: date(0), Min_Price: "1000", Max_Price: "1800", Modal_Price: "1500" },
    { Commodity: "Tomato", State: "Karnataka", District: "Mysuru", Market: "Mysuru APMC", Arrival_Date: date(2), Min_Price: "900", Max_Price: "1700", Modal_Price: "1400" },
    { Commodity: "Tomato", State: "Karnataka", District: "Mandya", Market: "Mandya APMC", Arrival_Date: date(0), Min_Price: "1200", Max_Price: "2000", Modal_Price: "1700" },
    { Commodity: "Onion", State: "Karnataka", District: "Mysuru", Market: "Mysuru APMC", Arrival_Date: date(0), Min_Price: "800", Max_Price: "1600", Modal_Price: "1200" }
  ];
}

test("normalizes only valid government market observations", () => {
  const normalized = marketPrices.normalizeRecord(fixtureRecords()[0]);
  assert.equal(normalized.crop, "Tomato");
  assert.equal(normalized.minPrice, 1000);
  assert.equal(normalized.unit, "₹/quintal");
  assert.equal(marketPrices.normalizeRecord({
    Commodity: "Tomato", State: "Karnataka", District: "Mysuru",
    Market: "Mysuru APMC", Arrival_Date: "2025-01-01",
    Min_Price: "", Max_Price: "1000", Modal_Price: "800"
  }), null);
});

test("builds district prices, state market comparisons, and chronological price trends", () => {
  const records = fixtureRecords().map(marketPrices.normalizeRecord).filter(Boolean);
  const report = marketPrices.buildReport(records, {
    crop: "Tomato", state: "Karnataka", district: "Mysuru"
  });
  assert.equal(report.prices.length, 1);
  assert.equal(report.prices[0].modalPrice, 1500);
  assert.equal(report.comparisons[0].district, "Mandya");
  assert.equal(report.trend.length, 2);
  assert.ok(report.trend[0].date < report.trend[1].date);
});

test("does not fabricate prices when the API key is missing or the source fails", async () => {
  const db = { marketPriceSnapshots: [] };
  const readDB = () => db;
  const saveDB = next => Object.assign(db, next);
  const noKey = await marketPrices.getMarketPriceReport({
    crop: "Tomato", state: "Karnataka", district: "Mysuru",
    readDB, saveDB, apiKey: ""
  });
  assert.equal(noKey.status, "unavailable");
  assert.deepEqual(noKey.prices, []);
  assert.match(noKey.message, /No estimated prices/);

  const withKey = await marketPrices.getMarketPriceReport({
    crop: "Tomato", state: "Karnataka", district: "Mysuru",
    readDB, saveDB, apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ records: fixtureRecords() })
    }),
    now: Date.now() + 10 * 60 * 1000
  });
  assert.equal(withKey.status, "current");
  assert.equal(db.marketPriceSnapshots.length, 1);

  const failedRefresh = await marketPrices.getMarketPriceReport({
    crop: "Tomato", state: "Karnataka", district: "Mysuru",
    readDB, saveDB, apiKey: "test-key",
    fetchImpl: async () => ({ ok: false, status: 404 }),
    now: Date.now() + 20 * 60 * 1000
  });
  assert.equal(failedRefresh.status, "stale");
  assert.equal(failedRefresh.isStale, true);
  assert.equal(failedRefresh.prices[0].modalPrice, 1500);
});

test("returns an explicit no-data state for a successful empty API response", async () => {
  const result = await marketPrices.getMarketPriceReport({
    crop: "Tomato",
    state: "Karnataka",
    district: "Mysuru",
    apiKey: "test-key",
    readDB: () => ({ marketPriceSnapshots: [] }),
    saveDB: () => {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ records: [] }) }),
    now: Date.now() + 30 * 60 * 1000
  });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.comparisons, []);
  assert.match(result.message, /No official Tomato price records/);
});
