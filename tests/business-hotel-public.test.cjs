const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {build} = require("../scripts/build_business_hotel_public.cjs");

const DATA = path.join(__dirname, "..", "data", "business-hotel-price-trends");

test("公開ファイル: 非公開の日別料金から今朝の取得と集計だけを書き、60日より前の取得は集計に使わない", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bht-public-"));
  const raw = path.join(tmp, "raw");
  const data = path.join(tmp, "data");
  fs.mkdirSync(raw);
  fs.mkdirSync(data);
  fs.copyFileSync(path.join(DATA, "cohort.json"), path.join(data, "cohort.json"));
  const latest = JSON.parse(fs.readFileSync(path.join(DATA, "latest.json"), "utf8"));
  const write = (date) => fs.writeFileSync(path.join(raw, `${date}.json`), JSON.stringify({...latest, snapshot_date: date}));
  ["2026-08-01", "2026-09-30", latest.snapshot_date].forEach(write);

  const {manifest, history} = build({rawDir: raw, dataDir: data});
  assert.deepEqual(fs.readdirSync(data).sort(), ["cohort.json", "history.json", "latest.json", "manifest.json"]);
  assert.equal(manifest.latest_file, "latest.json");
  assert.equal(manifest.latest_snapshot, latest.snapshot_date);
  assert.ok(!("snapshots" in manifest));
  assert.deepEqual(history.snapshots, ["2026-09-30", latest.snapshot_date]);
  const published = fs.readFileSync(path.join(data, "history.json"), "utf8");
  assert.doesNotMatch(published, /"price"|"hotels":\[\{"hotel_no":\d+,"price"/);
});
