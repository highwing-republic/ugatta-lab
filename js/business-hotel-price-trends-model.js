(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BusinessHotelPriceModel = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  'use strict';

  // ビジネスホテル版料金トレンドの集計（画面に依存しない純粋関数）。
  // 料金は各施設の「大人1名・1室・1泊の最安プラン」。CORE施設だけで集計し、BACKUPでは補わない。

  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  const MEALS = {R: "素泊まり", B: "朝食付き", D: "夕食付き", T: "朝夕食付き", "-": "販売プランなし", "?": "取得エラー"};
  const MIN_CORE_FOR_MEDIAN = 4; // 5施設中4施設以上で中央値を表示
  const REFERENCE_CORE = 3; // 3施設は参考値
  const SPIKE_RATIO = 1.5; // 代表料金の1.5倍以上を急騰日とする
  const BAND = 0.1; // カレンダーの「高い・低い」の境界（±10%）
  const TREND_THRESHOLD = 3; // 7日変化の上昇・低下の境界（±3%）
  const TREND_MIN_DATES = 10; // 施設ごとに共通宿泊日が10泊以上
  const TREND_MIN_HOTELS = 4; // 市場の7日変化はCORE 4施設以上
  const SPREAD_LOW = 0.1; // 値動きの大きさ: 下位1割の日と
  const SPREAD_HIGH = 0.9; // 上位1割の日を除いた幅
  const SPREAD_MIN_NIGHTS = 10; // 10泊以上あるときだけ出す
  const RANK_SIZE = 5;
  const SOLD_OUT_MIN = 2;
  const EVENT_SOLD_OUT_WEIGHT = 0.5; // 催しの並び順: 売り切れ1施設 = 料金の倍率0.5倍分
  const EVENT_TOP = 6; // 全国の欄に開いて見せる件数 // COREのうち2施設以上で楽天の販売プランなし → 売り切れが目立つ日

  // 国民の祝日（振替休日・国民の休日を含む）。観測期間（当日から60泊）に必要な範囲を持つ。
  const HOLIDAYS = {
    "2026-01-01": "元日", "2026-01-12": "成人の日", "2026-02-11": "建国記念の日", "2026-02-23": "天皇誕生日",
    "2026-03-20": "春分の日", "2026-04-29": "昭和の日", "2026-05-03": "憲法記念日", "2026-05-04": "みどりの日",
    "2026-05-05": "こどもの日", "2026-05-06": "振替休日", "2026-07-20": "海の日", "2026-08-11": "山の日",
    "2026-09-21": "敬老の日", "2026-09-22": "国民の休日", "2026-09-23": "秋分の日", "2026-10-12": "スポーツの日",
    "2026-11-03": "文化の日", "2026-11-23": "勤労感謝の日",
    "2027-01-01": "元日", "2027-01-11": "成人の日", "2027-02-11": "建国記念の日", "2027-02-23": "天皇誕生日",
    "2027-03-21": "春分の日", "2027-03-22": "振替休日", "2027-04-29": "昭和の日", "2027-05-03": "憲法記念日",
    "2027-05-04": "みどりの日", "2027-05-05": "こどもの日", "2027-07-19": "海の日", "2027-08-11": "山の日",
    "2027-09-20": "敬老の日", "2027-09-23": "秋分の日", "2027-10-11": "スポーツの日", "2027-11-03": "文化の日",
    "2027-11-23": "勤労感謝の日",
  };

  const isPrice = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
  const parseDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value.split("-").map(Number) : null);
  const weekdayIndex = (value) => {
    const parts = parseDate(value);
    return parts ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay() : null;
  };
  const addDays = (value, days) => {
    const parts = parseDate(value);
    if (!parts) return null;
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days)).toISOString().slice(0, 10);
  };
  const holidayName = (value) => HOLIDAYS[value] || null;
  // 宿泊日の種類: 休前日（金・土・祝前日の泊）／祝日の泊／平日の泊
  const nightType = (value) => {
    const next = addDays(value, 1);
    const nextWeekday = weekdayIndex(next);
    if (nextWeekday === 6 || nextWeekday === 0 || holidayName(next)) return "eve";
    if (holidayName(value)) return "holiday";
    return "weekday";
  };
  const formatDate = (value) => {
    const parts = parseDate(value);
    if (!parts) return value || "";
    return `${parts[1]}/${parts[2]}（${WEEKDAYS[weekdayIndex(value)]}）`;
  };
  const formatYen = (value) => (isPrice(value) ? `${Math.round(value).toLocaleString("ja-JP")}円` : "—");
  const formatPercent = (value, {signed = true, digits = 1} = {}) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    const rounded = Number(value.toFixed(digits));
    if (rounded === 0) return `${(0).toFixed(digits)}%`;
    return `${signed && rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}%`;
  };

  const quantile = (values, q) => {
    const sorted = values.filter(isPrice).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const position = (sorted.length - 1) * q;
    const base = Math.floor(position);
    const rest = position - base;
    return sorted[base] + (sorted[base + 1] === undefined ? 0 : rest * (sorted[base + 1] - sorted[base]));
  };
  // 変化率（負の値も含む）の中央値
  const medianOfNumbers = (values) => {
    const sorted = values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const median = (values) => {
    const value = quantile(values, 0.5);
    return value === null ? null : Math.round(value);
  };
  // 値動きの大きさ: 上位1割と下位1割の日を除いて「高い日は安い日の何倍か」。
  // 安い部屋が売り切れた1日だけの極端な値に引っぱられないよう、変動係数ではなくこれを使う。
  const spreadRatio = (values) => {
    const list = values.filter(isPrice);
    if (list.length < SPREAD_MIN_NIGHTS) return null;
    const low = quantile(list, SPREAD_LOW);
    const high = quantile(list, SPREAD_HIGH);
    return low > 0 ? high / low : null;
  };
  const formatRatio = (value) => (typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}倍` : "—");
  const coefficientOfVariation = (values) => {
    const list = values.filter(isPrice);
    if (list.length < 2) return null;
    const mean = list.reduce((sum, value) => sum + value, 0) / list.length;
    const variance = list.reduce((sum, value) => sum + (value - mean) ** 2, 0) / list.length;
    return (Math.sqrt(variance) / mean) * 100;
  };

  // ---------------------------------------------------------------- データの組み立て

  function marketView(cohort, snapshot, code, {nights} = {}) {
    const market = cohort.markets.find((item) => item.code === code);
    const observed = snapshot?.markets?.find((item) => item.code === code);
    if (!market || !observed) return null;
    const limit = nights ? Math.min(nights, snapshot.stay_dates.length) : snapshot.stay_dates.length;
    const dates = snapshot.stay_dates.slice(0, limit);
    const byNo = new Map(observed.hotels.map((hotel) => [hotel.hotel_no, hotel]));
    const hotels = market.properties.map((property) => {
      const row = byNo.get(property.hotel_no);
      const prices = dates.map((_, index) => (row && isPrice(row.price[index]) ? row.price[index] : null));
      const meals = dates.map((_, index) => (row && row.meal[index]) || "?");
      return {...property, prices, meals};
    });
    return {code, name: market.name, prefecture: market.prefecture, dates, core: hotels.filter((hotel) => hotel.role === "core"), backup: hotels.filter((hotel) => hotel.role === "backup")};
  }

  function dailyMedians(view) {
    return view.dates.map((date, index) => {
      const prices = view.core.map((hotel) => hotel.prices[index]).filter(isPrice);
      const count = prices.length;
      const status = count >= MIN_CORE_FOR_MEDIAN ? "ok" : count === REFERENCE_CORE ? "reference" : "none";
      const soldOut = view.core.filter((hotel) => hotel.meals[index] === "-").length;
      return {
        date,
        weekday: weekdayIndex(date),
        nightType: nightType(date),
        holiday: holidayName(date),
        eveOf: holidayName(addDays(date, 1)),
        soldOut,
        busy: soldOut >= SOLD_OUT_MIN,
        count,
        total: view.core.length,
        status,
        median: status === "none" ? null : median(prices),
        min: status === "none" ? null : Math.min(...prices),
        max: status === "none" ? null : Math.max(...prices),
      };
    });
  }

  // ---------------------------------------------------------------- 市場の指標

  // 曜日別は祝日・祝前日の泊を除く（例: 祝日前の日曜泊を「日曜」に混ぜない）。金・土はそのまま
  function weekdayPattern(days, typical) {
    const plain = (day) => !day.holiday && !(day.eveOf && day.weekday !== 5 && day.weekday !== 6);
    return WEEKDAYS.map((label, weekday) => {
      const values = days.filter((day) => day.status === "ok" && day.weekday === weekday && plain(day)).map((day) => day.median);
      const value = median(values);
      return {weekday, label, nights: values.length, median: value, index: value && typical ? (value / typical - 1) * 100 : null};
    });
  }

  function marketSummary(view) {
    const days = dailyMedians(view);
    const ok = days.filter((day) => day.status === "ok");
    const values = ok.map((day) => day.median);
    const typical = median(values);
    const weekend = median(ok.filter((day) => day.nightType === "eve").map((day) => day.median));
    const weekdays = median(ok.filter((day) => day.nightType === "weekday").map((day) => day.median));
    // 急騰日は参考値（料金確認3施設）の日も含める。混む日ほど売り切れで参考値になりやすいため
    const spikes = typical ? days.filter((day) => day.status !== "none" && day.median >= typical * SPIKE_RATIO) : [];
    const busy = days.filter((day) => day.busy);
    const low = ok.length ? Math.min(...values) : null;
    const high = ok.length ? Math.max(...values) : null;
    return {
      code: view.code,
      name: view.name,
      nights: view.dates.length,
      validNights: ok.length,
      typical,
      volatility: spreadRatio(values),
      spread: low && high ? high / low : null,
      low,
      high,
      weekendPremium: weekend && weekdays ? (weekend / weekdays - 1) * 100 : null,
      spikes: spikes.map((day) => ({date: day.date, median: day.median, ratio: day.median / typical, reference: day.status === "reference", soldOut: day.soldOut})),
      busy: busy.map((day) => ({date: day.date, soldOut: day.soldOut, total: day.total, median: day.median, ratio: day.median && typical ? day.median / typical : null, status: day.status})),
      days,
      weekdays: weekdayPattern(days, typical),
    };
  }

  function calendarClass(day, typical) {
    if (day.status === "none" || !typical) return "none";
    const ratio = day.median / typical;
    if (ratio >= SPIKE_RATIO) return "spike";
    if (ratio >= 1 + BAND) return "high";
    if (ratio <= 1 - BAND) return "low";
    return "mid";
  }

  // 料金が高くなる期間: カレンダーで「10%以上高い」「急騰」が続く宿泊日をひとまとまりにする。
  // 比べられない日（2施設以下）で区切る。グラフの見出し文と注記に使う
  function pricePeriods(summary) {
    const periods = [];
    let current = null;
    summary.days.forEach((day) => {
      const level = calendarClass(day, summary.typical);
      if (level !== "high" && level !== "spike") {
        current = null;
        return;
      }
      const ratio = day.median / summary.typical;
      if (!current) {
        current = {start: day.date, end: day.date, nights: 0, spike: false, peak: null};
        periods.push(current);
      }
      current.end = day.date;
      current.nights += 1;
      current.spike = current.spike || level === "spike";
      if (!current.peak || day.median > current.peak.median) current.peak = {date: day.date, median: day.median, ratio, reference: day.status === "reference"};
    });
    return periods;
  }

  function hotelSummary(hotel) {
    const prices = hotel.prices.filter(isPrice);
    const priced = hotel.meals.filter((code) => MEALS[code] && code !== "-" && code !== "?");
    const mealShare = {};
    for (const code of priced) mealShare[code] = (mealShare[code] || 0) + 1;
    const leadingMeal = Object.entries(mealShare).sort((a, b) => b[1] - a[1])[0];
    return {
      hotel_no: hotel.hotel_no,
      name: hotel.name,
      brand: hotel.brand,
      area: hotel.area,
      access: hotel.access,
      rooms: hotel.rooms,
      role: hotel.role,
      nights: hotel.prices.length,
      pricedNights: prices.length,
      noPlanNights: hotel.meals.filter((code) => code === "-").length,
      median: median(prices),
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
      volatility: spreadRatio(prices),
      leadingMeal: leadingMeal ? {code: leadingMeal[0], label: MEALS[leadingMeal[0]], share: (leadingMeal[1] / priced.length) * 100} : null,
    };
  }

  function crossCityBrand(cohort, snapshot, {nights} = {}) {
    const brand = cohort.cross_city_brand;
    return cohort.markets.map((market) => {
      const view = marketView(cohort, snapshot, market.code, {nights});
      const hotel = view && view.core.find((item) => item.brand === brand);
      return {code: market.code, market: market.name, brand, hotel: hotel ? hotelSummary(hotel) : null};
    });
  }

  // ---------------------------------------------------------------- 7日変化

  // 今日と7日前の取得で、同じ宿泊日（今日以降）の料金を施設ごとに比べる。
  // 施設ごとの変化率の中央値を出し、市場の値はCORE施設の中央値。同じ cohort_version 同士だけを比べる。
  function weeklyChange(cohort, latest, previous, code) {
    if (!latest || !previous) return {status: "insufficient", reason: "7日前のデータがまだありません"};
    if (addDays(latest.snapshot_date, -7) !== previous.snapshot_date) return {status: "insufficient", reason: "7日前のデータがありません"};
    if (latest.cohort_version !== previous.cohort_version) return {status: "insufficient", reason: "比較施設群が入れ替わったため比べません"};
    const now = marketView(cohort, latest, code);
    const before = marketView(cohort, previous, code);
    if (!now || !before) return {status: "insufficient", reason: "比較データがありません"};
    const beforeIndex = new Map(before.dates.map((date, index) => [date, index]));
    const hotels = now.core.map((hotel) => {
      const old = before.core.find((item) => item.hotel_no === hotel.hotel_no);
      const changes = [];
      now.dates.forEach((date, index) => {
        const oldIndex = beforeIndex.get(date);
        if (!old || oldIndex === undefined) return;
        const a = old.prices[oldIndex];
        const b = hotel.prices[index];
        if (isPrice(a) && isPrice(b)) changes.push((b / a - 1) * 100);
      });
      const value = changes.length >= TREND_MIN_DATES ? medianOfNumbers(changes) : null;
      return {hotel_no: hotel.hotel_no, name: hotel.name, commonDates: changes.length, change: value};
    });
    const valid = hotels.filter((hotel) => hotel.change !== null);
    if (valid.length < TREND_MIN_HOTELS) return {status: "insufficient", reason: "比べられる施設が足りません", hotels};
    const change = medianOfNumbers(valid.map((hotel) => hotel.change));
    const direction = change >= TREND_THRESHOLD ? "up" : change <= -TREND_THRESHOLD ? "down" : "flat";
    return {status: "ok", change, direction, hotels, hotelCount: valid.length};
  }

  // 泊まる日ごとの値段の動き: 毎朝の取得を古い順に並べ、同じ泊の料金を施設ごとにたどる。
  // 比較施設群が今朝と違う取得は使わない。daysBefore は泊まる日の何日前の取得か
  const daysBetween = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
  function usableSnapshots(snapshots) {
    const ordered = (snapshots || []).filter(Boolean).slice().sort((a, b) => (a.snapshot_date < b.snapshot_date ? -1 : 1));
    const latest = ordered[ordered.length - 1];
    return latest ? ordered.filter((snap) => snap.cohort_version === latest.cohort_version) : [];
  }

  // dates の泊ごとに、取得ごとの料金（施設ごと・中央値）をたどる。各取得の marketView は1回だけ作る
  function stayHistories(cohort, snapshots, code, dates) {
    const views = usableSnapshots(snapshots).map((snap) => ({snap, view: marketView(cohort, snap, code), index: new Map(snap.stay_dates.map((date, i) => [date, i]))}));
    return dates.map((date) => {
      const points = views.map(({snap, view, index: byDate}) => {
        const index = byDate.get(date);
        if (index === undefined || !view) return null;
        const hotels = view.core.map((hotel) => ({hotel_no: hotel.hotel_no, name: hotel.name, price: hotel.prices[index], soldOut: hotel.meals[index] === "-"}));
        const prices = hotels.map((hotel) => hotel.price).filter(isPrice);
        const status = prices.length >= MIN_CORE_FOR_MEDIAN ? "ok" : prices.length === REFERENCE_CORE ? "reference" : "none";
        return {snapshot: snap.snapshot_date, daysBefore: daysBetween(date, snap.snapshot_date), status, median: status === "none" ? null : median(prices), soldOut: hotels.filter((hotel) => hotel.soldOut).length, hotels};
      }).filter(Boolean);
      const valid = points.filter((point) => point.status !== "none");
      const first = valid[0] || null;
      const last = valid.length && valid[valid.length - 1].snapshot === (points[points.length - 1] || {}).snapshot ? valid[valid.length - 1] : null;
      const change = first && last && first !== last ? (last.median / first.median - 1) * 100 : null;
      return {date, points, first, last, change, direction: change === null ? null : change >= TREND_THRESHOLD ? "up" : change <= -TREND_THRESHOLD ? "down" : "flat"};
    });
  }

  function stayHistory(cohort, snapshots, code, date) {
    return stayHistories(cohort, snapshots, code, [date])[0];
  }

  // 値段の動き方の集計: 今朝の対象期間の泊 × CORE施設ごとに、いちばん古い取得と今朝を比べる。
  // 途中で料金が見えていて今朝は楽天で売り切れなら「売り切れ」。今朝の料金がふだんの+10%以上の泊と
  // その他の泊に分けて数える（料金が高いから上がった、という因果は示さない）
  function pricePaths(cohort, snapshots, code, {nights} = {}) {
    const usable = usableSnapshots(snapshots);
    const latest = usable[usable.length - 1];
    if (!latest || usable.length < 2) return {records: usable.length, groups: []};
    const summary = marketSummary(marketView(cohort, latest, code, {nights}));
    const views = usable.map((snap) => ({snap, view: marketView(cohort, snap, code)}));
    const empty = () => ({up: 0, flat: 0, down: 0, soldOut: 0, total: 0, nights: 0});
    const groups = {high: empty(), other: empty()};
    summary.days.forEach((day) => {
      if (day.status === "none") return;
      const level = calendarClass(day, summary.typical);
      const group = groups[level === "high" || level === "spike" ? "high" : "other"];
      let counted = false;
      views[views.length - 1].view.core.forEach((hotel) => {
        let first = null;
        views.slice(0, -1).some(({snap, view}) => {
          const index = snap.stay_dates.indexOf(day.date);
          const old = index < 0 ? null : view.core.find((item) => item.hotel_no === hotel.hotel_no);
          if (old && isPrice(old.prices[index])) first = old.prices[index];
          return first !== null;
        });
        if (first === null) return;
        const index = latest.stay_dates.indexOf(day.date);
        const now = hotel.prices[index];
        let outcome = null;
        if (hotel.meals[index] === "-") outcome = "soldOut";
        else if (isPrice(now)) {
          const change = (now / first - 1) * 100;
          outcome = change >= TREND_THRESHOLD ? "up" : change <= -TREND_THRESHOLD ? "down" : "flat";
        }
        if (!outcome) return;
        group[outcome] += 1;
        group.total += 1;
        counted = true;
      });
      if (counted) group.nights += 1;
    });
    return {records: usable.length, since: usable[0].snapshot_date, latest: latest.snapshot_date, groups: [{key: "high", ...groups.high}, {key: "other", ...groups.other}]};
  }

  // ---------------------------------------------------------------- 全国サマリとランキング

  function nationalSummary(cohort, latest, previous, {nights} = {}) {
    const markets = cohort.markets.map((market) => {
      const view = marketView(cohort, latest, market.code, {nights});
      const summary = view ? marketSummary(view) : null;
      return {code: market.code, name: market.name, view, summary, weekly: weeklyChange(cohort, latest, previous, market.code)};
    }).filter((item) => item.view && item.summary);
    const priced = markets.filter((item) => item.summary.typical);
    const byTypical = priced.slice().sort((a, b) => b.summary.typical - a.summary.typical);
    const weekly = markets.filter((item) => item.weekly.status === "ok");
    return {
      markets,
      marketCount: markets.length,
      typical: median(priced.map((item) => item.summary.typical)),
      highest: byTypical[0] || null,
      lowest: byTypical[byTypical.length - 1] || null,
      weekendPremium: medianOfNumbers(markets.map((item) => item.summary.weekendPremium)),
      spikeMarkets: markets.filter((item) => item.summary.spikes.length > 0).length,
      busyMarkets: markets.filter((item) => item.summary.busy.length > 0).length,
      busyNights: markets.reduce((sum, item) => sum + item.summary.busy.length, 0),
      weekly: {
        available: weekly.length,
        up: weekly.filter((item) => item.weekly.direction === "up").length,
        down: weekly.filter((item) => item.weekly.direction === "down").length,
        flat: weekly.filter((item) => item.weekly.direction === "flat").length,
      },
    };
  }

  // ---------------------------------------------------------------- 催しの候補（AI調べ・参考）

  // events.json（月1回調べる催しカレンダー）と、いま表示している期間の急騰日・売り切れが目立つ日を突き合わせる。
  // 催しの前日の泊（前泊）から最終日の泊までを「催しに重なる泊」とする。料金の集計には使わない。
  function eventCandidates(calendar, national) {
    const events = (Array.isArray(calendar?.events) ? calendar.events : []).filter((event) => event && event.name && parseDate(event.start) && parseDate(event.end) && event.start <= event.end
      && Array.isArray(event.sources) && event.sources.some((source) => /^https?:\/\//.test(source?.url || "")));
    const markets = new Map(national.markets.map((market) => {
      const nights = new Map(market.summary.days.map((day) => [day.date, day]));
      const spikes = new Set(market.summary.spikes.map((day) => day.date));
      return [market.code, {name: market.name, nights, spikes, typical: market.summary.typical}];
    }));
    const items = [];
    const byDay = new Map();
    const byMarket = new Map();
    for (const event of events) {
      const market = markets.get(event.market);
      if (!market) continue;
      const nights = [];
      for (let date = addDays(event.start, -1); date <= event.end; date = addDays(date, 1)) {
        const day = market.nights.get(date);
        if (!day) continue;
        const spike = market.spikes.has(date);
        const ratio = day.median && market.typical ? day.median / market.typical : null;
        if (spike || day.busy) nights.push({date, spike, busy: day.busy, soldOut: day.soldOut, ratio});
      }
      // 目立ち方: 売り切れ施設数を重く見て、料金の倍率を足す（全国の欄はこの順に並べる）
      const score = nights.reduce((best, night) => Math.max(best, night.soldOut * EVENT_SOLD_OUT_WEIGHT + (night.ratio || 0)), 0);
      const item = {...event, marketName: market.name, nights, score, sources: event.sources.filter((source) => /^https?:\/\//.test(source?.url || ""))};
      if (!byMarket.has(event.market)) byMarket.set(event.market, []);
      byMarket.get(event.market).push(item);
      if (!nights.length) continue;
      items.push(item);
      for (const night of nights) {
        const key = `${event.market}|${night.date}`;
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(item);
      }
    }
    const first = (item) => item.nights[0].date;
    items.sort((a, b) => b.score - a.score || (first(a) < first(b) ? -1 : first(a) > first(b) ? 1 : 0));
    return {available: Boolean(calendar && Array.isArray(calendar.events)), total: events.length, items, byDay, byMarket, researchedOn: calendar?.researched_on || null, coverage: calendar?.coverage || null};
  }

  const formatPeriod = (start, end) => (end && end !== start ? `${formatDate(start)}〜${formatDate(end)}` : formatDate(start));

  // 今週のポイント: 集計値を決まった文型に当てはめた文（推測は入れない）
  function highlights(national, {today} = {}) {
    const items = [];
    const start = today || national.markets[0]?.view.dates[0];
    const week = new Set(Array.from({length: 7}, (_, i) => addDays(start, i)));
    // 1) 直近の休前日
    const eves = national.markets.flatMap((item) => item.summary.days.filter((day) => week.has(day.date) && day.nightType === "eve"));
    const nextEve = eves.map((day) => day.date).sort()[0];
    if (nextEve) {
      const rows = national.markets.map((item) => {
        const day = item.summary.days.find((d) => d.date === nextEve);
        return {item, day, ratio: day && day.status !== "none" && item.summary.typical ? day.median / item.summary.typical : null};
      });
      const high = rows.filter((row) => row.ratio !== null && row.ratio >= 1.3).sort((a, b) => b.ratio - a.ratio);
      const soldOut = rows.filter((row) => row.day && row.day.busy);
      if (high.length) {
        const names = high.slice(0, 3).map((row) => `${row.item.name}（代表料金の${row.ratio.toFixed(1)}倍）`).join("、");
        items.push({kind: "eve", date: nextEve, code: high[0].item.code, text: `直近の休前日 ${formatDate(nextEve)}は、${high.length}都市で代表料金の1.3倍以上。高いのは${names}。`});
      } else {
        items.push({kind: "eve", date: nextEve, code: null, text: `直近の休前日 ${formatDate(nextEve)}は、代表料金の1.3倍を超える都市はありません。`});
      }
      if (soldOut.length >= 2) items.push({kind: "eve-busy", date: nextEve, code: soldOut[0].item.code, text: `${formatDate(nextEve)}は${soldOut.map((row) => row.item.name).join("・")}で売り切れが目立ちます。`});
    }
    // 2) 売り切れが目立つ都市が最も多い日（30泊以内、平日を優先して取り上げる）
    const byDate = {};
    for (const item of national.markets) for (const day of item.summary.busy) (byDate[day.date] ||= []).push(item.name);
    const busiest = Object.entries(byDate).filter(([date]) => date !== nextEve).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
    if (busiest && busiest[1].length >= 3) {
      const type = nightType(busiest[0]);
      items.push({kind: "busy", date: busiest[0], code: null, text: `${formatDate(busiest[0])}${type === "weekday" ? "（平日）" : ""}は${busiest[1].length}都市で売り切れが目立ちます（${busiest[1].join("・")}）。`});
    }
    // 3) 最も跳ね上がる日
    const spike = national.markets.flatMap((item) => item.summary.spikes.map((day) => ({item, day}))).sort((a, b) => b.day.ratio - a.day.ratio)[0];
    if (spike) items.push({kind: "spike", date: spike.day.date, code: spike.item.code, text: `いちばん跳ね上がるのは${spike.item.name} ${formatDate(spike.day.date)}：中央値 ${formatYen(spike.day.median)}（代表料金の${spike.day.ratio.toFixed(1)}倍${spike.day.soldOut ? `・${spike.day.soldOut}施設が売り切れ` : ""}）。`});
    // 4) 7日変化
    if (national.weekly.available) items.push({kind: "weekly", code: null, text: `7日前と比べて、値上がり${national.weekly.up}都市・値下がり${national.weekly.down}都市・横ばい${national.weekly.flat}都市。`});
    return items.slice(0, 4);
  }

  function rankings(national) {
    const top = (list, key) => list.filter((item) => typeof item[key] === "number" && Number.isFinite(item[key])).sort((a, b) => b[key] - a[key]).slice(0, RANK_SIZE);
    const volatileMarkets = top(national.markets.map((item) => ({code: item.code, market: item.name, value: item.summary.volatility, low: item.summary.low, high: item.summary.high})), "value");
    const hotels = national.markets.flatMap((item) => item.view.core.map((hotel) => ({code: item.code, market: item.name, ...hotelSummary(hotel)})));
    const volatileHotels = top(hotels.map((hotel) => ({...hotel, value: hotel.volatility})), "value");
    const spikeDays = top(national.markets.flatMap((item) => item.summary.spikes.map((day) => ({code: item.code, market: item.name, date: day.date, median: day.median, typical: item.summary.typical, reference: day.reference, soldOut: day.soldOut, value: day.ratio}))), "value");
    // 売り切れが目立つ日: 販売プランなしの施設数が多い順、同数なら料金が高い順
    const busyDays = national.markets.flatMap((item) => item.summary.busy.map((day) => ({code: item.code, market: item.name, ...day, value: day.soldOut + (day.ratio || 0) / 100})))
      .sort((a, b) => b.value - a.value).slice(0, RANK_SIZE);
    const weeklyHotels = national.markets.flatMap((item) => (item.weekly.hotels || []).map((hotel) => ({code: item.code, market: item.name, ...hotel, value: hotel.change})));
    const risingHotels = top(weeklyHotels.filter((hotel) => hotel.value > 0), "value");
    const risingMarkets = top(national.markets.filter((item) => item.weekly.status === "ok" && item.weekly.change > 0).map((item) => ({code: item.code, market: item.name, value: item.weekly.change, hotelCount: item.weekly.hotelCount})), "value");
    return {volatileMarkets, volatileHotels, spikeDays, busyDays, risingMarkets, risingHotels};
  }

  return {
    WEEKDAYS,
    MEALS,
    SPIKE_RATIO,
    isPrice,
    median,
    medianOfNumbers,
    quantile,
    coefficientOfVariation,
    spreadRatio,
    formatRatio,
    nationalSummary,
    rankings,
    highlights,
    holidayName,
    nightType,
    SOLD_OUT_MIN,
    weekdayIndex,
    addDays,
    formatDate,
    formatYen,
    formatPercent,
    marketView,
    dailyMedians,
    marketSummary,
    calendarClass,
    pricePeriods,
    hotelSummary,
    crossCityBrand,
    weeklyChange,
    stayHistory,
    stayHistories,
    pricePaths,
    TREND_THRESHOLD,
    eventCandidates,
    EVENT_TOP,
    formatPeriod,
  };
});
