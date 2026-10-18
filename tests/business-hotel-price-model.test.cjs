const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../js/business-hotel-price-trends-model.js");

// 1市場・CORE 5施設＋BACKUP 1施設の小さな比較施設群
const cohort = {
  cohort_version: "bh-v1",
  cross_city_brand: "東横イン",
  markets: [
    {
      code: "sapporo",
      name: "札幌",
      prefecture: "北海道",
      properties: [
        {hotel_no: 1, name: "A", brand: "東横イン", role: "core"},
        {hotel_no: 2, name: "B", brand: "X", role: "core"},
        {hotel_no: 3, name: "C", brand: "Y", role: "core"},
        {hotel_no: 4, name: "D", brand: "Z", role: "core"},
        {hotel_no: 5, name: "E", brand: "W", role: "core"},
        {hotel_no: 9, name: "Backup", brand: "V", role: "backup"},
      ],
    },
  ],
};

// 2026-10-16（金）から14泊。平日8,000円、金土10,000円、10/24（土）だけ20,000円。
function snapshot(date, {shift = 0, version = "bh-v1", start = "2026-10-16"} = {}) {
  const dates = Array.from({length: 14}, (_, i) => model.addDays(start, i));
  const price = (d, offset) => {
    const day = model.weekdayIndex(d);
    const base = d === "2026-10-24" ? 20000 : day === 5 || day === 6 ? 10000 : 8000;
    return base + offset * 100 + shift;
  };
  return {
    snapshot_date: date,
    cohort_version: version,
    stay_dates: dates,
    markets: [
      {
        code: "sapporo",
        hotels: [
          {hotel_no: 1, price: dates.map((d) => price(d, 0)), meal: "B".repeat(14)},
          {hotel_no: 2, price: dates.map((d) => price(d, 1)), meal: "R".repeat(14)},
          {hotel_no: 3, price: dates.map((d) => price(d, 2)), meal: "R".repeat(14)},
          // D: 2泊は販売プランなし
          {hotel_no: 4, price: dates.map((d, i) => (i < 2 ? null : price(d, 3))), meal: "--" + "R".repeat(12)},
          // E: 最初の2泊は取得エラー → 先頭2泊はCOREが3施設（参考値）
          {hotel_no: 5, price: dates.map((d, i) => (i < 2 ? null : price(d, 4))), meal: "??" + "T".repeat(12)},
          {hotel_no: 9, price: dates.map(() => 1), meal: "R".repeat(14)},
        ],
      },
    ],
  };
}

test("CORE施設だけで宿泊日ごとの中央値を出し、3施設は参考値にする", () => {
  const view = model.marketView(cohort, snapshot("2026-10-16"), "sapporo");
  assert.equal(view.core.length, 5);
  assert.equal(view.backup.length, 1);
  const days = model.dailyMedians(view);
  assert.equal(days[0].status, "reference");
  assert.equal(days[0].count, 3);
  assert.equal(days[2].status, "ok");
  assert.equal(days[2].median, 8200); // 日曜: 8000,8100,8200,8300,8400
  assert.equal(days[2].min, 8000);
  assert.equal(days[2].max, 8400);
});

test("市場の代表料金・値動き・週末差・急騰日", () => {
  const summary = model.marketSummary(model.marketView(cohort, snapshot("2026-10-16"), "sapporo"));
  assert.equal(summary.validNights, 12);
  assert.equal(summary.typical, 8200);
  assert.deepEqual(summary.spikes.map((day) => day.date), ["2026-10-24"]);
  assert.ok(summary.volatility > 0);
  // 中央値を出せる金土は10/23（10,200円）と10/24（20,200円）。中央値15,200円 ÷ 日〜木8,200円
  assert.equal(Math.round(summary.weekendPremium * 10) / 10, 85.4);
  const saturday = summary.weekdays.find((day) => day.label === "土");
  assert.equal(saturday.nights, 1); // 10/17は参考値なので曜日別には入れない
  assert.equal(model.calendarClass(summary.days[8], summary.typical), "spike");
  assert.equal(model.calendarClass(summary.days[2], summary.typical), "mid");
  assert.equal(summary.days[0].status, "reference"); // 参考値の日も色分けし、画面では参考と明示する
  assert.equal(model.calendarClass(summary.days[0], summary.typical), "high");
  assert.equal(model.calendarClass({status: "none"}, summary.typical), "none");
});

test("料金が上がる期間: 10%以上高い日が続く宿泊日をまとめ、いちばん高い泊を山にする", () => {
  const summary = model.marketSummary(model.marketView(cohort, snapshot("2026-10-16"), "sapporo"));
  const periods = model.pricePeriods(summary);
  assert.equal(periods.length, 2);
  // 10/16（金）・10/17（土）は参考値の10,100円（代表料金8,200円の1.23倍）
  assert.deepEqual([periods[0].start, periods[0].end, periods[0].nights, periods[0].spike], ["2026-10-16", "2026-10-17", 2, false]);
  assert.equal(periods[0].peak.reference, true);
  // 10/23（金）10,200円と10/24（土）20,200円。山は急騰の10/24
  assert.deepEqual([periods[1].start, periods[1].end, periods[1].nights, periods[1].spike], ["2026-10-23", "2026-10-24", 2, true]);
  assert.equal(periods[1].peak.date, "2026-10-24");
  assert.equal(periods[1].peak.median, 20200);
  assert.equal(Math.round(periods[1].peak.ratio * 100) / 100, 2.46);
});

test("泊まる日ごとの値段の動き: 同じ泊の料金を取得の古い順にたどり、何日前の取得かを付ける", () => {
  const snap = (date, shift, version) => snapshot(date, {start: date, shift, version});
  const history = model.stayHistory(cohort, [snap("2026-10-16", 400), snap("2026-10-14", 0), snap("2026-10-15", 200), snap("2026-10-13", 0, "bh-v0")], "sapporo", "2026-10-18");
  // bh-v0 の取得は使わない
  assert.deepEqual(history.points.map((point) => [point.snapshot, point.daysBefore, point.median]), [["2026-10-14", 4, 8200], ["2026-10-15", 3, 8400], ["2026-10-16", 2, 8600]]);
  assert.equal(history.points[0].hotels.length, 5);
  assert.equal(Math.round(history.change * 10) / 10, 4.9);
  assert.equal(history.direction, "up");
});

test("値段の動き方: 施設ごとに最初の取得と今朝を比べ、高い泊とその他の泊で数える", () => {
  const snap = (date, shift) => snapshot(date, {start: date, shift});
  const latest = snap("2026-10-16", 400);
  // 10/18（日）泊はD施設が今朝は売り切れ
  latest.markets[0].hotels[3].price[2] = null;
  latest.markets[0].hotels[3].meal = "RR-" + "R".repeat(11);
  const result = model.pricePaths(cohort, [snap("2026-10-14", 0), latest], "sapporo");
  assert.equal(result.records, 2);
  const [high, other] = result.groups;
  // 共通の泊は10/16〜10/27。どの施設も+400円（+3.9〜5%）→ 値上がり。10/24（土）だけ20,000円台で+2%未満 → 横ばい
  assert.equal(high.key, "high");
  assert.ok(high.flat >= 4);
  assert.equal(other.soldOut, 1);
  assert.ok(other.up > 0);
  assert.equal(other.down, 0);
  assert.equal(model.pricePaths(cohort, [latest], "sapporo").groups.length, 0);
});

test("期間を絞ると先頭からその泊数だけを使う", () => {
  const view = model.marketView(cohort, snapshot("2026-10-16"), "sapporo", {nights: 7});
  assert.equal(view.dates.length, 7);
  assert.equal(model.marketSummary(view).spikes.length, 0);
});

test("施設ごとの集計と、もっとも多い食事区分", () => {
  const view = model.marketView(cohort, snapshot("2026-10-16"), "sapporo");
  const d = model.hotelSummary(view.core[3]);
  assert.equal(d.noPlanNights, 2);
  assert.equal(d.pricedNights, 12);
  assert.equal(d.leadingMeal.label, "素泊まり");
  const a = model.hotelSummary(view.core[0]);
  assert.equal(a.leadingMeal.code, "B");
  assert.equal(a.leadingMeal.share, 100);
});

test("都市横断の比較は各市場のCOREにある指定ブランドを使う", () => {
  const rows = model.crossCityBrand(cohort, snapshot("2026-10-16"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hotel.name, "A");
  assert.equal(rows[0].hotel.median, 8000);
});

test("7日変化: ちょうど7日前・同じ比較施設群のときだけ比べる", () => {
  const latest = snapshot("2026-10-16", {shift: 400});
  const before = snapshot("2026-10-09");
  const result = model.weeklyChange(cohort, latest, before, "sapporo");
  assert.equal(result.status, "ok");
  assert.equal(result.direction, "up");
  assert.ok(result.change > 3 && result.change < 6);

  assert.equal(model.weeklyChange(cohort, latest, snapshot("2026-10-10"), "sapporo").status, "insufficient");
  assert.equal(model.weeklyChange(cohort, latest, snapshot("2026-10-09", {version: "bh-v0"}), "sapporo").status, "insufficient");
  assert.equal(model.weeklyChange(cohort, latest, null, "sapporo").status, "insufficient");
});

test("7日変化: 共通宿泊日が10泊未満の施設は使わない", () => {
  const latest = snapshot("2026-10-16", {start: "2026-10-16"});
  const before = snapshot("2026-10-09", {start: "2026-10-09"}); // 共通は10/16〜10/22の7泊だけ
  const result = model.weeklyChange(cohort, latest, before, "sapporo");
  assert.equal(result.status, "insufficient");
});

test("表示用の書式", () => {
  assert.equal(model.formatYen(8200), "8,200円");
  assert.equal(model.formatYen(null), "—");
  assert.equal(model.formatPercent(4.04), "+4.0%");
  assert.equal(model.formatPercent(-0.04), "0.0%");
  assert.equal(model.formatPercent(NaN), "—");
  assert.equal(model.formatDate("2026-10-24"), "10/24（土）");
});

test("値動きの大きさは上位・下位1割を除いた倍率で、1日だけの極端な値に引っぱられない", () => {
  const steady = Array.from({length: 20}, (_, i) => 10000 + (i % 2) * 1000);
  const withOutlier = [...steady.slice(0, 19), 120000];
  assert.equal(model.spreadRatio(steady.slice(0, 9)), null); // 10泊未満は出さない
  assert.equal(Math.round(model.spreadRatio(steady) * 100) / 100, 1.1);
  assert.ok(model.spreadRatio(withOutlier) < 1.2);
  assert.ok(model.coefficientOfVariation(withOutlier) > 100); // 変動係数だと1日で跳ね上がる
  assert.equal(model.formatRatio(1.234), "1.23倍");
  assert.equal(model.formatRatio(null), "—");
});

// 2市場: 札幌（10/24に急騰）と、料金がほぼ一定の市場
const twoMarkets = {
  ...cohort,
  markets: [
    cohort.markets[0],
    {code: "okayama", name: "岡山", prefecture: "岡山県", properties: [11, 12, 13, 14, 15].map((no) => ({hotel_no: no, name: `O${no}`, brand: `b${no}`, role: "core"}))},
  ],
};
function twoMarketSnapshot(date, shift = 0) {
  const base = snapshot(date, {shift});
  base.markets.push({code: "okayama", hotels: [11, 12, 13, 14, 15].map((no) => ({hotel_no: no, price: base.stay_dates.map(() => 7000 + no * 10 + shift), meal: "R".repeat(14)}))});
  return base;
}

test("全国サマリ: 代表料金の中央値、最も高い・安い市場、急騰日のある市場の数", () => {
  const national = model.nationalSummary(twoMarkets, twoMarketSnapshot("2026-10-16"), null);
  assert.equal(national.marketCount, 2);
  assert.equal(national.highest.name, "札幌");
  assert.equal(national.lowest.name, "岡山");
  assert.equal(national.typical, Math.round((8200 + 7130) / 2));
  assert.equal(national.spikeMarkets, 1);
  assert.equal(national.weekly.available, 0);
});

test("ランキング: 値動き・跳ね上がる日・7日の値上がりを大きい順に最大5件", () => {
  const latest = twoMarketSnapshot("2026-10-16", 400);
  const national = model.nationalSummary(twoMarkets, latest, twoMarketSnapshot("2026-10-09"));
  const ranks = model.rankings(national);
  assert.deepEqual(ranks.volatileMarkets.map((row) => row.market), ["札幌", "岡山"]);
  assert.ok(ranks.volatileHotels.length === 5 && ranks.volatileHotels[0].market === "札幌");
  assert.deepEqual(ranks.spikeDays.map((row) => [row.market, row.date]), [["札幌", "2026-10-24"]]);
  assert.equal(national.weekly.available, 2);
  assert.equal(ranks.risingMarkets[0].market, "岡山"); // 7,130円前後に+400円は札幌より上昇率が大きい
  assert.ok(ranks.risingHotels.length === 5 && ranks.risingHotels.every((row) => row.value > 0));
});

test("祝日と休前日: 祝前日の泊は休前日、祝日の泊は祝日として扱う", () => {
  assert.equal(model.holidayName("2026-11-03"), "文化の日");
  assert.equal(model.nightType("2026-11-02"), "eve"); // 月曜泊・翌日が祝日
  assert.equal(model.nightType("2026-11-03"), "holiday"); // 祝日の火曜泊（翌日は平日）
  assert.equal(model.nightType("2026-11-06"), "eve"); // 金曜泊
  assert.equal(model.nightType("2026-11-08"), "weekday"); // 日曜泊・翌日は平日
  assert.equal(model.nightType("2026-11-22"), "eve"); // 日曜泊・翌日が勤労感謝の日
  assert.equal(model.nightType("2027-03-21"), "eve"); // 春分の日（日）・翌日は振替休日
});

// 11/1（日）〜14泊。11/2（月・祝前日）と11/3（祝）を含む。11/7（土）は2施設が売り切れで料金は3施設だけ・高騰
function holidaySnapshot() {
  const dates = Array.from({length: 14}, (_, i) => model.addDays("2026-11-01", i));
  const price = (d, offset) => {
    const type = model.nightType(d);
    const base = d === "2026-11-07" ? 25000 : type === "eve" ? 11000 : 8000;
    return base + offset * 100;
  };
  const soldOutOn = (i, d) => d === "2026-11-07" && i >= 3;
  return {
    snapshot_date: "2026-11-01",
    cohort_version: "bh-v1",
    stay_dates: dates,
    markets: [{
      code: "sapporo",
      hotels: [1, 2, 3, 4, 5].map((no, i) => ({hotel_no: no, price: dates.map((d) => (soldOutOn(i, d) ? null : price(d, i))), meal: dates.map((d) => (soldOutOn(i, d) ? "-" : "R")).join("")})).concat([{hotel_no: 9, price: dates.map(() => 1), meal: "R".repeat(14)}]),
    }],
  };
}

test("売り切れが目立つ日と、参考値の日の急騰を拾う", () => {
  const summary = model.marketSummary(model.marketView(cohort, holidaySnapshot(), "sapporo"));
  const day = summary.days.find((d) => d.date === "2026-11-07");
  assert.equal(day.status, "reference");
  assert.equal(day.soldOut, 2);
  assert.equal(day.busy, true);
  assert.deepEqual(summary.busy.map((d) => d.date), ["2026-11-07"]);
  const spike = summary.spikes.find((d) => d.date === "2026-11-07");
  assert.ok(spike && spike.reference && spike.soldOut === 2);
  assert.equal(model.calendarClass(day, summary.typical), "spike");
});

test("曜日別は祝日・祝前日の泊を除き、休前日の差は祝前日も休前日に数える", () => {
  const summary = model.marketSummary(model.marketView(cohort, holidaySnapshot(), "sapporo"));
  const monday = summary.weekdays.find((d) => d.label === "月");
  assert.equal(monday.nights, 1); // 11/2（祝前日）は除き、11/9だけ
  const tuesday = summary.weekdays.find((d) => d.label === "火");
  assert.equal(tuesday.nights, 1); // 11/3（祝日）は除き、11/10だけ
  assert.ok(summary.weekendPremium > 30); // 休前日 11,200円 前後 ÷ 平日 8,200円
});

test("今週のポイント: 直近の休前日、売り切れ、急騰を決まった文型で出す", () => {
  const national = model.nationalSummary(cohort, holidaySnapshot(), null);
  const items = model.highlights(national, {today: "2026-11-01"});
  assert.equal(items[0].kind, "eve");
  assert.match(items[0].text, /^直近の休前日 11\/2（月）は、1都市で代表料金の1\.3倍以上/);
  const spike = items.find((item) => item.kind === "spike");
  assert.match(spike.text, /札幌 11\/7（土）：中央値 .*2施設が売り切れ/);
  const ranks = model.rankings(national);
  assert.deepEqual(ranks.busyDays.map((d) => [d.market, d.date, d.soldOut]), [["札幌", "2026-11-07", 2]]);
});

test("催し: 前泊から最終日の泊までに急騰日・売り切れが目立つ日があれば重なるとする", () => {
  const national = model.nationalSummary(cohort, snapshot("2026-10-16"), null);
  const event = (name, start, end, extra = {}) => ({market: "sapporo", name, start, end, venue: "会場", category: "concert", note: null, sources: [{url: "https://example.jp/a", title: "t"}], ...extra});
  const calendar = {researched_on: "2026-10-16", coverage: {start: "2026-10-16", end: "2026-12-15"}, events: [
    event("翌日のマラソン", "2026-10-25", "2026-10-25"),          // 10/24（土）は急騰日 → 前泊として重なる
    event("当日の公演", "2026-10-24", "2026-10-24"),
    event("ふつうの日", "2026-10-20", "2026-10-21"),              // 重ならないが都市の一覧には出す
    event("出典が不正", "2026-10-24", "2026-10-24", {sources: [{url: "javascript:alert(1)", title: "x"}]}),
    event("別の市場", "2026-10-24", "2026-10-24", {market: "naha"}),
  ]};
  const view = model.eventCandidates(calendar, national);
  assert.equal(view.available, true);
  assert.equal(view.total, 4);
  assert.deepEqual(view.items.map((item) => item.name).sort(), ["当日の公演", "翌日のマラソン"]);
  assert.deepEqual(view.items[0].nights.map((night) => [night.date, night.spike]), [["2026-10-24", true]]);
  assert.equal(view.byDay.get("sapporo|2026-10-24").length, 2);
  assert.deepEqual(view.byMarket.get("sapporo").map((item) => item.name), ["翌日のマラソン", "当日の公演", "ふつうの日"]);
  assert.equal(view.researchedOn, "2026-10-16");
  assert.equal(model.eventCandidates(null, national).available, false);
  assert.equal(model.formatPeriod("2026-10-24", "2026-10-25"), "10/24（土）〜10/25（日）");
  assert.equal(model.formatPeriod("2026-10-24", "2026-10-24"), "10/24（土）");
});
