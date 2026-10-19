(function () {
  "use strict";

  const M = globalThis.BusinessHotelPriceModel;
  const DATA = "data/business-hotel-price-trends/";
  const $ = (selector) => document.querySelector(selector);
  const state = {cohort: null, manifest: null, latest: null, previous: null, events: null, images: null, eventView: null, market: null, nights: 30, rankTab: "volatileMarkets"};

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
  const yen = M.formatYen;
  const pct = M.formatPercent;
  const PHOTO_HOSTS = ["img.travel.rakuten.co.jp", "trvimg.r10s.jp"];
  const compactYen = (value) => (value >= 10000 ? `${(value / 10000).toFixed(value % 10000 === 0 ? 0 : 1)}万` : value.toLocaleString("ja-JP"));

  // ---------------------------------------------------------------- 読み込み

  async function getJson(path) {
    const response = await fetch(path, {cache: "no-cache"});
    if (!response.ok) {
      const error = new Error(`${path}: HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async function load() {
    show("loading");
    try {
      const [manifest, cohort] = await Promise.all([getJson(`${DATA}manifest.json`), getJson(`${DATA}cohort.json`)]);
      if (!manifest.latest_snapshot || !manifest.snapshots?.length) throw Object.assign(new Error("empty"), {status: 404});
      const latestEntry = manifest.snapshots.find((item) => item.date === manifest.latest_snapshot) || manifest.snapshots[0];
      const previousEntry = manifest.snapshots.find((item) => item.date === M.addDays(latestEntry.date, -7));
      // 催しの候補（AI調べ）と施設写真は無くても表示できるので、読めなければ黙って省く
      const [latest, previous, events, images] = await Promise.all([
        getJson(DATA + latestEntry.file),
        previousEntry ? getJson(DATA + previousEntry.file).catch(() => null) : null,
        getJson(`${DATA}events.json`).catch(() => null),
        getJson(`${DATA}images.json`).catch(() => null),
      ]);
      Object.assign(state, {manifest, cohort, latest, previous, events, images});
      readUrl();
      setupControls();
      show("dashboard");
      render();
    } catch (error) {
      if (error.status === 404) {
        $("#bht-error-title").textContent = "データを準備中です";
        $("#bht-error-message").textContent = "料金の観測を始めたばかりで、まだ表示できるデータがありません。最初の取得が終わると表示されます。";
        $("#bht-freshness").textContent = "データ準備中";
      } else {
        $("#bht-error-title").textContent = "データを表示できませんでした";
        $("#bht-error-message").textContent = "通信状況を確認して、もう一度読み込んでください。";
      }
      show("error");
    }
  }

  function show(which) {
    $("#bht-loading").hidden = which !== "loading";
    $("#bht-error").hidden = which !== "error";
    $("#bht-dashboard").hidden = which !== "dashboard";
  }

  function readUrl() {
    const params = new URLSearchParams(location.search);
    const codes = state.cohort.markets.map((market) => market.code);
    state.market = codes.includes(params.get("market")) ? params.get("market") : codes[0];
    state.nights = params.get("nights") === "60" ? 60 : 30;
  }

  function writeUrl() {
    const params = new URLSearchParams(location.search);
    params.set("market", state.market);
    params.set("nights", String(state.nights));
    history.replaceState(null, "", `${location.pathname}?${params}`);
  }

  function setupControls() {
    const market = $("#bht-market");
    market.innerHTML = state.cohort.markets.map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.name)}（${escapeHtml(item.prefecture)}）</option>`).join("");
    market.value = state.market;
    $("#bht-nights").value = String(state.nights);
    market.onchange = () => selectMarket(market.value);
    $("#bht-nights").onchange = (event) => {
      state.nights = Number(event.target.value);
      render();
    };
  }

  function selectMarket(code, {scroll = false} = {}) {
    state.market = code;
    $("#bht-market").value = code;
    render();
    if (scroll) $("#bht-market-title").scrollIntoView({behavior: "smooth", block: "start"});
  }

  // ---------------------------------------------------------------- 描画

  function render() {
    writeUrl();
    const generated = state.latest.generated_at ? new Intl.DateTimeFormat("ja-JP", {timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"}).format(new Date(state.latest.generated_at)) : "";
    $("#bht-freshness").textContent = `取得日 ${state.latest.snapshot_date}${generated ? `（データ生成 ${generated}）` : ""}／比較施設群 ${state.latest.cohort_version}／大人1名・1室・1泊`;
    const updated = $("#source-updated");
    if (updated) updated.textContent = state.latest.snapshot_date;

    const national = M.nationalSummary(state.cohort, state.latest, state.previous, {nights: state.nights});
    const summaries = national.markets;
    state.eventView = M.eventCandidates(state.events, national);
    renderHighlights(M.highlights(national));
    renderSummary(national);
    renderRankings(M.rankings(national), national);
    renderEvents(state.eventView);
    renderCompare(summaries);
    renderBrand();
    const current = summaries.find((item) => item.view && item.view.code === state.market);
    if (!current || !current.summary) return;
    renderMarket(current);
    renderDaily(current.summary);
    renderWeekday(current.summary);
    renderMeals(current.view);
    renderCalendar(current.summary);
    renderMarketEvents(current.view);
    renderHotels(current.view);
  }

  // ---------------------------------------------------------------- 全国サマリ

  function renderSummary(national) {
    const w = national.weekly;
    const tiles = [
      {label: `${national.marketCount}都市の代表料金`, value: yen(national.typical), note: national.highest && national.lowest ? `最も高い ${national.highest.name} ${yen(national.highest.summary.typical)}／最も安い ${national.lowest.name} ${yen(national.lowest.summary.typical)}` : "", lead: true},
      {label: "休前日の差", value: pct(national.weekendPremium), note: "金・土・祝前日の泊を平日の泊と比べた差（都市の中央値）"},
      {label: "急騰日のある都市", value: `${national.spikeMarkets}都市`, note: `代表料金の${M.SPIKE_RATIO}倍以上の日がある都市（${national.marketCount}都市中）`},
      {label: "売り切れが目立つ日", value: `延べ${national.busyNights}日`, note: `${national.busyMarkets}都市で、COREの${M.SOLD_OUT_MIN}施設以上が楽天で売り切れ`},
      w.available
        ? {label: "7日前より値上がり", value: `${w.up}都市`, note: `値下がり ${w.down}都市・横ばい ${w.flat}都市（比較できた${w.available}都市中）`}
        : {label: "7日前より値上がり", value: "蓄積中", note: "同じ比較施設群で7日前の取得がそろうと表示されます", status: true},
    ];
    $("#bht-summary-meta").textContent = `今日から${state.nights}泊・CORE施設で集計`;
    $("#bht-summary-tiles").innerHTML = tiles.map((tile) => `<article class="bht-kpi${tile.lead ? " bht-kpi--lead" : ""}"><span>${escapeHtml(tile.label)}</span><strong class="${tile.status ? "bht-kpi__status" : ""}">${escapeHtml(tile.value)}</strong><small>${escapeHtml(tile.note)}</small></article>`).join("");
  }

  function renderHighlights(items) {
    const box = $("#bht-highlights");
    if (!items.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    $("#bht-highlight-list").innerHTML = items.map((item) => `<li class="bht-point bht-point--${escapeHtml(item.kind)}">${item.code ? `<button type="button" data-market="${escapeHtml(item.code)}">${escapeHtml(item.text)}<span aria-hidden="true">→</span></button>` : `<span>${escapeHtml(item.text)}</span>`}</li>`).join("");
    box.querySelectorAll("button[data-market]").forEach((button) => button.addEventListener("click", () => selectMarket(button.dataset.market, {scroll: true})));
  }

  const RANK_TABS = [
    {key: "volatileMarkets", label: "値動きが大きい都市"},
    {key: "volatileHotels", label: "値動きが大きい施設"},
    {key: "busyDays", label: "売り切れが目立つ日"},
    {key: "spikeDays", label: "料金が跳ね上がる日"},
    {key: "rising", label: "7日で値上がり"},
  ];

  function rankRows(ranks, key) {
    if (key === "volatileMarkets") return {unit: "ratio", rows: ranks.volatileMarkets.map((row) => ({code: row.code, title: row.market, sub: `宿泊日ごとの中央値 ${yen(row.low)}〜${yen(row.high)}`, value: row.value}))};
    if (key === "volatileHotels") return {unit: "ratio", rows: ranks.volatileHotels.map((row) => ({code: row.code, title: row.name, sub: `${row.market}・${row.area}／最安 ${yen(row.min)}〜最高 ${yen(row.max)}`, value: row.value}))};
    if (key === "spikeDays") return {unit: "ratio", rows: ranks.spikeDays.map((row) => ({code: row.code, event: hasEvent(row.code, row.date), title: `${row.market} ${M.formatDate(row.date)}`, sub: `中央値 ${yen(row.median)}${row.reference ? "（参考）" : ""}・代表料金 ${yen(row.typical)}${row.soldOut ? `・${row.soldOut}施設が売り切れ` : ""}`, value: row.value}))};
    if (key === "busyDays") return {unit: "count", rows: ranks.busyDays.map((row) => ({code: row.code, event: hasEvent(row.code, row.date), title: `${row.market} ${M.formatDate(row.date)}`, sub: row.median ? `残る施設の中央値 ${yen(row.median)}${row.ratio ? `（代表料金の${row.ratio.toFixed(1)}倍）` : ""}` : "残る施設が少なく料金は比べられません", value: row.soldOut, total: row.total}))};
    const markets = ranks.risingMarkets.map((row) => ({code: row.code, title: row.market, sub: `CORE ${row.hotelCount}施設の変化率の中央値`, value: row.value}));
    const hotels = ranks.risingHotels.map((row) => ({code: row.code, title: row.name, sub: `${row.market}・共通の宿泊日 ${row.commonDates}泊`, value: row.value}));
    return {unit: "percent", rows: markets.length ? markets : hotels, hotels};
  }

  function renderRankings(ranks, national) {
    const tabs = $("#bht-rank-tabs");
    tabs.innerHTML = RANK_TABS.map((tab) => `<button type="button" role="tab" id="bht-tab-${tab.key}" aria-controls="bht-rank-panel" aria-selected="${tab.key === state.rankTab}" tabindex="${tab.key === state.rankTab ? 0 : -1}" data-tab="${tab.key}">${escapeHtml(tab.label)}</button>`).join("");
    tabs.querySelectorAll("button").forEach((button, index, all) => {
      button.addEventListener("click", () => {
        state.rankTab = button.dataset.tab;
        renderRankings(ranks, national);
        $(`#bht-tab-${state.rankTab}`).focus();
      });
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const next = all[(index + (event.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
        next.click();
      });
    });
    const panel = $("#bht-rank-panel");
    panel.setAttribute("aria-labelledby", `bht-tab-${state.rankTab}`);
    const {unit, rows, hotels} = rankRows(ranks, state.rankTab);
    if (!rows.length) {
      const message = state.rankTab === "rising"
        ? (national.weekly.available ? "7日前より値上がりした都市・施設はありません。" : "7日前の取得がそろうと表示されます（同じ比較施設群で8日分のデータが必要です）。")
        : state.rankTab === "spikeDays" ? "代表料金の1.5倍以上になる日はありません。"
        : state.rankTab === "busyDays" ? "売り切れが目立つ日はありません。" : "比較できるデータが足りません（10泊以上必要です）。";
      panel.innerHTML = `<p class="bht-empty">${escapeHtml(message)}</p>`;
      return;
    }
    const max = unit === "count" ? Math.max(...rows.map((row) => row.total)) : Math.max(...rows.map((row) => (unit === "ratio" ? row.value - 1 : row.value)));
    const format = (value, row) => (unit === "ratio" ? M.formatRatio(value) : unit === "count" ? `${value}/${row.total}施設` : pct(value));
    const list = rows.map((row, index) => {
      const width = max > 0 ? Math.max(2, ((unit === "ratio" ? row.value - 1 : row.value) / max) * 100) : 0;
      return `<li><button type="button" class="bht-rank" data-market="${escapeHtml(row.code)}">
        <span class="bht-rank__no">${index + 1}</span>
        <span class="bht-rank__name"><strong>${escapeHtml(row.title)}${row.event ? `<em class="bht-tag bht-tag--event">催し候補あり</em>` : ""}</strong><small>${escapeHtml(row.sub)}</small></span>
        <span class="bht-rank__bar" aria-hidden="true"><i style="width:${width.toFixed(1)}%"></i></span>
        <span class="bht-rank__value">${escapeHtml(format(row.value, row))}</span>
      </button></li>`;
    }).join("");
    const extra = state.rankTab === "rising" && hotels && hotels.length && rows !== hotels
      ? `<h3 class="bht-subhead">施設</h3><ol class="bht-rank-list">${hotels.map((row, index) => `<li><button type="button" class="bht-rank" data-market="${escapeHtml(row.code)}"><span class="bht-rank__no">${index + 1}</span><span class="bht-rank__name"><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.sub)}</small></span><span class="bht-rank__bar" aria-hidden="true"><i style="width:${Math.max(2, (row.value / hotels[0].value) * 100).toFixed(1)}%"></i></span><span class="bht-rank__value">${escapeHtml(pct(row.value))}</span></button></li>`).join("")}</ol>`
      : "";
    const heading = state.rankTab === "rising" ? `<h3 class="bht-subhead">都市</h3>` : "";
    panel.innerHTML = `${heading}<ol class="bht-rank-list">${list}</ol>${extra}<p class="bht-note">${escapeHtml(rankNote(state.rankTab))}</p>`;
    panel.querySelectorAll(".bht-rank").forEach((button) => button.addEventListener("click", () => selectMarket(button.dataset.market, {scroll: true})));
  }

  const hasEvent = (code, date) => Boolean(state.eventView && state.eventView.byDay.has(`${code}|${date}`));

  function rankNote(key) {
    const eventNote = state.eventView && state.eventView.items.length ? "「催し候補あり」は、その泊または翌日に催しがある日です（下の「急騰・売り切れの日に重なる催し」）。" : "";
    if (key === "spikeDays") return `宿泊日ごとの中央値（CORE施設）が、その都市の代表料金の何倍か。売り切れで料金を確認できたのが3施設の日も含めます（参考）。${eventNote}`;
    if (key === "busyDays") return `COREのうち、楽天トラベルで大人1名で予約できるプランが無かった施設の数。${M.SOLD_OUT_MIN}施設以上の日を、売り切れが目立つ日としています（楽天での売り切れで、施設全体の満室とは限りません）。${eventNote}`;
    if (key === "rising") return "ちょうど7日前の取得と比べた、同じ宿泊日の料金の変化率（中央値）。";
    return "値動きの大きさ＝高い日は安い日の何倍か（上位1割と下位1割の日を除く）。行を選ぶとその都市に切り替わります。";
  }

  function trendText(weekly) {
    if (weekly.status !== "ok") return {value: "蓄積中", note: weekly.reason};
    const word = weekly.direction === "up" ? "上昇" : weekly.direction === "down" ? "低下" : "横ばい";
    return {value: pct(weekly.change), note: `${word}（${weekly.hotelCount}施設）`, direction: weekly.direction};
  }

  function renderCompare(rows) {
    const head = `<thead><tr><th scope="col">市場</th><th scope="col">代表料金</th><th scope="col">値動きの大きさ</th><th scope="col">休前日の差</th><th scope="col">急騰日</th><th scope="col">売り切れが目立つ日</th><th scope="col">7日変化</th></tr></thead>`;
    const body = rows.map(({view, summary, weekly}) => {
      if (!view || !summary) return "";
      const trend = trendText(weekly);
      const active = view.code === state.market;
      return `<tr class="${active ? "is-active" : ""}" data-market="${escapeHtml(view.code)}">
        <th scope="row"><button type="button" class="bht-market-button" data-market="${escapeHtml(view.code)}" aria-pressed="${active}">${escapeHtml(view.name)}</button></th>
        <td>${summary.typical ? yen(summary.typical) : "—"}</td>
        <td>${M.formatRatio(summary.volatility)}</td>
        <td>${pct(summary.weekendPremium)}</td>
        <td>${summary.validNights ? `${summary.spikes.length}日` : "—"}</td>
        <td>${summary.busy.length}日</td>
        <td class="bht-trend bht-trend--${trend.direction || "none"}"><span>${escapeHtml(trend.value)}</span></td>
      </tr>`;
    }).join("");
    const table = $("#bht-compare");
    table.innerHTML = `<caption class="visually-hidden">10都市の比較（${state.nights}泊）</caption>${head}<tbody>${body}</tbody>`;
    // 7日変化が出せない理由は行ごとに繰り返さず、表の下に1回だけ書く
    const reasons = [...new Set(rows.filter((row) => row.weekly.status !== "ok").map((row) => row.weekly.reason))];
    $("#bht-compare-note").textContent = reasons.length ? `7日変化の「蓄積中」: ${reasons.join("／")}。同じ比較施設群で7日前の取得がそろうと表示されます。` : "";
    table.querySelectorAll(".bht-market-button").forEach((button) => button.addEventListener("click", () => selectMarket(button.dataset.market, {scroll: true})));
  }

  // 都市ごとの同じブランド（cohort.cross_city_brand）: 最安〜最高の線と中央値の点
  function renderBrand() {
    const all = M.crossCityBrand(state.cohort, state.latest, {nights: state.nights});
    const rows = all.filter((row) => row.hotel && row.hotel.median);
    const missing = all.filter((row) => !row.hotel).map((row) => row.market);
    $("#bht-brand-name").textContent = state.cohort.cross_city_brand;
    $("#bht-brand-meta").textContent = `各都市のCOREにある${state.cohort.cross_city_brand}1施設の、期間中の最安〜最高と中央値${missing.length ? `（${missing.join("・")}はCOREに無いため対象外）` : ""}`;
    const chart = $("#bht-brand-chart");
    if (!rows.length) {
      chart.innerHTML = `<p class="bht-empty">比較できるデータがありません</p>`;
      return;
    }
    const width = chartWidth(chart, 860);
    const narrow = width < 560;
    const rowHeight = 34, top = 18, left = narrow ? 60 : 96, right = narrow ? 78 : 112, bottom = 34;
    const height = top + rows.length * rowHeight + bottom;
    const max = niceMax(Math.max(...rows.map((row) => row.hotel.max)));
    const min = niceFloor(Math.min(...rows.map((row) => row.hotel.min)));
    const x = (value) => left + ((value - min) / (max - min)) * (width - left - right);
    const ticks = niceTicks(min, max, 5);
    const grid = ticks.map((tick) => `<line class="bht-grid" x1="${x(tick)}" x2="${x(tick)}" y1="${top - 6}" y2="${height - bottom + 4}"/><text class="bht-axis" x="${x(tick)}" y="${height - 12}" text-anchor="middle">${compactYen(tick)}</text>`).join("");
    const marks = rows.map((row, index) => {
      const y = top + index * rowHeight + rowHeight / 2;
      const active = row.code === state.market;
      const h = row.hotel;
      return `<g class="bht-range${active ? " is-active" : ""}" data-tip="${escapeHtml(`${row.market}｜${h.name}\n中央値 ${yen(h.median)}\n最安 ${yen(h.min)}〜最高 ${yen(h.max)}`)}">
        <rect class="bht-hit" x="0" y="${y - rowHeight / 2}" width="${width}" height="${rowHeight}"/>
        <text class="bht-label" x="${left - 14}" y="${y + 4}" text-anchor="end">${escapeHtml(row.market)}</text>
        <line class="bht-range__line" x1="${x(h.min)}" x2="${x(h.max)}" y1="${y}" y2="${y}"/>
        <circle class="bht-range__dot" cx="${x(h.median)}" cy="${y}" r="5"/>
        <text class="bht-value" x="${width - right + (narrow ? 8 : 14)}" y="${y + 4}">${yen(h.median)}</text>
      </g>`;
    }).join("");
    chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${grid}${marks}</svg>`;
    bindTips(chart, ".bht-range");
    chart.querySelectorAll(".bht-range").forEach((group, index) => group.addEventListener("click", () => selectMarket(rows[index].code, {scroll: true})));
    $("#bht-brand-table").innerHTML = tableTwin("表で見る", ["市場", "施設", "中央値", "最安", "最高"], rows.map((row) => [row.market, row.hotel.name, yen(row.hotel.median), yen(row.hotel.min), yen(row.hotel.max)]));
  }

  function renderMarket({view, summary, weekly}) {
    $("#bht-market-name").textContent = view.name;
    $("#bht-market-meta").textContent = `今日から${state.nights}泊のうち、中央値を出せた${summary.validNights}泊で集計（CORE ${view.core.length}施設）`;
    const trend = trendText(weekly);
    const listDates = (list) => (list.length ? list.slice(0, 3).map((day) => M.formatDate(day.date)).join("、") + (list.length > 3 ? " ほか" : "") : "なし");
    const spikes = listDates(summary.spikes);
    const busy = listDates(summary.busy);
    const kpis = [
      {label: "代表料金", value: summary.typical ? yen(summary.typical) : "—", note: summary.low && summary.high ? `宿泊日ごとの中央値は ${yen(summary.low)}〜${yen(summary.high)}` : "比較データ不足", lead: true},
      {label: "値動きの大きさ", value: M.formatRatio(summary.volatility), note: "高い日は安い日の何倍か（上位・下位1割の日を除く）"},
      {label: "休前日の差", value: pct(summary.weekendPremium), note: "金・土・祝前日の泊を、平日の泊と比べて"},
      {label: "急騰日（1.5倍以上）", value: `${summary.spikes.length}日`, note: spikes},
      {label: "売り切れが目立つ日", value: `${summary.busy.length}日`, note: busy},
      {label: "7日前からの変化", value: trend.value, note: trend.note, status: !trend.direction},
    ];
    $("#bht-kpis").innerHTML = kpis.map((kpi) => `<article class="bht-kpi${kpi.lead ? " bht-kpi--lead" : ""}"><span>${escapeHtml(kpi.label)}</span><strong class="${kpi.status ? "bht-kpi__status" : ""}">${escapeHtml(kpi.value)}</strong><small>${escapeHtml(kpi.note)}</small></article>`).join("");
  }

  // 宿泊日別: 中央値の線（2px）と最安〜最高の帯。金土泊は背景を薄く。急騰日に印。
  function renderDaily(summary) {
    const days = summary.days;
    const chart = $("#bht-daily-chart");
    const width = chartWidth(chart, 960);
    const height = width < 560 ? 280 : 330, top = 24, right = 16, bottom = 46, left = width < 560 ? 44 : 64;
    const values = days.flatMap((day) => [day.min, day.max]).filter(M.isPrice);
    if (!values.length) {
      chart.innerHTML = `<p class="bht-empty">比較データが不足しています</p>`;
      $("#bht-daily-table").innerHTML = "";
      return;
    }
    const max = niceMax(Math.max(...values));
    const min = Math.max(0, niceFloor(Math.min(...values)));
    const step = (width - left - right) / Math.max(1, days.length - 1);
    const x = (index) => left + index * step;
    const y = (value) => top + (1 - (value - min) / (max - min)) * (height - top - bottom);
    const ticks = niceTicks(min, max, 5);
    const grid = ticks.map((tick) => `<line class="bht-grid" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="bht-axis" x="${left - 10}" y="${y(tick) + 4}" text-anchor="end">${compactYen(tick)}</text>`).join("");
    const weekend = days.map((day, index) => {
      if (day.nightType !== "eve") return "";
      const x0 = Math.max(left, x(index) - step / 2);
      const x1 = Math.min(width - right, x(index) + step / 2);
      return `<rect class="bht-weekend" x="${x0}" y="${top}" width="${x1 - x0}" height="${height - top - bottom}"/>`;
    }).join("");
    const fit = Math.max(2, Math.floor((width - left - right) / 72));
    const labelEvery = [1, 2, 3, 7, 14].find((n) => Math.ceil(days.length / n) <= fit) || 14;
    const xLabels = days.map((day, index) => (index % labelEvery === 0 ? `<text class="bht-axis" x="${x(index)}" y="${height - bottom + 20}" text-anchor="middle">${escapeHtml(M.formatDate(day.date).replace("（", " ").replace("）", ""))}</text>` : "")).join("");
    const segments = splitSegments(days);
    const band = segments.map((segment) => `<path class="bht-band" d="M${segment.map((i) => `${x(i)},${y(days[i].max)}`).join("L")}L${segment.slice().reverse().map((i) => `${x(i)},${y(days[i].min)}`).join("L")}Z"/>`).join("");
    const line = segments.map((segment) => (segment.length > 1 ? `<polyline class="bht-line" points="${segment.map((i) => `${x(i)},${y(days[i].median)}`).join(" ")}"/>` : `<circle class="bht-dot" cx="${x(segment[0])}" cy="${y(days[segment[0]].median)}" r="4"/>`)).join("");
    const reference = days.map((day, index) => (day.status === "reference" ? `<circle class="bht-dot bht-dot--reference" cx="${x(index)}" cy="${y(day.median)}" r="4"/>` : "")).join("");
    const spikeSet = new Set(summary.spikes.map((day) => day.date));
    // 連続する急騰日はラベルを1つにまとめ、点だけを並べる
    const spikes = days.map((day, index) => {
      if (!spikeSet.has(day.date)) return "";
      const first = index === 0 || !spikeSet.has(days[index - 1].date);
      const label = first ? `<text class="bht-spike-label" x="${x(index)}" y="${Math.max(top + 10, y(day.median) - 12)}" text-anchor="middle">急騰</text>` : "";
      return `<circle class="bht-dot bht-dot--spike" cx="${x(index)}" cy="${y(day.median)}" r="5"/>${label}`;
    }).join("");
    // 売り切れが目立つ日は、グラフ下端に「売」の印（料金が比べられない日も含む）
    const busyMarks = days.map((day, index) => (day.busy ? `<g class="bht-busy-mark"><rect x="${x(index) - 8}" y="${height - bottom - 18}" width="16" height="16" rx="3"/><text x="${x(index)}" y="${height - bottom - 6}" text-anchor="middle">売</text></g>` : "")).join("");
    const typical = summary.typical ? `<line class="bht-typical" x1="${left}" x2="${width - right}" y1="${y(summary.typical)}" y2="${y(summary.typical)}"/><text class="bht-typical-label" x="${left + 6}" y="${y(summary.typical) + 15}">代表料金 ${yen(summary.typical)}</text>` : "";
    chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${weekend}${grid}${typical}${band}${line}${reference}${spikes}${busyMarks}${xLabels}<line class="bht-crosshair" id="bht-crosshair" x1="${left}" x2="${left}" y1="${top}" y2="${height - bottom}"/></svg>`;
    $("#bht-daily-legend").innerHTML = `<span><i class="bht-key-line"></i>中央値（CORE）</span><span><i class="bht-key-band"></i>最安〜最高</span><span><i class="bht-key-weekend"></i>休前日（金・土・祝前日の泊）</span><span><i class="bht-key-reference"></i>参考値（3施設）</span><span><i class="bht-key-busy">売</i>売り切れが目立つ日</span>`;
    bindCrosshair(chart, days, x, step, (day) => {
      const tag = [day.holiday, day.eveOf ? `${day.eveOf}の前日` : ""].filter(Boolean).join("・");
      const sold = day.soldOut ? `\n楽天で売り切れ ${day.soldOut}/${day.total}施設${day.busy ? "（売り切れが目立つ日）" : ""}` : "";
      if (day.status === "none") return `${M.formatDate(day.date)}${tag ? ` ${tag}` : ""}\n比較データ不足（料金確認 ${day.count}/${day.total}施設）${sold}`;
      return `${yen(day.median)}\n${M.formatDate(day.date)}${tag ? ` ${tag}` : ""}・中央値${day.status === "reference" ? "（参考）" : ""}\n最安 ${yen(day.min)}〜最高 ${yen(day.max)}\n料金確認 ${day.count}/${day.total}施設${sold}`;
    });
    $("#bht-daily-table").innerHTML = tableTwin("表で見る", ["宿泊日", "中央値", "最安", "最高", "料金確認", "売り切れ"], days.map((day) => [`${M.formatDate(day.date)}${day.holiday ? ` ${day.holiday}` : ""}`, day.status === "none" ? "—" : `${yen(day.median)}${day.status === "reference" ? "（参考）" : ""}`, yen(day.min), yen(day.max), `${day.count}/${day.total}`, `${day.soldOut}/${day.total}${day.busy ? "（目立つ）" : ""}`]));
  }

  function splitSegments(days) {
    const segments = [];
    let current = [];
    days.forEach((day, index) => {
      if (day.status === "none") {
        if (current.length) segments.push(current);
        current = [];
      } else current.push(index);
    });
    if (current.length) segments.push(current);
    return segments;
  }

  // 曜日別: 代表料金との差（%）。0を基準に上下へ伸びる1系列の棒。
  function renderWeekday(summary) {
    const order = [1, 2, 3, 4, 5, 6, 0];
    const rows = order.map((weekday) => summary.weekdays.find((item) => item.weekday === weekday));
    const width = chartWidth($("#bht-weekday-chart"), 460);
    const height = 260, top = 26, bottom = 40, left = 44, right = 12;
    const limit = Math.max(10, ...rows.map((row) => Math.abs(row.index || 0)));
    const scale = Math.ceil(limit / 10) * 10;
    const zero = top + (height - top - bottom) / 2;
    const y = (value) => zero - (value / scale) * ((height - top - bottom) / 2);
    const band = (width - left - right) / rows.length;
    const barWidth = Math.min(24, band * 0.5);
    const grid = [-scale, 0, scale].map((tick) => `<line class="${tick === 0 ? "bht-baseline" : "bht-grid"}" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="bht-axis" x="${left - 8}" y="${y(tick) + 4}" text-anchor="end">${tick > 0 ? "+" : ""}${tick}%</text>`).join("");
    const bars = rows.map((row, index) => {
      const cx = left + band * index + band / 2;
      const label = `<text class="bht-axis" x="${cx}" y="${height - 14}" text-anchor="middle">${row.label}</text>`;
      if (row.index === null) return `${label}<text class="bht-muted" x="${cx}" y="${zero - 6}" text-anchor="middle">—</text>`;
      const top0 = Math.min(y(row.index), zero);
      const h = Math.max(1, Math.abs(y(row.index) - zero));
      const up = row.index >= 0;
      const path = roundedBar(cx - barWidth / 2, top0, barWidth, h, up);
      const valueY = up ? top0 - 6 : top0 + h + 14;
      return `<g class="bht-bar" tabindex="0" data-tip="${escapeHtml(`${pct(row.index)}\n${row.label}曜泊・中央値 ${yen(row.median)}（${row.nights}泊）`)}"><rect class="bht-hit" x="${cx - band / 2}" y="${top}" width="${band}" height="${height - top - bottom}"/><path d="${path}"/><text class="bht-value" x="${cx}" y="${valueY}" text-anchor="middle">${pct(row.index, {digits: 0})}</text></g>${label}`;
    }).join("");
    $("#bht-weekday-chart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${grid}${bars}</svg>`;
    bindTips($("#bht-weekday-chart"), ".bht-bar");
    $("#bht-weekday-table").innerHTML = tableTwin("表で見る", ["曜日（泊）", "代表料金との差", "中央値", "泊数"], rows.map((row) => [`${row.label}曜`, pct(row.index), yen(row.median), `${row.nights}泊`]));
  }

  // 棒の先端だけ4pxの角丸、基準線側は四角
  function roundedBar(x, y, w, h, up) {
    const r = Math.min(4, h, w / 2);
    if (up) return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
    return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
  }

  function renderMeals(view) {
    const counts = {R: 0, B: 0, D: 0, T: 0};
    let missing = 0;
    view.core.forEach((hotel) => hotel.meals.forEach((code) => {
      if (code in counts) counts[code] += 1;
      else missing += 1;
    }));
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const rows = Object.entries(counts).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
    const bars = rows.map(([code, count]) => {
      const share = total ? (count / total) * 100 : 0;
      return `<div class="bht-meal"><span>${escapeHtml(M.MEALS[code])}</span><div class="bht-meal__track"><i style="width:${share.toFixed(1)}%"></i></div><strong>${share.toFixed(0)}%</strong></div>`;
    }).join("");
    const byHotel = view.core.map((hotel) => {
      const summary = M.hotelSummary(hotel);
      return summary.leadingMeal ? `<li><span>${escapeHtml(hotel.name)}</span><small>${escapeHtml(summary.leadingMeal.label)} ${summary.leadingMeal.share.toFixed(0)}%</small></li>` : `<li><span>${escapeHtml(hotel.name)}</span><small>—</small></li>`;
    }).join("");
    $("#bht-meals").innerHTML = total
      ? `${bars}<p class="bht-note">料金を確認できた${total}件（CORE ${view.core.length}施設×${view.dates.length}泊のうち）。販売プランなし・取得エラーは${missing}件。</p><h3 class="bht-subhead">施設ごとに多い区分</h3><ul class="bht-meal-hotels">${byHotel}</ul>`
      : `<p class="bht-empty">料金を確認できた日がありません</p>`;
  }

  // 月曜はじまりの週カレンダー
  function renderCalendar(summary) {
    const days = summary.days;
    const lead = (days[0].weekday + 6) % 7;
    const blanks = Array.from({length: lead}, () => `<div class="bht-cal bht-cal--blank" aria-hidden="true"></div>`).join("");
    const heads = ["月", "火", "水", "木", "金", "土", "日"].map((label) => `<div class="bht-cal-head" aria-hidden="true">${label}</div>`).join("");
    const cells = days.map((day) => {
      const cls = M.calendarClass(day, summary.typical);
      const diff = day.status !== "none" && summary.typical ? (day.median / summary.typical - 1) * 100 : null;
      const [, month, date] = day.date.split("-").map(Number);
      const tags = [];
      if (cls === "spike") tags.push(`<em class="bht-tag bht-tag--spike">急騰</em>`);
      if (day.busy) tags.push(`<em class="bht-tag bht-tag--busy">売切${day.soldOut}</em>`);
      // 「催し」は催しの開催日に付ける（前泊の夜には付けない）
      const held = (state.eventView?.byMarket.get(state.market) || []).filter((event) => event.start <= day.date && day.date <= event.end);
      if (held.length) tags.push(`<em class="bht-tag bht-tag--event">催し</em>`);
      if (!tags.length && day.status === "reference") tags.push(`<em class="bht-tag bht-tag--ref">参考</em>`);
      const holiday = day.holiday ? `<span class="bht-cal__holiday">祝</span>` : day.eveOf && day.weekday !== 5 && day.weekday !== 6 ? `<span class="bht-cal__holiday bht-cal__holiday--eve">祝前</span>` : "";
      const label = `${M.formatDate(day.date)}${day.holiday ? ` ${day.holiday}` : ""}${day.eveOf ? ` ${day.eveOf}の前日` : ""} ${day.status === "none" ? "比較データ不足" : `${yen(day.median)} 代表料金比 ${pct(diff)}`}${day.status === "reference" ? "（参考値）" : ""}${cls === "spike" ? " 急騰" : ""}${day.busy ? ` 楽天で売り切れ${day.soldOut}施設` : ""}${held.length ? ` 催し ${held.map((event) => event.name).join("、")}` : ""}`;
      return `<div class="bht-cal bht-cal--${cls}${day.status === "reference" ? " bht-cal--reference" : ""}${day.busy ? " bht-cal--busy" : ""}" role="listitem" aria-label="${escapeHtml(label)}">
        <time datetime="${day.date}">${date === 1 || day === days[0] ? `${month}/` : ""}${date}${holiday}</time>
        ${day.status === "none" ? `<span class="bht-cal__price">—</span><span class="bht-cal__diff bht-cal__na">${day.busy ? "比較不可" : ""}</span>` : `<strong class="bht-cal__price">${yen(day.median)}</strong><span class="bht-cal__diff">${pct(diff, {digits: 0})}</span>`}
        ${tags.length ? `<span class="bht-cal__tags">${tags.join("")}</span>` : ""}
      </div>`;
    }).join("");
    $("#bht-calendar").innerHTML = `${heads}<div class="bht-cal-grid" role="list">${blanks}${cells}</div>`;
  }

  // ---------------------------------------------------------------- 催しの候補（AI調べ・参考）

  const hostOf = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (error) {
      return "";
    }
  };

  const CATEGORY = {concert: "公演", sports: "スポーツ", marathon: "マラソン", convention: "学会・大会", trade_show: "見本市", festival: "祭り", exam: "試験"};

  const sourceLinks = (event) => event.sources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(hostOf(source.url) || "出典")}</a>`).join("・");
  const eventMeta = (event) => [M.formatPeriod(event.start, event.end), event.venue].filter(Boolean).map(escapeHtml).join("／");
  const nightText = (night) => `${M.formatDate(night.date)}${[night.spike ? "急騰" : "", night.busy ? `売切${night.soldOut}` : ""].filter(Boolean).map((t) => ` ${t}`).join("")}`;

  function eventCard(event) {
    return `<article class="bht-event">
      <header><button type="button" class="bht-event__market" data-market="${escapeHtml(event.market)}">${escapeHtml(event.marketName)}<span aria-hidden="true">→</span></button><em class="bht-event__kind">${escapeHtml(CATEGORY[event.category] || "催し")}</em></header>
      <strong class="bht-event__name">${escapeHtml(event.name)}</strong>
      <span class="bht-event__meta">${eventMeta(event)}</span>
      ${event.note ? `<small class="bht-event__meta">${escapeHtml(event.note)}</small>` : ""}
      <p class="bht-event__nights"><span>重なる泊</span>${event.nights.map((night) => escapeHtml(nightText(night))).join("、")}</p>
      <span class="bht-event__src">出典：${sourceLinks(event)}</span>
    </article>`;
  }

  function researchedText(view) {
    return view.researchedOn ? `調べた日 ${view.researchedOn}（週1回更新）` : "";
  }

  function renderEvents(view) {
    const box = $("#bht-events");
    if (!view.available) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const top = view.items.slice(0, M.EVENT_TOP);
    const rest = view.items.slice(M.EVENT_TOP);
    $("#bht-events-list").innerHTML = view.items.length
      ? `<div class="bht-event-list">${top.map(eventCard).join("")}</div>${rest.length ? `<details class="bht-event-more"><summary>ほかの${rest.length}件を見る</summary><div class="bht-event-list">${rest.map(eventCard).join("")}</div></details>` : ""}`
      : `<p class="bht-empty">表示中の期間では、急騰日・売り切れが目立つ日に重なる催しは見つかっていません。</p>`;
    $("#bht-events-meta").textContent = `10都市の向こう2か月の催し${view.total}件のうち、表示中の期間の急騰日・売り切れが目立つ日に重なる${view.items.length}件。売り切れと料金の跳ね上がりが大きい順。${researchedText(view)}`;
    box.querySelectorAll("button[data-market]").forEach((button) => button.addEventListener("click", () => selectMarket(button.dataset.market, {scroll: true})));
  }

  function renderMarketEvents(view) {
    const box = $("#bht-market-events");
    if (!state.eventView || !state.eventView.available) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const events = (state.eventView.byMarket.get(view.code) || []).slice().sort((a, b) => (a.start < b.start ? -1 : 1));
    $("#bht-market-events-meta").textContent = researchedText(state.eventView);
    $("#bht-market-events-list").innerHTML = events.length
      ? `<ul class="bht-event-rows">${events.map((event) => `<li class="${event.nights.length ? "is-matched" : ""}">
          <span class="bht-event-rows__date">${escapeHtml(M.formatPeriod(event.start, event.end))}</span>
          <span class="bht-event-rows__body"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(CATEGORY[event.category] || "催し")}・${escapeHtml(event.venue || "")}${event.note ? `・${escapeHtml(event.note)}` : ""}</small>
          ${event.nights.length ? `<em class="bht-tag bht-tag--event">急騰・売り切れの泊に重なる</em>` : ""}<span class="bht-event__src">出典：${sourceLinks(event)}</span></span>
        </li>`).join("")}</ul>`
      : `<p class="bht-empty">向こう2か月で、遠方から人が集まる大きな催しは見つかりませんでした。</p>`;
  }

  // 楽天の画像サーバーの URL だけを使う（画像は保存・加工しない）
  function photoUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && PHOTO_HOSTS.includes(url.hostname) ? url.href : null;
    } catch {
      return null;
    }
  }

  function hotelPhoto(hotelNo) {
    const image = state.images?.hotels?.[hotelNo]?.image;
    const src = photoUrl(image?.thumbnail_url) || photoUrl(image?.url);
    return src ? {src} : null;
  }

  function renderHotels(view) {
    const photos = new Map([...view.core, ...view.backup].map((hotel) => [hotel.hotel_no, hotelPhoto(hotel.hotel_no)]));
    const withPhotos = [...photos.values()].some(Boolean);
    const row = (hotel) => {
      const s = M.hotelSummary(hotel);
      const url = `https://travel.rakuten.co.jp/HOTEL/${encodeURIComponent(hotel.hotel_no)}/`;
      const image = photos.get(hotel.hotel_no);
      const photo = !withPhotos ? ""
        : image ? `<a class="bht-hotel__photo" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(hotel.name)}を楽天トラベルで見る（新しいタブ）"><img src="${escapeHtml(image.src)}" alt="${escapeHtml(hotel.name)}の写真" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>`
        : `<span class="bht-hotel__photo bht-hotel__photo--empty" aria-hidden="true">写真なし</span>`;
      return `<tr><th scope="row"><div class="bht-hotel">${photo}<div><a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(hotel.name)}</a><small>${escapeHtml(hotel.area)}・${escapeHtml(hotel.access)}・${hotel.rooms}室</small></div></div></th>
        <td>${yen(s.median)}</td><td>${s.min ? `${yen(s.min)}〜${yen(s.max)}` : "—"}</td><td>${M.formatRatio(s.volatility)}</td>
        <td>${s.leadingMeal ? `${escapeHtml(s.leadingMeal.label)}<small>${s.leadingMeal.share.toFixed(0)}%</small>` : "—"}</td><td>${s.noPlanNights}泊</td></tr>`;
    };
    const head = `<thead><tr><th scope="col">施設</th><th scope="col">中央値</th><th scope="col">最安〜最高</th><th scope="col">値動きの大きさ</th><th scope="col">最安プランの食事</th><th scope="col">販売プランなし</th></tr></thead>`;
    $("#bht-hotels").innerHTML = `${head}<tbody><tr class="bht-group"><th colspan="6" scope="rowgroup">CORE（集計に使う${view.core.length}施設）</th></tr>${view.core.map(row).join("")}</tbody><tbody class="bht-backup"><tr class="bht-group"><th colspan="6" scope="rowgroup">BACKUP（観測のみ・集計には使わない）</th></tr>${view.backup.map(row).join("")}</tbody>`;
    $("#bht-hotels-meta").textContent = `今日から${state.nights}泊の料金（大人1名・1室・1泊）。施設名${withPhotos ? "と写真" : ""}は楽天トラベルの施設ページへのリンクです。`;
    $("#bht-photo-credit").hidden = !withPhotos;
  }

  // ---------------------------------------------------------------- 補助

  // グラフは表示幅に合わせて描き直す（文字の大きさを保つため、縮小表示はしない）
  function chartWidth(element, fallback) {
    const width = Math.round(element.clientWidth || 0);
    return width >= 280 ? width : fallback;
  }

  let lastWidth = window.innerWidth;
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth || !state.latest) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
  });

  function tableTwin(summary, headers, rows) {
    const head = headers.map((cell) => `<th scope="col">${escapeHtml(cell)}</th>`).join("");
    const body = rows.map((cells) => `<tr>${cells.map((cell, index) => (index === 0 ? `<th scope="row">${escapeHtml(cell)}</th>` : `<td>${escapeHtml(cell)}</td>`)).join("")}</tr>`).join("");
    return `<details><summary>${escapeHtml(summary)}</summary><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></details>`;
  }

  function niceStep(range, count) {
    const raw = range / count;
    const power = 10 ** Math.floor(Math.log10(raw));
    const unit = [1, 2, 2.5, 5, 10].find((n) => n * power >= raw) * power;
    return unit;
  }
  function niceMax(value) {
    const step = niceStep(value, 5);
    return Math.ceil(value / step) * step;
  }
  function niceFloor(value) {
    const step = niceStep(value, 5);
    return Math.floor((value * 0.85) / step) * step;
  }
  function niceTicks(min, max, count) {
    const step = niceStep(max - min, count);
    const ticks = [];
    for (let value = Math.ceil(min / step) * step; value <= max + 1e-9; value += step) ticks.push(Math.round(value));
    return ticks;
  }

  const tooltip = () => $("#bht-tooltip");
  function showTip(text, clientX, clientY) {
    const tip = tooltip();
    const [first, ...rest] = text.split("\n");
    tip.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = first;
    tip.append(strong);
    rest.forEach((line) => {
      const span = document.createElement("span");
      span.textContent = line;
      tip.append(span);
    });
    tip.hidden = false;
    const box = tip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - box.width - 12, Math.max(12, clientX + 14));
    const top = clientY - box.height - 14 < 8 ? clientY + 18 : clientY - box.height - 14;
    tip.style.transform = `translate(${left}px, ${top}px)`;
  }
  function hideTip() {
    tooltip().hidden = true;
  }

  function bindTips(container, selector) {
    container.querySelectorAll(selector).forEach((mark) => {
      mark.addEventListener("pointermove", (event) => showTip(mark.dataset.tip, event.clientX, event.clientY));
      mark.addEventListener("pointerleave", hideTip);
      mark.addEventListener("focus", () => {
        const box = mark.getBoundingClientRect();
        showTip(mark.dataset.tip, box.left + box.width / 2, box.top);
      });
      mark.addEventListener("blur", hideTip);
    });
  }

  function bindCrosshair(chart, days, x, step, format) {
    const svg = chart.querySelector("svg");
    const line = svg.querySelector("#bht-crosshair");
    let current = null;
    const place = (index, clientX, clientY) => {
      current = Math.max(0, Math.min(days.length - 1, index));
      const pos = x(current);
      line.setAttribute("x1", pos);
      line.setAttribute("x2", pos);
      line.classList.add("is-visible");
      if (clientX === undefined) {
        const rect = svg.getBoundingClientRect();
        const scale = rect.width / svg.viewBox.baseVal.width;
        clientX = rect.left + pos * scale;
        clientY = rect.top + 30;
      }
      showTip(format(days[current]), clientX, clientY);
    };
    svg.addEventListener("pointermove", (event) => {
      const rect = svg.getBoundingClientRect();
      const scale = svg.viewBox.baseVal.width / rect.width;
      const local = (event.clientX - rect.left) * scale;
      place(Math.round((local - x(0)) / step), event.clientX, event.clientY);
    });
    svg.addEventListener("pointerleave", () => {
      line.classList.remove("is-visible");
      hideTip();
    });
    chart.onkeydown = (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      place(current === null ? 0 : current + (event.key === "ArrowRight" ? 1 : -1));
    };
    chart.onblur = () => {
      line.classList.remove("is-visible");
      hideTip();
    };
  }

  $("#bht-retry").addEventListener("click", load);
  load();
})();
