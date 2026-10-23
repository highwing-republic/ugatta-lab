const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../js/hotel-price-trends-model.js");

const snapshot = (date, rates, properties = [{hotel_no: 1, name: "A"}, {hotel_no: 2, name: "B"}, {hotel_no: 3, name: "C"}], conditions = {adults: 2, rooms: 1, nights: 1}) => ({
  snapshot_date: date, conditions, regions: [{code: "area", properties, rates}]
});
const row = (hotel_no, min_price_yen, status = "success") => ({hotel_no, stay_date: "2026-10-01", meal_type: "two_meals", min_price_yen, plan_count: 1, status});
const cohortSnapshot = (date, rates, version = "area-v1", properties = [1, 2, 3, 4, 5].map((hotel_no) => ({hotel_no, name: `H${hotel_no}`}))) => ({
  snapshot_date: date,
  conditions: {adults: 2, rooms: 1, nights: 1},
  regions: [{code: "area", cohort_version: version, expected_core_count: 5, properties, rates}]
});

test("summarize accepts only positive finite numeric success prices once per property", () => {
  const data = snapshot("2026-09-16", [row(1, 10000), row(1, 50000), row(2, 0), row(3, Infinity), row(4, 20000), row(2, 25000, "no_plan")]);
  const result = model.summarize(data, "area", "2026-10-01", "two_meals");
  assert.equal(result.successful, 1);
  assert.equal(result.marketMedian, 10000);
  assert.equal(result.target, 3);
  assert.equal(result.positions[1].min_price_yen, null);
});

test("non-numeric and boolean prices are never valid prices", () => {
  const result = model.summarize(snapshot("2026-09-16", [row(1, "10000"), row(2, true), row(3, NaN)]), "area", "2026-10-01", "two_meals");
  assert.equal(result.successful, 0);
  assert.equal(result.marketMedian, null);
});

test("summarize distinguishes no observation from observed but zero successful prices", () => {
  const none = model.summarize(snapshot("2026-09-16", []), "area", "2026-10-01", "two_meals");
  const zero = model.summarize(snapshot("2026-09-16", [row(1, null, "no_plan"), row(2, null, "error")]), "area", "2026-10-01", "two_meals");
  assert.deepEqual([none.observations, none.successful], [0, 0]);
  assert.deepEqual([zero.observations, zero.successful], [2, 0]);
});

test("small samples retain a reference median but suppress comparisons and ranks", () => {
  const result = model.summarize(snapshot("2026-09-16", [row(1, 10000), row(2, 30000)]), "area", "2026-10-01", "two_meals");
  assert.equal(result.marketMedian, 20000);
  assert.equal(result.comparisonReady, false);
  assert.equal(model.priceRank(result, 1), null);
});

test("Phase 1 cohort quality follows the fixed 5/4/3/0-2 display rules", () => {
  const five = model.summarize(cohortSnapshot("2026-09-16", [1, 2, 3, 4, 5].map((id) => row(id, id * 10000))), "area", "2026-10-01", "two_meals");
  const four = model.summarize(cohortSnapshot("2026-09-16", [1, 2, 3, 4].map((id) => row(id, id * 10000))), "area", "2026-10-01", "two_meals");
  const three = model.summarize(cohortSnapshot("2026-09-16", [1, 2, 3].map((id) => row(id, id * 10000))), "area", "2026-10-01", "two_meals");
  const two = model.summarize(cohortSnapshot("2026-09-16", [row(1, 10000), row(2, 30000)]), "area", "2026-10-01", "two_meals");
  assert.deepEqual([five.dataQuality, four.dataQuality, three.dataQuality, two.dataQuality], ["sufficient", "comparable", "reference", "insufficient"]);
  assert.equal(three.marketMedian, 20000);
  assert.deepEqual(model.priceRank(three, 1), {rank: 3, total: 3, equal: 1});
  assert.equal(two.marketMedian, null);
  assert.equal(two.p25, null);
  assert.equal(two.p75, null);
  assert.equal(model.priceRank(two, 1), null);
});

test("BACKUP and LUXURY_REFERENCE never enter the Phase 1 denominator or median", () => {
  const properties = [
    ...[1, 2, 3, 4, 5].map((hotel_no) => ({hotel_no, name: `CORE${hotel_no}`, role: "core"})),
    {hotel_no: 6, name: "BACKUP", role: "backup"},
    {hotel_no: 7, name: "LUXURY", role: "luxury_reference"}
  ];
  const rates = [row(1, 10000), row(2, 20000), row(3, 30000), row(4, 40000), row(6, 1), row(7, 999999)];
  const result = model.summarize(cohortSnapshot("2026-09-16", rates, "area-v1", properties), "area", "2026-10-01", "two_meals");
  assert.equal(result.target, 5);
  assert.equal(result.successful, 4);
  assert.equal(result.marketMedian, 25000);
  assert.deepEqual(result.positions.map((item) => item.hotel_no), [1, 2, 3, 4, 5]);
});

test("a malformed Phase 1 cohort suppresses comparisons", () => {
  const properties = [1, 2, 3, 4].map((hotel_no) => ({hotel_no}));
  const result = model.summarize(cohortSnapshot("2026-09-16", [1, 2, 3, 4].map((id) => row(id, id * 10000)), "area-v1", properties), "area", "2026-10-01", "two_meals");
  assert.equal(result.cohortValid, false);
  assert.equal(result.target, 5);
  assert.equal(result.marketMedian, null);
  assert.equal(result.comparisonReady, false);
});

test("partial cohort metadata fails closed instead of falling back to legacy comparison", () => {
  const properties = [1, 2, 3, 4, 5].map((hotel_no) => ({hotel_no, role: "core"}));
  const rates = properties.map(({hotel_no}) => row(hotel_no, hotel_no * 10000));
  const missingVersion = cohortSnapshot("2026-09-16", rates, null, properties);
  const wrongCount = cohortSnapshot("2026-09-16", rates, "area-v1", properties);
  delete missingVersion.regions[0].cohort_version;
  wrongCount.regions[0].expected_core_count = 4;
  for (const data of [missingVersion, wrongCount]) {
    const result = model.summarize(data, "area", "2026-10-01", "two_meals");
    assert.equal(result.cohortActive, true);
    assert.equal(result.cohortValid, false);
    assert.equal(result.target, 5);
    assert.equal(result.marketMedian, null);
    assert.equal(result.comparisonReady, false);
  }
});

test("price rank uses competition ranking and recognizes equal prices", () => {
  const result = model.summarize(snapshot("2026-09-16", [row(1, 30000), row(2, 30000), row(3, 20000)]), "area", "2026-10-01", "two_meals");
  assert.deepEqual(model.priceRank(result, 1), {rank: 1, total: 3, equal: 2});
  assert.deepEqual(model.priceRank(result, 3), {rank: 3, total: 3, equal: 1});
});

test("seven-day comparison requires exact date and matching conditions", () => {
  const current = snapshot("2026-09-16", [row(1, 12000), row(2, 20000), row(3, 30000)]);
  const prior = snapshot("2026-09-09", [row(1, 10000), row(2, 20000), row(3, 30000)]);
  const selection = {regionCode: "area", hotelNo: 1, stayDate: "2026-10-01", mealType: "two_meals"};
  assert.equal(model.sevenDayComparison(current, model.trendHistoryFrom([current, prior]), selection).marketChange, 0);
  assert.equal(model.sevenDayComparison(current, model.trendHistoryFrom([snapshot("2026-09-08", prior.regions[0].rates)]), selection).status, "missing_snapshot");
  assert.equal(model.sevenDayComparison(current, model.trendHistoryFrom([snapshot("2026-09-09", prior.regions[0].rates, undefined, {adults: 1, rooms: 1, nights: 1})]), selection).status, "conditions_mismatch");
});

test("property-set changes suppress market comparison but retain a same-property price change", () => {
  const current = snapshot("2026-09-16", [row(1, 12000), row(2, 20000), row(3, 30000)]);
  const prior = snapshot("2026-09-09", [row(1, 10000), row(2, 20000), row(4, 30000)], [{hotel_no: 1}, {hotel_no: 2}, {hotel_no: 4}]);
  const result = model.sevenDayComparison(current, model.trendHistoryFrom([current, prior]), {regionCode: "area", hotelNo: 1, stayDate: "2026-10-01", mealType: "two_meals"});
  assert.equal(result.status, "property_set_mismatch");
  assert.equal(result.marketChange, null);
  assert.equal("selectedChange" in result, false); // 施設ごとの過去の料金は公開していない
});

test("cohort version changes suppress both market and selected-property history", () => {
  const current = cohortSnapshot("2026-09-16", [1, 2, 3, 4, 5].map((id) => row(id, id * 12000)), "area-v2");
  const prior = cohortSnapshot("2026-09-09", [1, 2, 3, 4, 5].map((id) => row(id, id * 10000)), "area-v1");
  const result = model.sevenDayComparison(current, model.trendHistoryFrom([prior]), {regionCode: "area", hotelNo: 1, stayDate: "2026-10-01", mealType: "two_meals"});
  assert.equal(result.status, "cohort_version_mismatch");
  assert.equal(result.marketChange, null);
});

test("date display inputs are calendar-safe at month and leap-year boundaries", () => {
  assert.equal(model.addDays("2026-01-01", -7), "2025-12-25");
  assert.equal(model.addDays("2024-03-01", -1), "2024-02-29");
  assert.equal(model.signedPercent(-0.01), "0.0%");
  assert.equal(model.changeLabel(9000 / 10000 * 100 - 100), "低下");
  assert.equal(model.formatJapaneseDate("2026-09-30"), "9/30（水）");
});

test("change labels honor rounded three and ten percent boundaries", () => {
  assert.equal(model.changeLabel(3), "やや上昇");
  assert.equal(model.changeLabel(10), "上昇");
  assert.equal(model.changeLabel(-3), "やや低下");
  assert.equal(model.changeLabel(-10), "低下");
  assert.equal(model.changeLabel(2.94), "大きな変化なし");
  assert.equal(model.changeLabel(2.96), "大きな変化なし");
  assert.equal(model.changeLabel(9.96), "やや上昇");
  assert.equal(model.changeLabel(-9.96), "やや低下");
});

test("insights provide market, position, and confirmation as separate lines", () => {
  const current = model.summarize(snapshot("2026-09-16", [row(1, 12000), row(2, 20000), row(3, 30000)]), "area", "2026-10-01", "two_meals");
  const prior = model.summarize(snapshot("2026-09-09", [row(1, 10000), row(2, 18000), row(3, 28000)]), "area", "2026-10-01", "two_meals");
  const lines = model.insightLines(current, {status: "available", marketChange: 10, prior}, 1);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /7日前比/);
  assert.match(lines[1], /選択施設/);
  assert.match(lines[2], /7日前.*現在/);
  assert.doesNotMatch(lines[0], /料金確認/);
});

test("small-sample insights retain comparable prior confirmation counts", () => {
  const current = model.summarize(snapshot("2026-09-16", [row(1, 12000), row(2, 20000)]), "area", "2026-10-01", "two_meals");
  const prior = model.summarize(snapshot("2026-09-09", [row(1, 10000), row(2, 18000)]), "area", "2026-10-01", "two_meals");
  assert.match(model.insightLines(current, {status: "available", prior}, 1).join(" "), /7日前2\/3施設、現在2\/3施設/);
});

test("insights distinguish no observations, zero success, and equal price", () => {
  const noObservation = model.summarize(snapshot("2026-09-16", [{...row(1, 10000), stay_date: "2026-10-02"}]), "area", "2026-10-01", "two_meals");
  const zeroSuccess = model.summarize(snapshot("2026-09-16", [row(1, null, "no_plan")]), "area", "2026-10-01", "two_meals");
  const equal = model.summarize(snapshot("2026-09-16", [row(1, 20000), row(2, 20000), row(3, 20000)]), "area", "2026-10-01", "two_meals");
  assert.match(model.insightLines(noObservation, null, 1).join(" "), /観測行/);
  assert.match(model.insightLines(zeroSuccess, null, 1).join(" "), /0\/3/);
  assert.match(model.insightLines(equal, null, 1).join(" "), /同水準/);
});

test("insights remain at most three sentences when the selected price is missing", () => {
  const properties = [1, 2, 3, 4].map((hotel_no) => ({hotel_no}));
  const prior = snapshot("2026-09-09", [row(1, 10000), row(2, 20000), row(3, 30000), row(4, null, "no_plan")], properties);
  const current = snapshot("2026-09-16", [row(1, 12000), row(2, 24000), row(3, 36000), row(4, null, "no_plan")], properties);
  const selection = {regionCode: "area", hotelNo: 4, stayDate: "2026-10-01", mealType: "two_meals"};
  const comparison = model.sevenDayComparison(current, model.trendHistoryFrom([prior]), selection);
  const lines = model.insightLines(comparison.current, comparison, 4);
  assert.equal(lines.length, 3);
  assert.equal((lines.join("").match(/。/g) || []).length, 3);
  assert.match(lines[1], /料金未確認は満室を意味しません/);
});

test("a market without any collected rates says collection has not started", () => {
  const empty = model.summarize(cohortSnapshot("2026-10-04", []), "area", "", "two_meals");
  assert.deepEqual(model.insightLines(empty, null, 1), ["この市場の料金データはまだありません（取得開始前）。"]);
});

test("trend history keeps market aggregates only and matches summarize for every stored day", () => {
  const properties = [1, 2, 3, 4, 5].map((hotel_no) => ({hotel_no, name: `H${hotel_no}`, role: "core"}));
  const days = ["2026-09-09", "2026-09-12", "2026-09-16"];
  const snapshots = days.map((date, index) => cohortSnapshot(date, [1, 2, 3, 4, 5].map((id) => row(id, id * 10000 + index * 1001)), "area-v1", properties));
  snapshots[1].regions[0].rates[1].status = "no_plan"; // 9/12は4施設
  const history = JSON.parse(JSON.stringify(model.trendHistoryFrom(snapshots)));
  assert.deepEqual(history.snapshots.map((entry) => entry.date), days);
  assert.doesNotMatch(JSON.stringify(history), /hotel_no|min_price_yen|plan_count|"H1"/);
  days.forEach((date, index) => {
    const expected = model.summarize(snapshots[index], "area", "2026-10-01", "two_meals");
    const actual = model.historySummary(history, index, "area", "2026-10-01", "two_meals");
    for (const key of ["marketMedian", "successful", "observations", "target", "comparisonReady", "dataQuality", "cohortActive", "cohortValid", "cohortVersion"]) {
      assert.deepEqual(actual[key], expected[key], `${date} ${key}`);
    }
    assert.deepEqual([...actual.propertyIds].sort(), [...expected.propertyIds].sort());
  });
  const latestSummary = model.summarize(snapshots[2], "area", "2026-10-01", "two_meals");
  const rows = model.trendRows(history, latestSummary, {regionCode: "area", stayDate: "2026-10-01", mealType: "two_meals"});
  assert.deepEqual(rows.map((item) => [item.snapshot_date, item.median, item.successful]), [["2026-09-09", 30000, 5], ["2026-09-12", 36001, 4], ["2026-09-16", 32002, 5]]);
  // 別のバージョンの日は推移に入れない
  const mixed = model.trendHistoryFrom([cohortSnapshot("2026-09-08", [1, 2, 3].map((id) => row(id, id * 10000)), "area-v0", properties), ...snapshots]);
  assert.equal(model.trendRows(mixed, latestSummary, {regionCode: "area", stayDate: "2026-10-01", mealType: "two_meals"}).length, 3);
  assert.equal(model.sevenDayComparison(snapshots[2], history, {regionCode: "area", hotelNo: 1, stayDate: "2026-10-01", mealType: "two_meals"}).status, "available");
});

test("rating peers require three profiles in a Phase 1 market", () => {
  const profile = (hotel_no) => ({hotel_no, latest: {ratings: {service: 4}}});
  const all = [1, 2, 3, 4, 5, 6].map(profile);
  assert.deepEqual(model.ratingPeers([profile(1)], all, true), {peers: [], scope: "insufficient"});
  assert.equal(model.ratingPeers([1, 2, 3].map(profile), all, true).scope, "region");
  assert.deepEqual(model.ratingPeers([profile(1)], all, false), {peers: all, scope: "all"});
});

test("position bars are hidden when a Phase 1 market has two or fewer prices", () => {
  const two = model.summarize(cohortSnapshot("2026-09-16", [row(1, 10000), row(2, 30000)]), "area", "2026-10-01", "two_meals");
  const three = model.summarize(cohortSnapshot("2026-09-16", [1, 2, 3].map((id) => row(id, id * 10000))), "area", "2026-10-01", "two_meals");
  const legacyTwo = model.summarize(snapshot("2026-09-16", [row(1, 10000), row(2, 30000)]), "area", "2026-10-01", "two_meals");
  assert.equal(model.showPositionBars(two), false);
  assert.equal(model.showPositionBars(three), true);
  assert.equal(model.showPositionBars(legacyTwo), true);
});
