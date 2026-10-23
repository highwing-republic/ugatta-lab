from pathlib import Path

from bs4 import BeautifulSoup

from site_pages import is_published, is_redirect_stub, rendered


ROOT = Path(__file__).resolve().parents[1]


def soup(name):
    return BeautifulSoup(rendered(name), "html.parser")


def test_lab_notes_link_is_kept_out_of_headers_and_small_at_page_bottom():
    pages = []
    for path in filter(is_published, ROOT.rglob("*.html")):
        relative = path.relative_to(ROOT)
        if {"demo", "docs", "tourism-market-signal"} & set(relative.parts) or is_redirect_stub(path):
            continue
        pages.append(path)
    assert pages
    for path in pages:
        page = BeautifulSoup(rendered(path), "html.parser")
        assert not page.select('header a[href="/classics-ai-management/"]'), path
        footer_links = page.select('footer a[href="/classics-ai-management/"]')
        assert len(footer_links) == 1, path
        assert "footer-note-link" in footer_links[0].get("class", []), path


def test_every_html_page_loads_the_canonical_site_shell():
    # Demo pages are standalone mock sites with their own header and footer.
    pages = [path for path in filter(is_published, ROOT.rglob("*.html")) if not {"demo", "tourism-market-signal"} & set(path.relative_to(ROOT).parts) and not is_redirect_stub(path)]
    assert len(pages) == 23
    for path in pages:
        page = BeautifulSoup(rendered(path), "html.parser")
        assert page.find("link", href="/css/site-shell.css?v=20261012shell"), path
        assert page.find("script", src="/js/site-shell.js?v=20261012shell2"), path

    for name in ("report.html",):
        assert soup(name).find("script", src="/js/site.js?v=20261002-shell"), name

    shell = (ROOT / "js" / "site-shell.js").read_text(encoding="utf-8")
    footer = (ROOT / "_includes" / "site-footer.html").read_text(encoding="utf-8")
    for href in (
        "/#facility-tools",
        "/#regional-tools",
        "/#market-tools",
        "/#demo-tools",
        "/#about-lab",
        "https://forms.gle/yjinqFdntoXhTmgk7",
        "https://note.com/hotel_dx_lab",
        "/classics-ai-management/",
    ):
        assert href in shell
        assert href in footer or href.startswith("/#"), href
    assert "body > header:not(.top)" in shell
    assert "pageFooter.matches('.shell.footer')" in shell


def test_home_is_concise_and_groups_all_tools_by_purpose():
    page = soup("index.html")
    h1 = page.find("h1")
    assert h1.select_one(".home-hero__eyebrow").get_text(strip=True) == "旅館・ホテルのDXと経営に"
    assert "".join(line.get_text("", strip=True) for line in h1.select(".home-hero__line")) == "現場のヒントが見つかる実践ツール"
    assert len(page.select("#analysis-tools .tool-card")) == 4
    assert [img["src"] for img in page.select(".tool-card__thumb img")] == [
        f"images/thumbs/{name}.svg" for name in ("hotel-price-trends", "inbound-analysis", "dx-diagnosis", "mini-pms")
    ]
    for name in ("hotel-price-trends", "inbound-analysis", "dx-diagnosis", "mini-pms"):
        assert (ROOT / "images" / "thumbs" / f"{name}.svg").exists()
    assert len(page.select("#analysis-tools .analysis-card")) == 16
    assert len(page.select("#analysis-tools .tool-group")) == 4
    # Card wrappers are block elements: no heading, paragraph or div may sit inside a span.
    assert page.select("span h3, span p, span div") == []
    assert not page.find(id="lab-notes")
    assert page.find(id="about-lab")
    assert not page.find(id="flow") and not page.find(id="use-cases")
    assert [heading.get_text(strip=True) for heading in page.select(".tool-group__heading h3")] == [
        "自施設を知る", "地域を知る", "市場の動きを知る", "実験・体験する"
    ]
    assert page.select_one('a[href="#analysis-tools"]')
    assert page.select_one('a[href="/management-ai.html"]')
    assert page.find(id="ai-tools")  # old /#ai-tools links still land on the AI card
    assert page.select_one('a[href="/hotel-price-trends.html"]')
    market = page.find(id="market-tools").find_parent("section")
    assert market.select_one('a[href="/report.html"]')
    assert not page.select_one('a[href*="edinet-investment-radar"]')


def test_home_is_only_tool_directory_and_legacy_page_is_removed():
    assert not (ROOT / "useful.html").exists()
    home = soup("index.html")
    assert len(home.select("#analysis-tools .analysis-card")) == 16
    assert home.select_one('a[href="/report.html"]')

    report = soup("report.html")
    assert report.find("link", rel="canonical")["href"] == "https://lab.ugatta-llc.com/report.html"
    assert report.find("meta", attrs={"name": "robots"})["content"].startswith("index,follow")
    frame = report.find("iframe", src=lambda value: value and value.startswith("/tourism-market-signal/index.html"))
    assert frame and frame.get("scrolling") == "no" and frame.has_attr("data-report-frame")
    assert report.find("script", src="/js/report-embed.js?v=20261002a")
    assert not report.select_one(".external-link")
    assert "外部レポートを開く" not in report.get_text(" ", strip=True)

    embed_script = (ROOT / "js" / "report-embed.js").read_text(encoding="utf-8")
    assert "event.origin !== reportOrigin" in embed_script
    assert "event.source !== frame.contentWindow" in embed_script
    assert "frame.style.height" in embed_script

    for path in ROOT.rglob("*.html"):
        relative = path.relative_to(ROOT)
        if "docs" not in relative.parts:
            assert "useful.html" not in path.read_text(encoding="utf-8"), path
    assert "useful.html" not in (ROOT / "sitemap.xml").read_text(encoding="utf-8")


def test_hotel_price_trends_has_controls_disclosures_and_rakuten_credit():
    page = soup("hotel-price-trends.html")
    assert "宿泊料金トレンド" in page.title.string
    for control_id in ("hpt-region", "hpt-hotel", "hpt-stay-date", "hpt-meal"):
        assert page.find(id=control_id)
    body = page.get_text(" ", strip=True)
    assert "大人2名・1室・1泊" in body
    assert "満室とは判定しません" in body
    assert "固定した比較施設群" in body
    assert "5施設中3施設の日は参考値" in body
    assert "BACKUPは日次の穴埋めには使わず" in body
    for section_id in ("hpt-market-trend", "hpt-core-facilities", "hpt-map", "hpt-profile", "hpt-ratings", "hpt-rating-history"):
        assert page.find(id=section_id)
    # Review text is no longer shown; profile, rating and stay-date detail live in toggles.
    assert page.find(id="hpt-review") is None
    assert "LATEST REVIEW" not in body
    assert page.select_one("#hpt-detail-price #hpt-stay-date")
    assert page.select_one("#hpt-detail-profile #hpt-profile")
    assert page.select_one("#hpt-detail-ratings #hpt-ratings")
    assert not page.select_one(".hpt-filter-grid #hpt-stay-date")
    assert "25〜75%" not in page.decode()
    assert "楽天参考最安料金" in body
    credit = page.find("a", href="https://developers.rakuten.com/")
    assert credit and credit.get_text(strip=True) == "Supported by Rakuten Developers"
    assert page.find("script", src="js/hotel-price-trends-model.js?v=20261005trend1")
    scripts = [tag["src"] for tag in page.find_all("script", src=True)]
    assert scripts.index("js/japan-map-data.js?v=20261012map1") < scripts.index("js/hotel-price-trends.js?v=20261012tool")


def test_hotel_price_trends_photos_stay_on_rakuten_and_link_back():
    script = (ROOT / "js" / "hotel-price-trends.js").read_text(encoding="utf-8")
    assert "JAPAN_OUTLINE" not in script
    assert "window.HotelPriceJapanMap" in script
    assert "profile?.latest?.image" in script
    assert 'referrerpolicy="no-referrer"' in script
    assert 'href="${escapeHtml(image.source_url)}" target="_blank" rel="noopener noreferrer"' in script
    assert 'const PHOTO_CREDIT = "写真：楽天トラベル";' in script
    # Rows without a photo only get a placeholder when another facility in the market has one.
    assert "const withPhotos = images.some(Boolean);" in script


def test_hotel_price_trends_script_keeps_browser_history_available():
    script = (ROOT / "js" / "hotel-price-trends.js").read_text(encoding="utf-8")
    assert "window.history.replaceState" in script
    assert "let history" not in script
    assert "trendHistory" in script
    assert "snapshotHistory" not in script
    assert 'getJson(`${DATA_ROOT}profiles.json`)' in script
    assert "HotelPriceTrendsModel" in script
    assert "makeProfileInsights" not in script
    assert "latest_review_excerpt" not in script


def test_hotel_price_trends_hides_uncollected_phase1_markets():
    script = (ROOT / "js" / "hotel-price-trends.js").read_text(encoding="utf-8")
    model = (ROOT / "js" / "hotel-price-trends-model.js").read_text(encoding="utf-8")
    assert "function selectableRegions(manifest, snapshot)" in model
    assert "cohort.propertyIds.every" in model
    assert "model.selectableRegions(manifest, latest)" in script
    assert "表示可能な市場データがありません" in script


def test_diagnosis_is_native_and_does_not_contact_the_external_app():
    page = soup("dx-diagnosis.html")
    assert page.select_one("#dx-diagnosis-app")
    scripts = [script.get("src") for script in page.find_all("script", src=True)]
    assert scripts.index("js/dx-diagnosis-model.js?v=20261017handoff") < scripts.index("js/dx-diagnosis.js?v=20261017handoff")
    assert page.find("iframe") is None
    assert "chatgpt.site" not in page.decode()
    assert page.select_one(".external-tool-notice") is None
    contact_url = "https://forms.gle/yjinqFdntoXhTmgk7"
    for name in ("js/dx-diagnosis-model.js", "js/dx-diagnosis.js"):
        script = (ROOT / name).read_text(encoding="utf-8")
        assert "fetch(" not in script
        assert "XMLHttpRequest" not in script
        assert "http://" not in script
        # The consultation link is the only URL allowed; it is a link target, not a request.
        assert "https://" not in script.replace(contact_url, "")

    ui = (ROOT / "js" / "dx-diagnosis.js").read_text(encoding="utf-8")
    # Analytics go through the lab allowlist with allowed events and no diagnosis values.
    assert "window.gtag" not in ui
    assert 'window.LabAnalytics.track(eventName, { tool_id: "dx-diagnosis" })' in ui
    for event in ("analysis_run", "analysis_result_view", "consultation_click"):
        assert f'track("{event}")' in ui
    assert "dx_total_score" not in ui and "dx_top_priority" not in ui
    # No answer is preselected; unanswered questions are pointed out before moving on.
    assert "model.defaultAnswers()" not in ui
    assert "この質問にまだ回答していません。" in ui
    # Optional figures the visitor did not change are labelled as defaults in the result.
    assert "（標準値）" in ui
    # Validation errors mark the field and move focus to the first invalid input.
    for field in ("rooms", "employees", "adr", "hourlyCost"):
        assert f'invalidAttr("{field}")' in ui
    for field in ("otaRatio", "occupancy"):
        assert f'rangeField("{field}"' in ui
    assert "+ invalidAttr(name) +" in ui
    assert "app.querySelector('[aria-invalid=\"true\"]')" in ui
    assert f'const CONTACT_URL = "{contact_url}"' in ui


def test_analysis_pages_hide_initial_error_and_offer_copy_print_and_rich_noscript():
    for name in (
        "inbound-analysis.html",
    ):
        page = soup(name)
        error = page.find(id="data-error")
        assert error is not None and error.has_attr("hidden") and not error.get_text(strip=True)
        assert page.find(id="data-loading")
        assert len(page.find("noscript").get_text(" ", strip=True)) > 35
        assert page.select_one(".scope-badge")
        assert page.select_one("[data-copy-result]")
        assert page.select_one("[data-print-result]")


def test_management_tool_is_identified_as_rules_based_and_exposes_version():
    page = soup("management-ai.html")
    assert "宿泊経営の課題整理（β）" in page.title.string
    assert "ルールベース" in page.get_text()
    assert "生成AIではありません" in page.get_text()
    assert page.find(id="answer-rule-version")


def test_analytics_adapter_uses_allowlisted_non_free_text_fields():
    script = (ROOT / "js" / "site.js").read_text(encoding="utf-8")
    for event in (
        "goal_select", "tool_open", "analysis_run", "analysis_result_view",
        "result_export", "consultation_click", "tool_error",
    ):
        assert event in script
    for forbidden in ("link_url", "link_text", "page_location", "location.href"):
        assert forbidden not in script
    for allowed in ("goal_id", "tool_id", "prefecture_code", "dataset_version", "export_type", "error_code", "source_page"):
        assert allowed in script


def test_supply_chart_has_four_named_quadrants_and_fixed_size_points():
    model = (ROOT / "js" / "cross-analysis-model.js").read_text(encoding="utf-8")
    view = (ROOT / "js" / "cross-analysis.js").read_text(encoding="utf-8")
    for label in (
        "需要成長・高稼働型",
        "需要成長・稼働余力型",
        "需要減速・高稼働型",
        "需要減速・稼働余力型",
    ):
        assert label in model
    assert "r: selected ? 10 : 6" in model
    assert "Math.sqrt((r.lodging_establishments" not in model
    assert "scatter-table-body" in view


def test_lab_pages_get_the_shared_header_and_footer_at_build_time():
    # Every Lab page except the standalone demos and the synced signal report
    # is built by Jekyll from the shared includes.
    pages = [path for path in filter(is_published, ROOT.rglob("*.html")) if not {"demo", "tourism-market-signal"} & set(path.relative_to(ROOT).parts) and not is_redirect_stub(path)]
    assert len(pages) == 23
    for path in pages:
        source = path.read_text(encoding="utf-8")
        assert source.startswith("---\n"), path
        assert source.count("{% include site-header.html %}") == 1, path
        assert source.count("{% include site-footer.html %}") == 1, path
        page = rendered(path)
        assert "{%" not in page and "{{" not in page, path
        html = BeautifulSoup(page, "html.parser")
        assert len(html.select('.site-header[data-shell="static"]')) == 1, path
        assert len(html.select('.site-footer[data-shell="static"]')) == 1, path
        # The include comes before any page-specific hero header.
        assert html.find("header").get("data-shell") == "static", path


def test_include_and_script_shell_share_the_same_navigation():
    def links(markup):
        nav = BeautifulSoup(markup, "html.parser").select(".global-nav a")
        return [(link.get_text(strip=True), link["href"]) for link in nav]

    include = (ROOT / "_includes" / "site-header.html").read_text(encoding="utf-8")
    script = (ROOT / "js" / "site-shell.js").read_text(encoding="utf-8")
    script_header = script.split("const shellHeader = `", 1)[1].split("`;", 1)[0]
    assert links(include) == links(script_header)
    assert links(include)

    footer = (ROOT / "_includes" / "site-footer.html").read_text(encoding="utf-8")
    script_footer = script.split("const shellFooter = `", 1)[1].split("`;", 1)[0]
    assert [a["href"] for a in BeautifulSoup(footer, "html.parser").find_all("a")] == [
        a["href"] for a in BeautifulSoup(script_footer, "html.parser").find_all("a")
    ]
