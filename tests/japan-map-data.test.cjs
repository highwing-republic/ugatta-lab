const test = require("node:test");
const assert = require("node:assert/strict");

global.window = {};
require("../js/japan-map-data.js");
const map = window.HotelPriceJapanMap;

test("japan map data carries a projection and drawable paths", () => {
  assert.ok(map.width > 400 && map.height > 400);
  assert.deepEqual(Object.keys(map.projection).sort(), ["latMax", "lonMin", "lonScale", "unit"]);
  for (const path of [map.land, map.borders, map.inset.land]) assert.match(path, /^M[\d. LZM]+$/);
  assert.match(map.source, /Natural Earth/);
});

test("every observed market falls on the drawn map area", () => {
  // Keep in sync with MARKET_LOCATIONS in js/hotel-price-trends.js.
  const markets = [
    [42.49, 141.15], [35.10, 139.07], [36.35, 138.60], [36.70, 137.86], [36.30, 136.33],
    [35.81, 137.24], [34.45, 136.85], [33.28, 131.49], [31.87, 130.85],
    [42.97, 141.17], [38.22, 140.66], [36.62, 138.60], [36.14, 137.25], [36.05, 138.12],
    [35.23, 139.11], [35.63, 134.81], [35.42, 133.01], [34.80, 135.25], [33.85, 132.79],
    [33.26, 131.36], [32.74, 130.26], [31.24, 130.64], [30.35, 130.52]
  ];
  assert.equal(markets.length, 23);
  const {lonMin, latMax, lonScale, unit} = map.projection;
  const [ix, iy, iw, ih] = map.inset.box;
  for (const [lat, lon] of markets) {
    const x = (lon - lonMin) * lonScale * unit, y = (latMax - lat) * unit;
    assert.ok(x > 0 && x < map.width && y > 0 && y < map.height, `${lat},${lon}`);
    assert.ok(!(x >= ix && x <= ix + iw && y >= iy && y <= iy + ih), `market under inset: ${lat},${lon}`);
  }
});
