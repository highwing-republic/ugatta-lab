(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HotelPriceTrendsModel = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";

  const isFinitePositive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
  const asDateParts = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value.split("-").map(Number) : null;
  const addDays = (value, days) => {
    const parts = asDateParts(value);
    if (!parts) return null;
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
    return date.toISOString().slice(0, 10);
  };
  const formatJapaneseDate = (value) => {
    const parts = asDateParts(value);
    if (!parts) return value || "";
    const weekday = ["日", "月", "火", "水", "木", "金", "土"][new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay()];
    return `${parts[1]}/${parts[2]}（${weekday}）`;
  };
  const rawQuantile = (values, q) => {
    const sorted = values.filter(isFinitePositive).map(Number).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const position = (sorted.length - 1) * q;
    const base = Math.floor(position);
    const rest = position - base;
    return sorted[base] + (sorted[base + 1] == null ? 0 : rest * (sorted[base + 1] - sorted[base]));
  };
  const quantile = (values, q) => {
    const value = rawQuantile(values, q);
    return value == null ? null : Math.round(value);
  };
  const median = (values) => quantile(values, 0.5);
  const regionFrom = (snapshot, code) => snapshot?.regions?.find((region) => region.code === code) || null;
  const cohortMetadata = (region) => {
    const version = typeof region?.cohort_version === "string" && region.cohort_version.trim() ? region.cohort_version.trim() : null;
    const expectedCount = Number(region?.expected_core_count);
    const sourceProperties = Array.isArray(region?.properties) ? region.properties : [];
    const hasRoles = sourceProperties.some((property) => property.role != null);
    const declared = Boolean(version || region?.expected_core_count != null || hasRoles);
    const properties = declared && hasRoles
      ? sourceProperties.filter((property) => String(property.role || "").toLowerCase() === "core")
      : sourceProperties;
    const propertyIds = properties.map((property) => String(property.hotel_no));
    const valid = !declared || Boolean(version && expectedCount === 5 && properties.length === 5 && new Set(propertyIds).size === 5);
    return {active: declared, expectedCount: declared ? 5 : properties.length, properties, propertyIds, valid, version};
  };
  const qualityForCount = (successful) => successful >= 5 ? "sufficient" : successful === 4 ? "comparable" : successful === 3 ? "reference" : "insufficient";
  const conditionsMatch = (current, candidate) => ["adults", "rooms", "nights"].every((key) =>
    current?.conditions?.[key] != null && candidate?.conditions?.[key] != null &&
    Number(current.conditions[key]) === Number(candidate.conditions[key])
  );
    const sameIds = (left, right) => left.size === right.size && [...left].every((id) => right.has(id));

  function summarize(snapshot, regionCode, stayDate, mealType) {
    const region = regionFrom(snapshot, regionCode);
    const cohort = cohortMetadata(region);
    const propertyIds = new Set(cohort.propertyIds);
    const observations = (region?.rates || []).filter((row) => propertyIds.has(String(row.hotel_no)) && row.stay_date === stayDate && row.meal_type === mealType);
    const rowsByHotel = new Map();
    observations.forEach((row) => {
      const id = String(row.hotel_no);
      if (!rowsByHotel.has(id)) rowsByHotel.set(id, row);
    });
    const positions = cohort.properties.map((property) => {
      const row = rowsByHotel.get(String(property.hotel_no));
      const valid = row?.status === "success" && isFinitePositive(row?.min_price_yen);
      return {
        hotel_no: Number(property.hotel_no), name: property.name,
        min_price_yen: valid ? Number(row.min_price_yen) : null,
        plan_count: valid ? Number(row.plan_count || 0) : 0,
        status: row?.status || "no_data"
      };
    });
    const prices = positions.map((position) => position.min_price_yen).filter(isFinitePositive);
    const successful = prices.length;
    const dataQuality = cohort.active ? qualityForCount(successful) : successful >= 3 ? "legacy_comparable" : "legacy_reference";
    const comparisonReady = cohort.active ? cohort.valid && dataQuality !== "insufficient" : successful >= 3;
    const marketMedian = cohort.active && !comparisonReady ? null : median(prices);
    positions.forEach((position) => {
      position.price_index = marketMedian != null && position.min_price_yen != null ? position.min_price_yen / marketMedian * 100 : null;
    });
    return {
      region, observations: observations.length, successful, target: cohort.expectedCount,
      marketMedian, p25: cohort.active && !comparisonReady ? null : quantile(prices, .25), p75: cohort.active && !comparisonReady ? null : quantile(prices, .75),
      planCount: positions.reduce((sum, row) => sum + row.plan_count, 0), positions,
      comparisonReady, dataQuality, cohortActive: cohort.active, cohortValid: cohort.valid,
      cohortVersion: cohort.version, propertyIds: cohort.propertyIds
    };
  }

  function priceRank(summary, hotelNo) {
    if (!summary?.comparisonReady) return null;
    const selected = summary.positions.find((row) => Number(row.hotel_no) === Number(hotelNo));
    if (!selected?.min_price_yen) return null;
    const available = summary.positions.filter((row) => row.min_price_yen != null);
    const above = available.filter((row) => row.min_price_yen > selected.min_price_yen).length;
    const equal = available.filter((row) => row.min_price_yen === selected.min_price_yen).length;
    return {rank: above + 1, total: available.length, equal};
  }

  // 過去の取得は施設ごとの料金を公開せず、市場ごとの集計だけを trend-history.json に残す
  // （サーバーの scripts/export_static.py が同じ形で書き出す）。
  //   snapshots: [{date, conditions}]（古い順）
  //   regions[code].cohorts[i]: [cohort_version, cohortActive, cohortValid, "CORE施設番号,…", target] または null（その日に市場がない）
  //   regions[code].rates[宿泊日][食事条件][i]: [比較施設群中央値, 料金確認施設数, 観測行数]
  // 市場は期間中に一度でも出てきたもの、宿泊日は最新の取得日より後の泊だけを持つ（どの取得かに料金行があった泊と食事条件）。
  // trendHistoryFrom は同じ集計を取得そのものから作る（テストと検算用）。
  function trendHistoryFrom(snapshots, {days = 30} = {}) {
    const ordered = (snapshots || []).filter(Boolean).slice().sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)).slice(-days);
    const latest = ordered[ordered.length - 1];
    const regions = {};
    const codes = [...new Set(ordered.flatMap((snapshot) => (snapshot.regions || []).map((region) => region.code)))];
    codes.forEach((code) => {
      const latestRegion = {code};
      const stays = {};
      ordered.forEach((snapshot) => (regionFrom(snapshot, latestRegion.code)?.rates || []).forEach((row) => {
        if (row.stay_date > latest.snapshot_date) (stays[row.stay_date] ||= new Set()).add(row.meal_type);
      }));
      const cohorts = ordered.map((snapshot) => {
        const region = regionFrom(snapshot, latestRegion.code);
        if (!region) return null;
        const cohort = cohortMetadata(region);
        return [cohort.version, cohort.active, cohort.valid, [...cohort.propertyIds].sort().join(","), cohort.expectedCount];
      });
      const rates = {};
      Object.keys(stays).sort().forEach((stayDate) => {
        rates[stayDate] = {};
        [...stays[stayDate]].sort().forEach((mealType) => {
          rates[stayDate][mealType] = ordered.map((snapshot, index) => {
            if (!cohorts[index]) return null;
            const summary = summarize(snapshot, latestRegion.code, stayDate, mealType);
            return [summary.marketMedian, summary.successful, summary.observations];
          });
        });
      });
      regions[latestRegion.code] = {cohorts, rates};
    });
    return {
      schema_version: 1,
      latest_snapshot: latest?.snapshot_date || null,
      snapshots: ordered.map((snapshot) => ({date: snapshot.snapshot_date, conditions: snapshot.conditions || null})),
      regions
    };
  }

  // trend-history.json の i 番目の取得について、summarize と同じ名前で市場の集計を返す（施設ごとの値はない）
  function historySummary(trendHistory, index, regionCode, stayDate, mealType) {
    const region = trendHistory?.regions?.[regionCode];
    const cohort = region?.cohorts?.[index];
    const entry = trendHistory?.snapshots?.[index];
    if (!cohort || !entry) return null;
    const [version, active, valid, ids, target] = cohort;
    const [marketMedian, successful, observations] = region.rates?.[stayDate]?.[mealType]?.[index] || [null, 0, 0];
    const dataQuality = active ? qualityForCount(successful) : successful >= 3 ? "legacy_comparable" : "legacy_reference";
    return {
      snapshot_date: entry.date, conditions: entry.conditions, marketMedian, successful, observations, target,
      comparisonReady: active ? valid && dataQuality !== "insufficient" : successful >= 3,
      dataQuality, cohortActive: active, cohortValid: valid, cohortVersion: version,
      propertyIds: ids ? ids.split(",") : []
    };
  }

  function sevenDayComparison(currentSnapshot, trendHistory, selection) {
    const targetDate = addDays(currentSnapshot?.snapshot_date, -7);
    const index = (trendHistory?.snapshots || []).findIndex((entry) => entry.date === targetDate);
    if (index < 0) return {status: "missing_snapshot", previous: null};
    const previous = {snapshot_date: targetDate, conditions: trendHistory.snapshots[index].conditions};
    if (!conditionsMatch(currentSnapshot, previous)) return {status: "conditions_mismatch", previous};
    const prior = historySummary(trendHistory, index, selection.regionCode, selection.stayDate, selection.mealType);
    if (!prior) return {status: "missing_region", previous};
    const current = summarize(currentSnapshot, selection.regionCode, selection.stayDate, selection.mealType);
    const currentSelected = current.positions.find((row) => Number(row.hotel_no) === Number(selection.hotelNo));
    const cohortVersionsMatch = current.cohortVersion === prior.cohortVersion;
    const propertySetsMatch = sameIds(new Set(current.propertyIds), new Set(prior.propertyIds));
    const marketComparable = cohortVersionsMatch && propertySetsMatch && current.cohortValid && prior.cohortValid;
    const marketChange = marketComparable && current.comparisonReady && prior.comparisonReady && current.marketMedian != null && prior.marketMedian != null
      ? (current.marketMedian / prior.marketMedian - 1) * 100 : null;
    const status = !cohortVersionsMatch ? "cohort_version_mismatch" : propertySetsMatch ? "available" : "property_set_mismatch";
    return {status, previous, current, prior, currentSelected, marketChange};
  }

  // 選択した宿泊日の比較施設群中央値を取得日ごとに並べる。今日の比較施設群と同じバージョン・同じ施設の日だけ
  function trendRows(trendHistory, latestSummary, selection) {
    const expectedIds = [...latestSummary.propertyIds].sort().join(",");
    return (trendHistory?.snapshots || []).map((entry, index) => {
      const summary = historySummary(trendHistory, index, selection.regionCode, selection.stayDate, selection.mealType);
      if (!summary) return null;
      return {snapshot_date: entry.date, median: summary.marketMedian, successful: summary.successful, target: summary.target,
        cohort_version: summary.cohortVersion, cohort_valid: summary.cohortValid, property_ids: [...summary.propertyIds].sort().join(",")};
    }).filter((row) => row && row.snapshot_date <= selection.stayDate &&
      (!latestSummary.cohortActive || row.cohort_valid && row.cohort_version === latestSummary.cohortVersion && row.property_ids === expectedIds));
  }

  const MIN_RATING_PEERS = 3;
  function ratingPeers(regionProfiles, allProfiles, cohortActive) {
    if (regionProfiles.length >= MIN_RATING_PEERS) return {peers: regionProfiles, scope: "region"};
    if (cohortActive) return {peers: [], scope: "insufficient"};
    return {peers: allProfiles, scope: "all"};
  }
  const showPositionBars = (summary) => !summary?.cohortActive || Boolean(summary.comparisonReady);

  const signedPercent = (value) => {
    if (!Number.isFinite(value)) return "—";
    const rounded = Math.round(value * 10) / 10;
    return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
  };
  const positionLabel = (index) => index >= 110 ? "中央値より高い" : index <= 90 ? "中央値より低い" : "中央値付近";
  const changeLabel = (value) => {
    const normalized = Math.round(value * 1e10) / 1e10;
    return normalized >= 10 ? "上昇" : normalized >= 3 ? "やや上昇" : normalized <= -10 ? "低下" : normalized <= -3 ? "やや低下" : "大きな変化なし";
  };
  function insightLines(summary, comparison, hotelNo) {
    const selected = summary.positions.find((row) => Number(row.hotel_no) === Number(hotelNo));
    const lines = [];
    if (summary.region && !(summary.region.rates || []).length) return ["この市場の料金データはまだありません（取得開始前）。"];
    const hasComparableObservations = comparison?.status === "available" && comparison.prior?.observations > 0 && summary.observations > 0;
    if (comparison?.marketChange != null) {
      const direction = changeLabel(comparison.marketChange);
      lines.push(`比較施設群中央値は7日前比 ${signedPercent(comparison.marketChange)}（${direction}）です。`);
    }
    if (summary.cohortActive && !summary.cohortValid) {
      lines.push("比較施設群の構成を確認できないため、中央値・順位を表示しません。");
    } else if (!summary.comparisonReady) {
      const legacyLine = summary.observations === 0 ? "指定条件の観測行はありません。料金確認数は表示しません。" : hasComparableObservations ? `料金確認は7日前${comparison.prior.successful}/${comparison.prior.target}施設、現在${summary.successful}/${summary.target}施設です。3施設未満のため地域比較は参考表示です。` : summary.successful === 0 ? `指定条件の観測はありますが、料金確認は0/${summary.target}施設です。` : `料金確認は${summary.successful}/${summary.target}施設です。3施設未満のため地域比較は参考表示です。`;
      const cohortLine = summary.observations === 0 ? `指定条件の観測行はありません。料金確認は0/${summary.target}施設で、比較施設群中央値・順位は表示しません。` : hasComparableObservations ? `料金確認は7日前${comparison.prior.successful}/${comparison.prior.target}施設、現在${summary.successful}/${summary.target}施設です。2施設以下のため比較施設群中央値・順位は表示しません。` : `料金確認は${summary.successful}/${summary.target}施設です。2施設以下のため比較施設群中央値・順位は表示しません。`;
      lines.push(summary.cohortActive ? cohortLine : legacyLine);
    } else if (selected?.price_index != null) {
      const difference = selected.price_index - 100;
      const reference = summary.dataQuality === "reference" ? `（${summary.successful}/${summary.target}施設の参考値）` : "";
      lines.push(Math.round(difference * 10) === 0 ? `選択施設は比較施設群中央値と同水準です${reference}。` : `選択施設は比較施設群中央値より${Math.abs(difference).toFixed(1)}%${difference > 0 ? "高く" : "低く"}、${positionLabel(selected.price_index)}です${reference}。`);
    } else {
      lines.push("選択施設の料金は今回確認できませんでした（料金未確認は満室を意味しません）。");
    }
    if (summary.comparisonReady) {
      const quality = summary.dataQuality === "sufficient" ? "十分" : summary.dataQuality === "comparable" ? "比較可能" : summary.dataQuality === "reference" ? "参考値" : null;
      const suffix = quality ? `（${quality}）` : "";
      lines.push(hasComparableObservations ? `料金確認は7日前${comparison.prior.successful}/${comparison.prior.target}施設、現在${summary.successful}/${summary.target}施設です${suffix}。` : `料金確認は${summary.successful}/${summary.target}施設です${suffix}。`);
    }
    return lines.slice(0, 3);
  }

  // Legacy regions (no cohort_version) keep being collected and exported, but only
  // Phase 1 markets whose CORE set is fully observed are offered in the UI.
  function selectableRegions(manifest, snapshot) {
    const snapshotByCode = new Map((snapshot?.regions || []).map((region) => [region.code, region]));
    return (manifest?.regions || []).filter((manifestRegion) => {
      if (!manifestRegion.cohort_version) return false;
      const snapshotRegion = snapshotByCode.get(manifestRegion.code);
      const cohort = cohortMetadata(snapshotRegion);
      const observed = new Set((snapshotRegion?.rates || []).map((row) => String(row.hotel_no)));
      return cohort.active && cohort.valid && cohort.version === manifestRegion.cohort_version &&
        cohort.propertyIds.every((hotelNo) => observed.has(hotelNo));
    });
  }

  // The 7-day trend is calculated by the export (app/daily_trends.py). These helpers
  // only shape that payload for display and must not recompute any change rate.
  const DAILY_TREND_LABELS = ["7日前", "6日前", "5日前", "4日前", "3日前", "2日前", "昨日", "今日"];
  const TREND_COVERAGES = ["valid", "reference", "insufficient"];
  const TREND_REASON_TEXT = {
    not_exported: "7日トレンドは集計準備中です。",
    missing_cohort_version: "比較施設群のバージョンを確認できないため表示しません。",
    cohort_version_mismatch: "期間中に比較施設群のバージョンが変わったため比較しません。",
    core_set_mismatch: "期間中のCORE施設の観測がそろっていないため表示しません。",
    missing_baseline_snapshot: "7日前の観測がないため、まだ比較できません。",
    missing_snapshot: "7日前から今日までの8回分の観測がそろっていません。",
    insufficient_valid_facilities: "比較可能なCORE施設が2施設以下のため、市場の値動きを表示しません。"
  };
  // Phase 1 collection started 2026-10-05, so the first 7-day comparison is 10-12.
  // Before then, a missing or pre-Phase 1 baseline means the data is still accumulating.
  const PHASE1_FIRST_TREND_DATE = "2026-10-12";
  const ACCUMULATING_REASONS = ["missing_baseline_snapshot", "missing_snapshot", "cohort_version_mismatch"];
  const ACCUMULATING_TEXT = "7日比較データを蓄積中です（10/12から表示予定）。";
  const finiteOrNull = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const coverageOf = (value) => TREND_COVERAGES.includes(value) ? value : "insufficient";
  const trendPoints = (series) => DAILY_TREND_LABELS.map((label, index) => ({
    label, snapshotDate: series?.[index]?.snapshot_date || null, value: finiteOrNull(series?.[index]?.change_pct)
  }));

  function dailyTrendView(region) {
    const cohort = cohortMetadata(region);
    const source = region?.daily_trend || null;
    const versionMatches = Boolean(source && cohort.version && source.cohort_version === cohort.version);
    const marketCoverage = source?.market?.trendCoverage || {};
    const status = versionMatches ? coverageOf(marketCoverage.status ?? source.status) : "insufficient";
    const usableMarket = status !== "insufficient";
    const reason = !source ? "not_exported" : !versionMatches ? "cohort_version_mismatch"
      : usableMarket ? null : source.reason || "insufficient_valid_facilities";
    const facilityRows = new Map((versionMatches ? source.facilities || [] : []).map((row) => [String(row.hotel_no), row]));
    const facilities = cohort.properties.map((property) => {
      const row = facilityRows.get(String(property.hotel_no));
      const coverage = coverageOf(row?.trendCoverage?.status);
      const usable = coverage !== "insufficient";
      return {
        hotel_no: Number(property.hotel_no), name: property.name, coverage,
        commonStayDates: Number(row?.trendCoverage?.common_stay_date_count) || 0,
        points: trendPoints(usable ? row.series : []),
        changePct: usable ? finiteOrNull(row.series?.at(-1)?.change_pct) : null,
        direction: usable ? row.trend || null : null
      };
    });
    const latestSnapshot = source?.snapshot_dates?.at(-1) || "";
    const accumulating = Boolean(versionMatches && reason && latestSnapshot
      && latestSnapshot < PHASE1_FIRST_TREND_DATE && ACCUMULATING_REASONS.includes(reason));
    return {
      status, reason, accumulating,
      reasonText: accumulating ? ACCUMULATING_TEXT
        : reason ? TREND_REASON_TEXT[reason] || TREND_REASON_TEXT.missing_snapshot : null,
      cohortVersion: cohort.version, snapshotDates: source?.snapshot_dates || [],
      market: {
        status, points: trendPoints(usableMarket ? source.market.series : []),
        changePct: usableMarket ? finiteOrNull(source.market.series?.at(-1)?.change_pct) : null,
        direction: usableMarket ? source.market.trend || null : null,
        validCount: versionMatches ? Number(marketCoverage.valid_facility_count) || 0 : 0,
        expectedCount: Number(marketCoverage.expected_facility_count) || cohort.expectedCount
      },
      facilities
    };
  }

  // Missing values split the line; they are never drawn as 0%.
  function trendSegments(points) {
    const segments = [];
    let current = [];
    (points || []).forEach((point, index) => {
      if (point.value == null) { if (current.length) segments.push(current); current = []; }
      else current.push({...point, index});
    });
    if (current.length) segments.push(current);
    return segments;
  }

  function trendAxis(values, {floor = -2, ceiling = 4, headroom = 1} = {}) {
    const finite = values.filter((value) => typeof value === "number" && Number.isFinite(value));
    const low = Math.min(floor, ...finite.map((value) => value - headroom));
    const high = Math.max(ceiling, ...finite.map((value) => value + headroom));
    const step = [1, 2, 5, 10, 20, 50, 100].find((candidate) => (high - low) / candidate <= 5) || 200;
    const min = Math.floor(low / step) * step;
    const max = Math.ceil(high / step) * step;
    const ticks = [];
    for (let value = max; value >= min; value -= step) ticks.push(value);
    return {min, max, step, ticks};
  }

  return {DAILY_TREND_LABELS, addDays, changeLabel, cohortMetadata, conditionsMatch, dailyTrendView, formatJapaneseDate, insightLines, isFinitePositive, median, priceRank, qualityForCount, ratingPeers, rawQuantile, regionFrom, selectableRegions, sevenDayComparison, showPositionBars, trendHistoryFrom, historySummary, trendRows, signedPercent, summarize, trendAxis, trendSegments};
});
