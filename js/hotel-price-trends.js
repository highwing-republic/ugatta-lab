(() => {
  "use strict";

  const DATA_ROOT = "data/hotel-price-trends/";
  const MEAL_LABELS = {two_meals: "朝夕食付き", breakfast: "朝食付き", room_only: "素泊まり"};
  const TREND_MEAL = "two_meals";
  const RATING_LABELS = {service:"サービス",location:"立地",room:"部屋",equipment:"設備",bath:"風呂",breakfast:"朝食",dinner:"夕食",cleanliness:"清潔さ"};
  const COVERAGE_LABELS = {valid: "比較可能", reference: "参考", insufficient: "比較データ不足"};
  // Approximate market centres [lat, lon] for the simplified observed-markets map.
  const MARKET_LOCATIONS = {
    "noboribetsu-onsen": [42.49, 141.15], "atami": [35.10, 139.07], "karuizawa-saku-komoro": [36.35, 138.60],
    "hakuba": [36.70, 137.86], "kaga-onsenkyo": [36.30, 136.33], "gero-onsen": [35.81, 137.24],
    "ise-shima": [34.45, 136.85], "beppu": [33.28, 131.49], "kirishima": [31.87, 130.85],
    "jozankei-onsen": [42.97, 141.17], "akiu-onsen": [38.22, 140.66], "kusatsu-onsen": [36.62, 138.60],
    "takayama": [36.14, 137.25], "kamisuwa-onsen": [36.05, 138.12], "hakone": [35.23, 139.11],
    "kinosaki-onsen": [35.63, 134.81], "tamatsukuri-onsen": [35.42, 133.01], "arima-onsen": [34.80, 135.25],
    "dogo-onsen": [33.85, 132.79], "yufuin": [33.26, 131.36], "unzen-onsen": [32.74, 130.26],
    "ibusuki-onsen": [31.24, 130.64], "yakushima": [30.35, 130.52]
  };
  // Coastline and prefecture borders come from js/japan-map-data.js (Natural Earth, public domain).
  const JAPAN_MAP = window.HotelPriceJapanMap;
  const PHOTO_CREDIT = "写真：楽天トラベル";
  const model = window.HotelPriceTrendsModel;
  const elements = {
    region: document.querySelector("#hpt-region"), hotel: document.querySelector("#hpt-hotel"),
    stayDate: document.querySelector("#hpt-stay-date"), meal: document.querySelector("#hpt-meal"),
    loading: document.querySelector("#hpt-loading"), error: document.querySelector("#hpt-error"),
    errorMessage: document.querySelector("#hpt-error-message"), retry: document.querySelector("#hpt-retry"),
    dashboard: document.querySelector("#hpt-dashboard"), freshness: document.querySelector("#hpt-freshness"),
    priceDetail: document.querySelector("#hpt-detail-price")
  };
  let manifest;
  let latest;
  let trendHistory = null;
  let profileData = {properties: []};
  let profilesByHotel = new Map();
  let regions = [];
  // stay_date is only written back to the URL once it was shared in or chosen in the detail view.
  let stayDateExplicit = false;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
  const yen = (value) => model.isFinitePositive(value) ? `¥${Number(value).toLocaleString("ja-JP")}` : "料金未確認";
  const pct = (value) => model.signedPercent(value);
  const ratingMedian = (values) => rawQuantile(values, .5);
  function rawQuantile(values, q) {
    const sorted = values.filter((value) => value != null).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const position = (sorted.length - 1) * q;
    const base = Math.floor(position);
    const rest = position - base;
    return sorted[base] + (sorted[base + 1] == null ? 0 : rest * (sorted[base + 1] - sorted[base]));
  }
  function dayDiff(later, earlier) {
    return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86400000);
  }
  async function getJson(path) {
    const response = await fetch(path, {cache: "no-cache"});
    if (!response.ok) throw new Error(`データ取得に失敗しました（${response.status}）`);
    return response.json();
  }
  function regionFrom(snapshot, code) { return snapshot.regions.find((region) => region.code === code); }
  function selectedRegion() { return regionFrom(latest, elements.region.value); }
  function selectedProperties() { return model.cohortMetadata(selectedRegion()).properties; }
  function selectedProfile() { return profilesByHotel.get(Number(elements.hotel.value)) || null; }
  function summarize(snapshot, regionCode, stayDate, mealType) {
    return model.summarize(snapshot, regionCode, stayDate, mealType);
  }
  function syncUrl() {
    const params = new URLSearchParams({region: elements.region.value, hotel_no: elements.hotel.value});
    if (stayDateExplicit && elements.stayDate.value) params.set("stay_date", elements.stayDate.value);
    params.set("meal_type", elements.meal.value);
    window.history.replaceState(null, "", `${location.pathname}?${params}`);
  }
  function populateControls() {
    const params = new URLSearchParams(location.search);
    regions = model.selectableRegions(manifest, latest);
    if (!regions.length) throw new Error("表示可能な市場データがありません");
    elements.region.innerHTML = regions.map((region) => `<option value="${escapeHtml(region.code)}">${escapeHtml(region.name)}</option>`).join("");
    if (params.get("region") && regions.some((region) => region.code === params.get("region"))) elements.region.value = params.get("region");
    populateHotels(params.get("hotel_no"));
    stayDateExplicit = populateDates(params.get("stay_date"));
    if (stayDateExplicit) elements.priceDetail.open = true;
    if (params.get("meal_type") && MEAL_LABELS[params.get("meal_type")]) elements.meal.value = params.get("meal_type");
  }
  function populateHotels(preferred) {
    const properties = selectedProperties();
    elements.hotel.innerHTML = properties.map((property) => `<option value="${property.hotel_no}">${escapeHtml(property.name)}</option>`).join("");
    if (preferred && properties.some((property) => String(property.hotel_no) === String(preferred))) elements.hotel.value = String(preferred);
  }
  // Returns whether the preferred stay date was available and selected.
  function populateDates(preferred) {
    const region = selectedRegion();
    const dates = [...new Set(region.rates.map((row) => row.stay_date))].sort();
    elements.stayDate.innerHTML = dates.length ? dates.map((value) => `<option value="${value}">${escapeHtml(formatDate(value))}</option>`).join("") : '<option value="">取得開始前</option>';
    if (preferred && dates.includes(preferred)) { elements.stayDate.value = preferred; return true; }
    return false;
  }
  function formatDate(value) {
    return model.formatJapaneseDate(value);
  }
  function formatGeneratedAt(value) {
    if (!value || !/(Z|[+-]\d\d:\d\d)$/.test(value) || Number.isNaN(Date.parse(value))) return null;
    return new Intl.DateTimeFormat("ja-JP", {timeZone:"Asia/Tokyo", year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(value));
  }

  function chartWidth(container, fallback) {
    return Math.round(container?.clientWidth || 0) || fallback;
  }
  function polylines(points, x, y, className) {
    return model.trendSegments(points).map((segment) => segment.length === 1 ? "" :
      `<polyline class="${className}" points="${segment.map((point) => `${x(point.index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ")}"/>`).join("");
  }
  function directionBadge(direction) {
    return direction ? `<span class="hpt-direction hpt-direction--${escapeHtml(direction.code)}">${escapeHtml(direction.label)}</span>` : "";
  }
  function renderMarketTrend(view) {
    const region = selectedRegion();
    const chart = document.querySelector("#hpt-market-chart");
    const market = view.market;
    const usable = market.status !== "insufficient";
    const statusLabel = view.accumulating ? "データ蓄積中" : "比較データ不足";
    document.querySelector("#hpt-trend-market-name").textContent = region.name;
    document.querySelector("#hpt-market-trend").dataset.coverage = market.status;
    const coverage = `比較可能 ${market.validCount}/${market.expectedCount}施設`;
    document.querySelector("#hpt-trend-result").innerHTML = usable
      ? `<span class="hpt-trend-result__label">7日前比${market.status === "reference" ? '<em class="hpt-reference-badge">参考</em>' : ""}</span><strong class="hpt-trend-result__value">${escapeHtml(pct(market.changePct))}</strong><span class="hpt-trend-result__meta">${directionBadge(market.direction)}<small>${escapeHtml(coverage)}</small></span>`
      : `<span class="hpt-trend-result__label">7日前比</span><strong class="hpt-trend-result__value hpt-trend-result__value--status">${statusLabel}</strong><span class="hpt-trend-result__meta"><small>${escapeHtml(coverage)}</small></span>`;

    const width = chartWidth(chart, 900);
    const narrow = width < 560;
    const height = narrow ? 240 : 300;
    const left = narrow ? 40 : 54, right = narrow ? 14 : 26, top = 26, bottom = 40;
    const axis = model.trendAxis(market.points.map((point) => point.value));
    const x = (index) => left + index * ((width - left - right) / (model.DAILY_TREND_LABELS.length - 1));
    const y = (value) => top + (axis.max - value) * ((height - top - bottom) / (axis.max - axis.min));
    const last = model.DAILY_TREND_LABELS.length - 1;
    const grid = axis.ticks.map((value) => `<line class="${value === 0 ? "hpt-mt-zero" : "hpt-mt-grid"}" x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"/><text class="hpt-mt-axis" x="${left - 8}" y="${y(value) + 4}" text-anchor="end">${value > 0 ? "+" : ""}${value}%</text>`).join("");
    const days = model.DAILY_TREND_LABELS.map((label, index) => `<text class="hpt-mt-axis${index === last ? " hpt-mt-axis--today" : ""}" x="${x(index)}" y="${height - 14}" text-anchor="middle">${label}</text>`).join("");
    let body = "";
    if (usable) {
      const segments = model.trendSegments(market.points);
      const area = segments.filter((segment) => segment.length > 1).map((segment) => `<polygon class="hpt-mt-area" points="${x(segment[0].index)},${y(axis.min)} ${segment.map((point) => `${x(point.index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ")} ${x(segment.at(-1).index)},${y(axis.min)}"/>`).join("");
      const dots = market.points.map((point, index) => point.value == null ? "" : `<circle class="hpt-mt-dot${index === last ? " hpt-mt-dot--today" : ""}" cx="${x(index)}" cy="${y(point.value)}" r="${index === last ? 6 : 4.5}" data-point="${index + 1}"><title>${escapeHtml(point.label)} ${escapeHtml(pct(point.value))}</title></circle>`).join("");
      const values = market.points.map((point, index) => point.value == null || (narrow && index !== last && index !== 0) ? "" : `<text class="hpt-mt-value${index === last ? " hpt-mt-value--today" : ""}" x="${x(index)}" y="${y(point.value) - 13}" text-anchor="middle">${escapeHtml(pct(point.value))}</text>`).join("");
      body = `${area}${polylines(market.points, x, y, "hpt-mt-shadow")}${polylines(market.points, x, y, "hpt-mt-line")}${dots}${values}`;
    }
    const empty = usable ? "" : `<p class="hpt-mt-empty"><strong>${statusLabel}</strong>${escapeHtml(view.reasonText)}${view.accumulating ? "" : "<br>不足している日を0%として線は描きません。"}</p>`;
    chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${grid}${days}${body}</svg>${empty}`;
    chart.setAttribute("aria-label", usable
      ? `${region.name}の7日前から今日までの8点の日次変化率。${market.points.map((point) => `${point.label} ${point.value == null ? "データなし" : pct(point.value)}`).join("、")}`
      : `${region.name}の7日間の値動きは${statusLabel}のため表示しません。`);

    const captions = [`<span>${escapeHtml(coverage)}${market.status === "reference" ? "（参考値）" : ""}</span>`, `<span>条件：大人2名・1室・1泊・${MEAL_LABELS[TREND_MEAL]}</span>`];
    if (elements.meal.value !== TREND_MEAL) captions.push(`<span class="hpt-trend-caption__note">7日トレンドは${MEAL_LABELS[TREND_MEAL]}で集計しています。選択中の${MEAL_LABELS[elements.meal.value]}は「料金を詳しく見る」に反映されます。</span>`);
    document.querySelector("#hpt-trend-caption").innerHTML = captions.join("");
    document.querySelector("#hpt-market-table").innerHTML = usable ? `<details><summary>値動きを表で確認</summary><table><thead><tr><th>観測日</th><th>7日前比</th></tr></thead><tbody>${market.points.map((point) => `<tr><td>${escapeHtml(point.label)}${point.snapshotDate ? `（${escapeHtml(formatDate(point.snapshotDate))}）` : ""}</td><td>${point.value == null ? "データなし" : escapeHtml(pct(point.value))}</td></tr>`).join("")}</tbody></table></details>` : "";
  }

  function renderCoreFacilities(view) {
    const list = document.querySelector("#hpt-core-list");
    const selectedNo = Number(elements.hotel.value);
    const images = view.facilities.map((facility) => facilityImage(facility.hotel_no));
    const withPhotos = images.some(Boolean);
    list.classList.toggle("hpt-core-list--photos", withPhotos);
    list.innerHTML = view.facilities.map((facility, index) => {
      const image = images[index];
      const photo = !withPhotos ? "" : image ? photoLink(image, "hpt-core-row__photo", "thumbnail") : '<span class="hpt-core-row__photo hpt-core-row__photo--empty" aria-hidden="true">写真なし</span>';
      const selected = facility.hotel_no === selectedNo;
      const usable = facility.coverage !== "insufficient";
      const coverageText = facility.coverage === "insufficient"
        ? view.accumulating ? "7日前の観測を蓄積中" : `比較データ不足（共通宿泊日 ${facility.commonStayDates}泊）`
        : `${COVERAGE_LABELS[facility.coverage]} ${facility.commonStayDates}宿泊日`;
      return `<article class="hpt-core-row${selected ? " hpt-core-row--selected" : ""} hpt-core-row--${facility.coverage}" data-hotel-no="${facility.hotel_no}" data-coverage="${facility.coverage}">
        <div class="hpt-core-row__name"><span class="hpt-core-row__index">${index + 1}</span>${photo}<div><strong>${escapeHtml(facility.name)}</strong><small>${selected ? "選択施設 / CORE" : "CORE"}</small></div></div>
        <div class="hpt-core-row__spark"><div class="hpt-spark" data-spark-index="${index}"></div><div class="hpt-spark-axis" aria-hidden="true"><span>7日前</span><span>今日</span></div></div>
        <div class="hpt-core-row__change">${usable ? `<strong>${escapeHtml(pct(facility.changePct))}</strong>${facility.coverage === "reference" ? '<em class="hpt-reference-badge">参考</em>' : ""}${directionBadge(facility.direction)}` : `<strong class="hpt-core-row__status">${view.accumulating ? "データ蓄積中" : "比較データ不足"}</strong>`}<small>7日前比</small></div>
        <div class="hpt-core-row__coverage">${escapeHtml(coverageText)}</div>
      </article>`;
    }).join("") + (withPhotos ? `<p class="hpt-photo-credit">${PHOTO_CREDIT}（写真を選ぶと施設ページが開きます）</p>` : "");
    // One shared scale so the shapes of the five facilities can be compared directly.
    const axis = model.trendAxis(view.facilities.flatMap((facility) => facility.points.map((point) => point.value)), {floor: -3, ceiling: 3, headroom: 0});
    list.querySelectorAll(".hpt-spark").forEach((container) => {
      const facility = view.facilities[Number(container.dataset.sparkIndex)];
      const width = chartWidth(container, 280), height = 52, pad = 6;
      const last = model.DAILY_TREND_LABELS.length - 1;
      const x = (index) => pad + index * ((width - pad * 2) / last);
      const y = (value) => pad + (axis.max - value) * ((height - pad * 2) / (axis.max - axis.min));
      const base = `<line class="hpt-spark-base" x1="${pad}" x2="${width - pad}" y1="${y(0)}" y2="${y(0)}"/>`;
      if (facility.coverage === "insufficient") {
        container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${base}</svg><span class="hpt-spark-empty">線は表示しません</span>`;
        container.setAttribute("role", "img");
        container.setAttribute("aria-label", `${facility.name}は比較データ不足のため値動きを表示しません`);
        return;
      }
      const dots = facility.points.map((point, index) => point.value == null ? "" : `<circle class="hpt-spark-dot" cx="${x(index)}" cy="${y(point.value)}" r="${index === last ? 3.2 : 2.1}" data-point="${index + 1}"/>`).join("");
      container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${base}${polylines(facility.points, x, y, "hpt-spark-line")}${dots}</svg>`;
      container.setAttribute("role", "img");
      container.setAttribute("aria-label", `${facility.name}の8点推移。${facility.points.map((point) => `${point.label} ${point.value == null ? "データなし" : pct(point.value)}`).join("、")}`);
    });
  }

  function mapPoint([lat, lon]) {
    const projection = JAPAN_MAP.projection;
    return [(lon - projection.lonMin) * projection.lonScale * projection.unit, (projection.latMax - lat) * projection.unit];
  }
  function renderMarkets() {
    const active = elements.region.value;
    const map = document.querySelector("#hpt-map");
    if (JAPAN_MAP) {
      const [x, y, width, height] = JAPAN_MAP.inset.box;
      const points = regions.filter((region) => MARKET_LOCATIONS[region.code]).map((region) => {
        const [px, py] = mapPoint(MARKET_LOCATIONS[region.code]);
        // Labels sit left of points in the east so they stay inside the map.
        const side = px > JAPAN_MAP.width * 0.72 ? " hpt-map-point--label-left" : "";
        return `<button type="button" class="hpt-map-point${region.code === active ? " is-active" : ""}${side}" data-region="${escapeHtml(region.code)}" style="left:${(px / JAPAN_MAP.width * 100).toFixed(2)}%;top:${(py / JAPAN_MAP.height * 100).toFixed(2)}%" tabindex="-1" aria-hidden="true" title="${escapeHtml(region.name)}"><span>${escapeHtml(region.name)}</span></button>`;
      }).join("");
      map.innerHTML = `<svg viewBox="0 0 ${JAPAN_MAP.width} ${JAPAN_MAP.height}" aria-hidden="true"><rect class="hpt-map-inset" x="${x}" y="${y}" width="${width}" height="${height}" rx="6"/><text class="hpt-map-inset-label" x="${x + width - 8}" y="${y + height - 8}" text-anchor="end">${escapeHtml(JAPAN_MAP.inset.label)}</text><path class="hpt-map-land" d="${JAPAN_MAP.land}${JAPAN_MAP.inset.land}"/><path class="hpt-map-borders" d="${JAPAN_MAP.borders}"/></svg>${points}`;
    } else {
      map.innerHTML = "";
    }
    document.querySelector("#hpt-market-chips").innerHTML = regions.map((region) => `<button type="button" class="hpt-market-chip${region.code === active ? " is-active" : ""}" data-region="${escapeHtml(region.code)}" aria-pressed="${region.code === active}">${escapeHtml(region.name)}</button>`).join("");
  }
  function facilityImage(hotelNo) {
    const profile = profilesByHotel.get(Number(hotelNo));
    const image = profile?.latest?.image;
    return image?.url || image?.thumbnail_url ? {...image, source_url: profile.source_url, name: profile.name} : null;
  }
  // Photos stay on Rakuten's servers, unaltered, and always link back to the facility page.
  function photoLink(image, className, size) {
    const src = size === "thumbnail" ? image.thumbnail_url || image.url : image.url || image.thumbnail_url;
    const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(image.name)}の写真" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
    return image.source_url
      ? `<a class="${className}" href="${escapeHtml(image.source_url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(image.name)}を楽天トラベルで見る（新しいタブ）">${img}</a>`
      : `<span class="${className}">${img}</span>`;
  }
  function renderTrendSection() {
    const view = model.dailyTrendView(selectedRegion());
    renderMarketTrend(view);
    renderCoreFacilities(view);
  }

  function renderKpis(summary, comparison) {
    const selected = summary.positions.find((row) => row.hotel_no === Number(elements.hotel.value));
    const rank = model.priceRank(summary, elements.hotel.value);
    const cohortQuality = {sufficient:"十分", comparable:"比較可能", reference:"参考値", insufficient:"比較データ不足"}[summary.dataQuality];
    const comparisonNote = summary.cohortActive ? summary.dataQuality === "reference" ? "3/5のため参考値" : summary.comparisonReady ? "比較施設群との差を表示" : "0〜2/5のため中央値・順位を非表示" : summary.comparisonReady ? "比較施設群との差を表示" : "3施設未満のため比較しません";
    const confirmationValue = summary.cohortActive ? `${summary.successful}/${summary.target}` : summary.observations === 0 ? "観測なし" : `${summary.successful}/${summary.target}`;
    const medianNote = summary.cohortActive ? `料金確認 ${summary.successful}/${summary.target}施設（${cohortQuality}）` : summary.observations === 0 ? "指定条件の観測なし" : summary.comparisonReady ? `料金確認 ${summary.successful}/${summary.target}施設` : `料金確認 ${summary.successful}/${summary.target}施設（参考表示）`;
    const medianValue = summary.cohortActive && !summary.comparisonReady ? "比較データ不足" : yen(summary.marketMedian);
    const cards = [
      ["比較施設群中央値", medianValue, medianNote, model.isFinitePositive(summary.marketMedian) ? "numeric" : "status"],
      ["選択施設の料金", yen(selected?.min_price_yen), "今日の取得の料金", model.isFinitePositive(selected?.min_price_yen) ? "numeric" : "status"],
      ["比較施設群中央値との差", summary.comparisonReady && selected?.price_index != null ? pct(selected.price_index - 100) : "比較データ不足", comparisonNote, summary.comparisonReady && selected?.price_index != null ? "numeric" : "status"],
      ["中央値の7日前比", comparison?.marketChange != null ? pct(comparison.marketChange) : "比較データなし", comparison?.marketChange != null ? `7日前 ${yen(comparison.prior.marketMedian)}` : "正確な7日前・同条件・同一比較施設群のデータが必要", comparison?.marketChange != null ? "numeric" : "status"],
      ...(rank ? [["価格順位", `高い方から${rank.rank}番目`, `料金確認${rank.total}施設中${rank.equal > 1 ? "・同額あり" : ""}${summary.dataQuality === "reference" ? "・参考値" : ""}`, "status"]] : []),
      ["料金確認", confirmationValue, summary.cohortActive ? `${cohortQuality}・未確認を満室とは判定しません` : summary.observations === 0 ? "指定条件の観測なし" : summary.successful === 0 ? "観測あり・成功0件" : "未確認を満室とは判定しません", summary.observations === 0 ? "status" : "numeric"]
    ];
    const qualityClass = summary.dataQuality === "reference" ? " hpt-kpi--reference" : summary.dataQuality === "insufficient" ? " hpt-kpi--insufficient" : "";
    document.querySelector("#hpt-kpis").innerHTML = cards.map(([label, value, note, kind]) => `<article class="hpt-kpi${qualityClass}"><span>${escapeHtml(label)}</span><strong class="hpt-kpi__value hpt-kpi__value--${kind}">${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`).join("");
  }
  function ratingComparison(profile) {
    if (!profile?.latest) return {label:"比較データなし", medians:{}};
    const comparisonHotelNos=new Set(selectedProperties().map((row)=>Number(row.hotel_no)));
    const regionProfiles=profileData.properties.filter((row)=>comparisonHotelNos.has(Number(row.hotel_no))&&row.latest);
    const cohortActive=model.cohortMetadata(selectedRegion()).active;
    const {peers,scope}=model.ratingPeers(regionProfiles,profileData.properties.filter((row)=>row.latest),cohortActive);
    if (scope==="insufficient") return {label:`比較データなし（評価取得${regionProfiles.length}施設）`, medians:{}};
    const medians={};
    Object.keys(RATING_LABELS).forEach((key)=>{medians[key]=ratingMedian(peers.map((row)=>row.latest?.ratings?.[key]).filter((value)=>value!=null))});
    return {label:scope==="region"?`${selectedRegion().name}${regionProfiles.length}施設中央値`:`対象${peers.length}施設中央値`,medians};
  }
  function renderProfile(summary) {
    const profile=selectedProfile(),selected=summary.positions.find((row)=>row.hotel_no===Number(elements.hotel.value));
    const container=document.querySelector("#hpt-profile");
    if (!profile) {container.classList.remove("hpt-profile--photo");container.innerHTML='<p class="hpt-empty">この施設の基本情報はまだ取得されていません。料金データは引き続き確認できます。</p>';return;}
    const latestProfile=profile.latest;
    const rating=latestProfile?.review_average==null?"—":Number(latestProfile.review_average).toFixed(2);
    const source=profile.source_url?`<a href="${escapeHtml(profile.source_url)}" target="_blank" rel="noopener noreferrer">楽天トラベルで確認 ↗</a>`:"";
    const image=facilityImage(profile.hotel_no);
    container.classList.toggle("hpt-profile--photo",Boolean(image));
    const photo=image?`<figure class="hpt-profile__photo">${photoLink(image,"hpt-profile__photo-link","large")}<figcaption>${PHOTO_CREDIT}</figcaption></figure>`:"";
    container.innerHTML=`${photo}<div class="hpt-profile__identity"><p class="eyebrow">PROPERTY PROFILE</p><h2>${escapeHtml(profile.name)}</h2><p>${escapeHtml([profile.prefecture,profile.address].filter(Boolean).join(" "))}</p><small>楽天エリア：${escapeHtml(profile.rakuten_area_name||"—")}</small>${source}</div><div class="hpt-profile__metrics"><article><span>大人2名1室の比較料金</span><strong>${escapeHtml(yen(selected?.min_price_yen))}</strong><small>${escapeHtml(formatDate(elements.stayDate.value))}・${escapeHtml(MEAL_LABELS[elements.meal.value])}</small></article><article><span>楽天参考最安料金</span><strong>${escapeHtml(yen(latestProfile?.reference_min_charge_yen))}</strong><small>条件統一料金ではありません</small></article><article><span>楽天総合評価</span><strong>${escapeHtml(rating)}</strong><small>${latestProfile?`取得月 ${escapeHtml(latestProfile.snapshot_month)}`:"月次データ蓄積中"}</small></article></div>`;
  }
  function renderRatings() {
    const profile=selectedProfile(),container=document.querySelector("#hpt-ratings"),table=document.querySelector("#hpt-ratings-table");
    if (!profile?.latest) {container.innerHTML='<p class="hpt-empty">評価データを蓄積しています。</p>';table.innerHTML="";return;}
    const comparison=ratingComparison(profile),rows=Object.entries(RATING_LABELS).map(([key,label])=>({key,label,value:profile.latest.ratings?.[key]??null,median:comparison.medians[key]??null}));
    container.setAttribute("aria-label",`${profile.name}の楽天評価。比較対象は${comparison.label}`);
    container.innerHTML=`<p class="hpt-rating-scope">0〜5点 ／ 金色の棒：選択施設 ／ 線の印：${escapeHtml(comparison.label)}</p>${rows.map((row)=>{const width=row.value==null?0:Math.max(0,Math.min(100,Number(row.value)*20)),marker=row.median==null?null:Math.max(0,Math.min(100,Number(row.median)*20));return `<div class="hpt-rating-row"><span>${escapeHtml(row.label)}</span><div class="hpt-rating-track"><i style="width:${width}%"></i>${marker==null?"":`<b style="left:${marker}%" title="中央値 ${Number(row.median).toFixed(2)}"></b>`}</div><strong>${row.value==null?"—":Number(row.value).toFixed(2)}</strong></div>`}).join("")}`;
    table.innerHTML=`<details><summary>評価を表で確認</summary><table><thead><tr><th>項目</th><th>選択施設</th><th>${escapeHtml(comparison.label)}</th></tr></thead><tbody>${rows.map((row)=>`<tr><td>${escapeHtml(row.label)}</td><td>${row.value==null?"—":Number(row.value).toFixed(2)}</td><td>${row.median==null?"—":Number(row.median).toFixed(2)}</td></tr>`).join("")}</tbody></table></details>`;
  }
  function renderRatingHistory() {
    const profile=selectedProfile(),rows=(profile?.history||[]).filter((row)=>row.review_average!=null),chart=document.querySelector("#hpt-rating-history"),table=document.querySelector("#hpt-rating-history-table");
    if (rows.length<2) {chart.innerHTML='<p class="hpt-empty">評価推移は月次データを蓄積中です。2か月分から表示します。</p>';table.innerHTML="";return;}
    const width=860,height=250,left=54,right=22,top=18,bottom=42,x=(index)=>left+(width-left-right)*(index/(rows.length-1)),y=(value)=>top+(height-top-bottom)*(1-Number(value)/5),points=rows.map((row,index)=>`${x(index)},${y(row.review_average)}`).join(" ");
    const grid=[0,1,2,3,4,5].map((value)=>`<line class="hpt-grid-line" x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}"/><text class="hpt-axis-label" x="${left-9}" y="${y(value)+4}" text-anchor="end">${value}</text>`).join("");
    const dots=rows.map((row,index)=>`<circle class="hpt-selected-dot" cx="${x(index)}" cy="${y(row.review_average)}" r="4"><title>${escapeHtml(row.snapshot_month)} ${Number(row.review_average).toFixed(2)}</title></circle><text class="hpt-axis-label" x="${x(index)}" y="${height-14}" text-anchor="middle">${escapeHtml(row.snapshot_month.slice(0,7))}</text>`).join("");
    chart.innerHTML=`<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${grid}<polyline class="hpt-selected-line" points="${points}"/>${dots}</svg>`;
    chart.setAttribute("aria-label",`${profile.name}の総合評価月次推移。${rows[0].snapshot_month} ${Number(rows[0].review_average).toFixed(2)}から${rows.at(-1).snapshot_month} ${Number(rows.at(-1).review_average).toFixed(2)}`);
    table.innerHTML=`<details><summary>評価推移を表で確認</summary><table><thead><tr><th>取得月</th><th>総合評価</th></tr></thead><tbody>${rows.map((row)=>`<tr><td>${escapeHtml(row.snapshot_month)}</td><td>${Number(row.review_average).toFixed(2)}</td></tr>`).join("")}</tbody></table></details>`;
  }
  function renderInsights(summary, comparison) {
    const lines = model.insightLines(summary, comparison, elements.hotel.value);
    const titleFor = (line) => line.includes("7日前比") ? "比較施設群中央値の変化" : line.includes("選択施設") ? "選択施設の位置" : "料金確認の範囲";
    document.querySelector("#hpt-insights").innerHTML = lines.map((line) => `<article class="hpt-insight"><h3>${escapeHtml(titleFor(line))}</h3><p>${escapeHtml(line)}</p></article>`).join("");
  }
  function buildTrend() {
    const selection={regionCode:elements.region.value,stayDate:elements.stayDate.value,mealType:elements.meal.value};
    const latestSummary = summarize(latest, selection.regionCode, selection.stayDate, selection.mealType);
    const selected = latestSummary.positions.find((row) => row.hotel_no === Number(elements.hotel.value));
    // 過去の取得は比較施設群中央値だけ。選択施設の料金は今日の取得の分だけを置く
    const rows = model.trendRows(trendHistory, latestSummary, selection).filter((row) => row.snapshot_date !== latest.snapshot_date).map((row) => ({...row, selected_price:null}));
    rows.push({snapshot_date:latest.snapshot_date, median:latestSummary.marketMedian, successful:latestSummary.successful, target:latestSummary.target, selected_price:selected?.min_price_yen ?? null});
    return rows.map((row) => ({...row, lead_days:dayDiff(selection.stayDate, row.snapshot_date)}));
  }
  function renderTrend(rows) {
    const chart = document.querySelector("#hpt-trend-chart");
    const values = rows.flatMap((row) => [row.selected_price,row.median]).filter((value) => value != null);
    if (!values.length) { chart.innerHTML = '<p class="hpt-empty">この条件の推移データはまだありません。</p>'; document.querySelector("#hpt-trend-table").innerHTML = ""; return; }
    const width=920,height=340,left=72,right=24,top=22,bottom=52;
    const minValue=Math.floor(Math.min(...values)*.9/1000)*1000,maxValue=Math.ceil(Math.max(...values)*1.1/1000)*1000;
    const x=(index)=>left+(width-left-right)*(rows.length===1?.5:index/(rows.length-1));
    const y=(value)=>top+(height-top-bottom)*(1-(value-minValue)/Math.max(maxValue-minValue,1));
    const segments=(key)=>{const groups=[];let current=[];rows.forEach((row,index)=>{if(row[key]==null){if(current.length)groups.push(current);current=[]}else current.push(`${x(index)},${y(row[key])}`)});if(current.length)groups.push(current);return groups};
    const grid=[0,.25,.5,.75,1].map((ratio)=>{const value=Math.round(maxValue-(maxValue-minValue)*ratio),yy=top+(height-top-bottom)*ratio;return `<line class="hpt-grid-line" x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}"/><text class="hpt-axis-label" x="${left-9}" y="${yy+4}" text-anchor="end">${escapeHtml(yen(value))}</text>`}).join("");
    const labels=rows.map((row,index)=>index%Math.max(Math.ceil(rows.length/6),1)===0?`<text class="hpt-axis-label" x="${x(index)}" y="${height-18}" text-anchor="middle">${row.lead_days}日前</text>`:"").join("");
    const dots=rows.map((row,index)=>row.selected_price==null?"":`<circle class="hpt-selected-dot" cx="${x(index)}" cy="${y(row.selected_price)}" r="5"><title>${escapeHtml(row.snapshot_date)} ${escapeHtml(yen(row.selected_price))}</title></circle>`).join("");
    const medianLines=segments("median").map((points)=>`<polyline class="hpt-market-line" points="${points.join(" ")}"/>`).join("");
    chart.innerHTML=`<div class="hpt-chart-legend"><span><i class="market"></i>比較施設群中央値</span><span><i class="selected"></i>選択施設（今日の料金）</span></div><svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${grid}${medianLines}${dots}${labels}</svg>`;
    document.querySelector("#hpt-trend-table").innerHTML=`<details><summary>推移を表で確認</summary><table><thead><tr><th>取得日</th><th>残日数</th><th>比較施設群中央値</th><th>料金確認</th><th>選択施設</th></tr></thead><tbody>${rows.map((row)=>`<tr><td>${escapeHtml(row.snapshot_date)}</td><td>${row.lead_days}日</td><td>${escapeHtml(row.median==null?"比較データ不足":yen(row.median))}</td><td>${row.successful}/${row.target}施設</td><td>${row.snapshot_date===latest.snapshot_date?escapeHtml(yen(row.selected_price)):"—"}</td></tr>`).join("")}</tbody></table></details>`;
  }
  function renderCalendar() {
    const region=selectedRegion();
    const dates=[...new Set(region.rates.map((row)=>row.stay_date))].sort();
    document.querySelector("#hpt-calendar").innerHTML=dates.map((stayDate)=>{const summary=summarize(latest,elements.region.value,stayDate,elements.meal.value),selected=summary.positions.find((row)=>row.hotel_no===Number(elements.hotel.value)),difference=summary.comparisonReady&&selected?.price_index!=null?selected.price_index-100:null,level=summary.dataQuality==="reference"?"reference":difference==null?"none":difference<=-10?"low":difference>=10?"high":"mid",medianLabel=summary.cohortActive&&!summary.comparisonReady?"非表示":yen(summary.marketMedian),qualityLabel=summary.dataQuality==="reference"?"参考値":summary.dataQuality==="insufficient"?"比較データ不足":difference==null?"比較不可":`差 ${pct(difference)}`,countLabel=summary.cohortActive?`（${summary.successful}/${summary.target}）`:"";return `<article class="hpt-calendar-cell hpt-calendar-cell--${level}" title="${escapeHtml(stayDate)}"><time datetime="${escapeHtml(stayDate)}">${escapeHtml(formatDate(stayDate))}</time><strong>選択 ${escapeHtml(yen(selected?.min_price_yen))}</strong><span>比較施設群中央値 ${escapeHtml(medianLabel)}</span><span>${escapeHtml(qualityLabel)}${escapeHtml(countLabel)}</span></article>`}).join("");
  }
  function renderPositions(summary) {
    const available=summary.positions.filter((row)=>row.min_price_yen!=null),max=Math.max(...available.map((row)=>row.min_price_yen),1),showBars=model.showPositionBars(summary);
    const note=showBars?"":'<p class="hpt-empty">料金確認が2施設以下のため、棒グラフでの比較は表示しません。</p>';
    document.querySelector("#hpt-positions").innerHTML=note+summary.positions.map((row)=>{const selected=row.hotel_no===Number(elements.hotel.value),width=!showBars||row.min_price_yen==null?0:Math.max(row.min_price_yen/max*100,2);return `<div class="hpt-position ${selected?"hpt-position--selected":""}"><div class="hpt-position__name">${escapeHtml(row.name)}${selected?"（選択施設）":""}</div><div class="hpt-position__track"><div class="hpt-position__bar" style="width:${width}%"></div></div><div class="hpt-position__value">${escapeHtml(yen(row.min_price_yen))}<small>${summary.comparisonReady&&row.price_index!=null?`比較施設群との差 ${pct(row.price_index-100)}`:"比較データ不足"}</small></div></div>`}).join("");
  }
  function render() {
    syncUrl();
    renderMarkets();
    renderTrendSection();
    const summary=summarize(latest,elements.region.value,elements.stayDate.value,elements.meal.value);
    const selected=summary.positions.find((row)=>row.hotel_no===Number(elements.hotel.value));
    const comparison=model.sevenDayComparison(latest,trendHistory,{regionCode:elements.region.value,hotelNo:elements.hotel.value,stayDate:elements.stayDate.value,mealType:elements.meal.value});
    renderProfile(summary);renderKpis(summary,comparison);renderInsights(summary,comparison);renderTrend(buildTrend());renderCalendar();renderRatings();renderRatingHistory();renderPositions(summary);
    document.querySelector("#hpt-scope-title").textContent=`${selectedRegion().name}・比較${summary.target}施設`;
    const cohortMeta=summary.cohortActive?` ／ 比較施設群：${summary.cohortVersion}`:"";
    document.querySelector("#hpt-selection-meta").textContent=`市場：${selectedRegion().name}${cohortMeta} ／ 選択施設：${selected?.name || "—"} ／ 宿泊日：${formatDate(elements.stayDate.value)} ／ 条件：大人2名・1室・1泊・${MEAL_LABELS[elements.meal.value]} ／ 取得日：${latest.snapshot_date}`;
    const trendComparison=document.querySelector("#hpt-trend-comparison");
    const comparisonParts=[];
    if (comparison.marketChange != null) comparisonParts.push(`比較施設群中央値：7日前 ${yen(comparison.prior.marketMedian)} → 現在 ${yen(summary.marketMedian)}（${pct(comparison.marketChange)}）`);
    trendComparison.hidden=!comparisonParts.length;
    trendComparison.textContent=comparisonParts.join(" ／ ");
    const generatedAt=formatGeneratedAt(latest.generated_at);
    elements.freshness.textContent=`取得日：${latest.snapshot_date} ／ 条件：大人2名・1室・1泊・${MEAL_LABELS[elements.meal.value]}${generatedAt?` ／ データ生成日時（日本時間）：${generatedAt}`:""}`;
    const sourceUpdated=document.querySelector("#source-updated");if(sourceUpdated)sourceUpdated.textContent=latest.snapshot_date;
  }
  function selectRegion(code) {
    if (!regions.some((region) => region.code === code) || code === elements.region.value) return;
    elements.region.value = code;
    elements.region.dispatchEvent(new Event("change"));
  }
  async function init() {
    elements.loading.hidden=false;elements.error.hidden=true;elements.dashboard.hidden=true;
    try {
      [manifest,profileData]=await Promise.all([getJson(`${DATA_ROOT}manifest.json`),getJson(`${DATA_ROOT}profiles.json`).catch(()=>({properties:[]}))]);
      profilesByHotel=new Map((profileData.properties||[]).map((profile)=>[Number(profile.hotel_no),profile]));
      latest=await getJson(`${DATA_ROOT}${manifest.latest_file || manifest.snapshots[0].file}`);
      // 過去の取得は市場ごとの集計（trend-history.json）だけを読む。施設ごとの過去の料金は公開しない
      if (manifest.history_file) {
        trendHistory=await getJson(`${DATA_ROOT}${manifest.history_file}`).catch(()=>null);
      } else {
        // サーバーの書き出しが切り替わるまでの旧形式（日別ファイル）。読めた分から同じ集計を作る
        const historyItems=manifest.snapshots.slice(0,30).filter((item)=>item.date!==latest.snapshot_date&&item.file!==manifest.snapshots[0].file);
        const olderSnapshots=(await Promise.all(historyItems.map((item)=>getJson(`${DATA_ROOT}${item.file}`).catch(()=>null)))).filter(Boolean);
        trendHistory=model.trendHistoryFrom([latest,...olderSnapshots]);
      }
      populateControls();
      // Charts are sized from their containers, so the dashboard must be visible before rendering.
      elements.loading.hidden=true;elements.dashboard.hidden=false;
      render();
      if (window.gtag) window.gtag("event","analysis_result_view",{tool_id:"hotel-price-trends",dataset_version:latest.snapshot_date});
    } catch (error) {elements.loading.hidden=true;elements.dashboard.hidden=true;elements.error.hidden=false;elements.errorMessage.textContent=error.message || "時間をおいて再度お試しください。";elements.freshness.textContent="データ取得エラー";}
  }
  elements.region.addEventListener("change",()=>{populateHotels();stayDateExplicit=populateDates(stayDateExplicit?elements.stayDate.value:null);render()});
  elements.stayDate.addEventListener("change",()=>{stayDateExplicit=true;render()});
  [elements.hotel,elements.meal].forEach((control)=>control.addEventListener("change",render));
  document.querySelector("#hpt-dashboard").addEventListener("click",(event)=>{
    const target=event.target.closest("[data-region]");
    if (target) selectRegion(target.dataset.region);
  });
  let resizeFrame=0;
  let lastWidth=window.innerWidth;
  window.addEventListener("resize",()=>{
    if (!latest || window.innerWidth===lastWidth) return;
    lastWidth=window.innerWidth;
    cancelAnimationFrame(resizeFrame);
    resizeFrame=requestAnimationFrame(renderTrendSection);
  });
  elements.retry.addEventListener("click",init);
  init();
})();
