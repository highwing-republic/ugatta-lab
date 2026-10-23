#!/usr/bin/env node
// ビジネスホテル料金トレンドの「週次データパック」を Markdown で出す。
// note の週次記事を書くための材料。数字はすべてページと同じ集計（js/business-hotel-price-trends-model.js）で出す。
//
// 過去の取得は施設ごとの料金を公開していないので、公開している最新の取得日（latest.json と history.json）だけを扱う。
//
//   node scripts/build_business_hotel_weekly.cjs                 # 最新の取得日
//   node scripts/build_business_hotel_weekly.cjs --out /tmp/pack.md
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data", "business-hotel-price-trends");
const PAGE = "https://lab.ugatta-llc.com/business-hotel-price-trends.html";
const NIGHTS = 30; // ページの既定の集計範囲
const LOOKAHEAD = 14; // 「来週・再来週の注目日」の範囲
const EVENT_LIMIT = 10;

require(path.join(ROOT, "js", "business-hotel-price-trends-model.js"));
const M = globalThis.BusinessHotelPriceModel;

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const yen = M.formatYen;
const pct = (value) => M.formatPercent(value);
const ratio = (value) => (typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}倍` : "—");

function load() {
  const manifest = readJson(path.join(DATA, "manifest.json"));
  const cohort = readJson(path.join(DATA, "cohort.json"));
  const latest = readJson(path.join(DATA, manifest.latest_file));
  const historyFile = manifest.history_file && path.join(DATA, manifest.history_file);
  const history = historyFile && fs.existsSync(historyFile) ? M.historyFor(readJson(historyFile), latest) : null;
  const eventsFile = path.join(DATA, "events.json");
  const events = fs.existsSync(eventsFile) ? readJson(eventsFile) : null;
  return {cohort, latest, history, events};
}

function nightLabel(date) {
  const holiday = M.holidayName(date);
  const eveOf = M.holidayName(M.addDays(date, 1));
  const type = M.nightType(date);
  if (holiday) return `祝日（${holiday}）`;
  if (eveOf) return `祝前日（翌日は${eveOf}）`;
  return type === "eve" ? "休前日" : "平日";
}

function build({cohort, latest, history, events}) {
  const national = M.nationalSummary(cohort, latest, history, {nights: NIGHTS});
  const previous = national.weekly.available ? M.addDays(latest.snapshot_date, -7) : null;
  const ranks = M.rankings(national);
  const points = M.highlights(national);
  const eventView = M.eventCandidates(events, national);
  const today = latest.snapshot_date;
  const lines = [];
  const push = (...rows) => lines.push(...rows);

  push(`# ビジネスホテル料金トレンド 週次データパック（取得日 ${today}）`, "");
  push(`- 条件: 大人1名・1室・1泊、楽天トラベルで販売中の最安プラン（食事条件は問わない）`);
  push(`- 集計: 各都市のCORE 5施設の中央値。今日から${NIGHTS}泊分（${M.formatDate(today)}〜${M.formatDate(M.addDays(today, NIGHTS - 1))}の泊）`);
  push(`- 比較施設群: ${latest.cohort_version}（${national.marketCount}都市・CORE ${national.markets.reduce((n, m) => n + m.view.core.length, 0)}施設）`);
  push(`- 7日前との比較: ${previous ? `${previous} の取得と比較` : "7日前の取得がないため比較なし"}`);
  push(`- ページ: ${PAGE}`, "");

  push("## 今週のポイント（ページと同じ文）", "");
  points.forEach((item) => push(`- ${item.text}`));
  if (!points.length) push("- （該当なし）");
  push("");

  const w = national.weekly;
  push("## 全国サマリ", "");
  push(`- ${national.marketCount}都市の代表料金（中央値）: ${yen(national.typical)}`);
  if (national.highest && national.lowest) push(`- 最も高い: ${national.highest.name} ${yen(national.highest.summary.typical)}／最も安い: ${national.lowest.name} ${yen(national.lowest.summary.typical)}`);
  push(`- 休前日の差（金・土・祝前日の泊と平日の泊、都市の中央値）: ${pct(national.weekendPremium)}`);
  push(`- 急騰日（代表料金の${M.SPIKE_RATIO}倍以上）のある都市: ${national.spikeMarkets}都市`);
  push(`- 売り切れが目立つ日（CORE ${M.SOLD_OUT_MIN}施設以上が楽天で売り切れ）: ${national.busyMarkets}都市・延べ${national.busyNights}日`);
  push(`- 7日前より: ${w.available ? `値上がり${w.up}都市・値下がり${w.down}都市・横ばい${w.flat}都市（比較できた${w.available}都市）` : "比較できる都市なし"}`, "");

  push("## 10都市の比較", "");
  push("| 都市 | 代表料金 | 値動きの大きさ | 休前日の差 | 急騰日 | 売り切れが目立つ日 | 7日変化 |");
  push("|---|---|---|---|---|---|---|");
  for (const item of national.markets) {
    const s = item.summary;
    const weekly = item.weekly.status === "ok" ? pct(item.weekly.change) : "—";
    push(`| ${item.name} | ${yen(s.typical)} | ${M.formatRatio(s.volatility)} | ${pct(s.weekendPremium)} | ${s.spikes.length}日 | ${s.busy.length}日 | ${weekly} |`);
  }
  push("");

  push("## 7日前との比較", "");
  if (w.available) {
    const rows = national.markets.filter((item) => item.weekly.status === "ok").sort((a, b) => b.weekly.change - a.weekly.change);
    rows.forEach((item) => push(`- ${item.name}: ${pct(item.weekly.change)}（CORE ${item.weekly.hotelCount}施設の変化率の中央値）`));
    if (ranks.risingHotels.length) {
      push("", "値上がりが大きい施設:");
      ranks.risingHotels.forEach((row) => push(`- ${row.name}（${row.market}）: ${pct(row.value)}`));
    }
  } else {
    push(`- まだ比較できません（${national.markets[0]?.weekly.reason || "7日前のデータがありません"}）。`);
  }
  push("");

  push(`## 来週・再来週の注目日（今日から${LOOKAHEAD}泊）`, "");
  const until = M.addDays(today, LOOKAHEAD - 1);
  const byDate = new Map();
  for (const item of national.markets) {
    for (const day of item.summary.days) {
      if (day.date > until) continue;
      const spike = item.summary.spikes.find((s) => s.date === day.date);
      if (!spike && !day.busy) continue;
      const parts = [];
      if (spike) parts.push(`代表料金の${ratio(spike.ratio)}（中央値 ${yen(spike.median)}${spike.reference ? "・参考値" : ""}）`);
      if (day.busy) parts.push(`売り切れ${day.soldOut}/${day.total}施設`);
      const events = (eventView.byDay.get(`${item.code}|${day.date}`) || []).map((event) => event.name);
      if (!byDate.has(day.date)) byDate.set(day.date, []);
      byDate.get(day.date).push(`${item.name}: ${parts.join("、")}${events.length ? `／重なる催し: ${events.join("、")}` : ""}`);
    }
  }
  if (!byDate.size) push("- （急騰日・売り切れが目立つ日はありません）");
  [...byDate.keys()].sort().forEach((date) => {
    push(`- **${M.formatDate(date)}の泊**（${nightLabel(date)}）`);
    byDate.get(date).forEach((row) => push(`  - ${row}`));
  });
  push("");

  push("## ランキング Top5", "");
  const rankBlock = (title, rows, format) => {
    push(`### ${title}`, "");
    if (!rows.length) push("- （該当なし）");
    rows.forEach((row, index) => push(`${index + 1}. ${format(row)}`));
    push("");
  };
  rankBlock("値動きが大きい都市（高い日は安い日の何倍か）", ranks.volatileMarkets, (row) => `${row.market}: ${M.formatRatio(row.value)}（${yen(row.low)}〜${yen(row.high)}）`);
  rankBlock("料金が跳ね上がる日", ranks.spikeDays, (row) => `${row.market} ${M.formatDate(row.date)}: 代表料金の${ratio(row.value)}（中央値 ${yen(row.median)}${row.reference ? "・参考値" : ""}${row.soldOut ? `・${row.soldOut}施設が売り切れ` : ""}）`);
  rankBlock("売り切れが目立つ日", ranks.busyDays, (row) => `${row.market} ${M.formatDate(row.date)}: ${row.soldOut}/${row.total}施設が売り切れ${row.median ? `（残る施設の中央値 ${yen(row.median)}）` : ""}`);
  rankBlock("値動きが大きい施設", ranks.volatileHotels, (row) => `${row.name}（${row.market}）: ${M.formatRatio(row.value)}`);

  push("## 急騰・売り切れの日に重なる催し（AI調べ・参考）", "");
  if (!eventView.available) push("- （催しカレンダーがありません）");
  else {
    push(`- 催しカレンダー: 調べた日 ${eventView.researchedOn}、${eventView.total}件のうち重なるもの${eventView.items.length}件（目立つ順に最大${EVENT_LIMIT}件）`);
    eventView.items.slice(0, EVENT_LIMIT).forEach((event) => {
      const nights = event.nights.map((night) => `${M.formatDate(night.date)}${night.spike ? " 急騰" : ""}${night.busy ? ` 売切${night.soldOut}` : ""}`).join("、");
      push(`- ${event.marketName}「${event.name}」${M.formatPeriod(event.start, event.end)}・${event.venue}／重なる泊: ${nights}／出典: ${event.sources.map((s) => s.url).join(" ")}`);
    });
  }
  push("");

  push("## 都市別メモ（曜日別の料金・代表料金との差）", "");
  for (const item of national.markets) {
    const days = item.summary.weekdays.filter((day) => day.index !== null);
    if (!days.length) continue;
    const high = days.reduce((a, b) => (b.index > a.index ? b : a));
    const low = days.reduce((a, b) => (b.index < a.index ? b : a));
    push(`- ${item.name}: 高い曜日 ${high.label}曜泊 ${pct(high.index)}／安い曜日 ${low.label}曜泊 ${pct(low.index)}（祝日・祝前日を除く）`);
  }
  push("");

  push("## 記事にするときの注意", "");
  push("- 数字はこのデータパックの値だけを使う（丸めた値を新たに作らない）。");
  push("- 売り切れは楽天トラベルで大人1名・1泊のプランが無いという意味で、施設全体の満室とは書かない。");
  push("- 催しは「重なる」までにとどめ、料金が上がった理由と断定しない。催しを書くときは出典を確かめる。");
  push("- 7日変化は同じ宿泊日の料金の比較で、需要の増減とは書かない。");
  push("- 記事の最後に「データ: 楽天トラベル空室検索API（Supported by Rakuten Developers）」とページへのリンクを入れる。");
  return lines.join("\n") + "\n";
}

function main(argv) {
  const args = {out: null};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") args.out = argv[++i];
  }
  const text = build(load());
  if (args.out) fs.writeFileSync(args.out, text);
  else process.stdout.write(text);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = {build, load};
