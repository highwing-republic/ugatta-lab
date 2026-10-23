#!/usr/bin/env node
// ビジネスホテル料金トレンドの公開ファイルを、非公開の日別料金（scripts/update_business_hotel_prices.py の保管場所）から作る。
//
//   data/business-hotel-price-trends/latest.json   … 今朝の取得（ページの表示に使う）
//   data/business-hotel-price-trends/history.json  … 過去の取得の集計だけ（施設ごとの日別料金は含めない）
//   data/business-hotel-price-trends/manifest.json
//
// 集計はページと同じ js/business-hotel-price-trends-model.js の buildHistory で出す。
//
//   node scripts/build_business_hotel_public.cjs [--raw-dir DIR] [--data-dir DIR]
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, ".private", "business-hotel-price-trends", "raw");
const DATA_DIR = path.join(ROOT, "data", "business-hotel-price-trends");
const HISTORY_DAYS = 60; // update_business_hotel_prices.py の RAW_KEEP_DAYS と同じ
const SCHEMA_VERSION = 2;

require(path.join(ROOT, "js", "business-hotel-price-trends-model.js"));
const M = globalThis.BusinessHotelPriceModel;

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value, pretty = false) => fs.writeFileSync(file, `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`);

function loadRaw(rawDir) {
  if (!fs.existsSync(rawDir)) return [];
  return fs.readdirSync(rawDir).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().map((name) => readJson(path.join(rawDir, name)));
}

function build({rawDir = RAW_DIR, dataDir = DATA_DIR} = {}) {
  const cohort = readJson(path.join(dataDir, "cohort.json"));
  const snapshots = loadRaw(rawDir);
  const latest = snapshots[snapshots.length - 1];
  if (!latest) throw new Error(`日別料金がありません: ${rawDir}`);
  const oldest = M.addDays(latest.snapshot_date, -HISTORY_DAYS);
  const history = M.buildHistory(cohort, snapshots.filter((snap) => snap.snapshot_date >= oldest));
  const manifest = {
    schema_version: SCHEMA_VERSION,
    generated_at: latest.generated_at,
    latest_snapshot: latest.snapshot_date,
    latest_file: "latest.json",
    history_file: "history.json",
    history_since: history.snapshots[0],
    history_records: history.snapshots.length,
    cohort_file: "cohort.json",
    cohort_version: cohort.cohort_version,
    conditions: cohort.conditions,
    source: {name: "楽天トラベル空室検索API", url: "https://webservice.rakuten.co.jp/documentation/vacant-hotel-search"},
  };
  writeJson(path.join(dataDir, "latest.json"), latest);
  writeJson(path.join(dataDir, "history.json"), history);
  writeJson(path.join(dataDir, "manifest.json"), manifest, true);
  return {latest, history, manifest};
}

if (require.main === module) {
  const args = {rawDir: RAW_DIR, dataDir: DATA_DIR};
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === "--raw-dir") args.rawDir = path.resolve(process.argv[++i]);
    else if (process.argv[i] === "--data-dir") args.dataDir = path.resolve(process.argv[++i]);
  }
  const {manifest} = build(args);
  console.log(`公開: 取得日 ${manifest.latest_snapshot}／集計 ${manifest.history_since}から${manifest.history_records}日分`);
}

module.exports = {build, loadRaw};
