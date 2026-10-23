from __future__ import annotations

import re
from pathlib import Path

from bs4 import BeautifulSoup

from site_pages import is_redirect_stub


ROOT = Path(__file__).resolve().parents[1]
SHELL_CSS = ROOT / "css" / "site-shell.css"

# Data colors carry analytical meaning. A brand change must not alter them.
EXPECTED_DATA_COLORS = {
    "--data-self": "#b8913f",
    "--data-market": "#6f8c99",
    "--data-market-band": "rgba(43, 100, 116, .1)",
    "--data-other": "#7f9aa6",
    "--data-low": "#dcecef",
    "--data-mid": "#eee8d9",
    "--data-high": "#f0d8cc",
    "--data-unavailable": "#e8edef",
    "--data-grid": "#dce4e7",
    "--data-axis": "#5a6875",
}


def public_files(*suffixes: str) -> list[Path]:
    skip = {".git", "tourism-market-signal", "docs", "tests", "node_modules"}
    return [
        path
        for suffix in suffixes
        for path in ROOT.rglob(f"*{suffix}")
        if not skip & set(path.relative_to(ROOT).parts)
        and not (suffix == ".html" and is_redirect_stub(path))
    ]


def root_tokens(css: str) -> dict[str, str]:
    block = re.search(r":root\s*\{(.*?)\}", css, re.S)
    assert block
    return {name: value.strip() for name, value in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", block.group(1))}


HOME_DISPLAY_FONTS = {
    # family: (CSS weight query, text the subset must cover)
    "Zen+Kaku+Gothic+New": ("wght@900", "現場のヒントが見つかる実践ツール"),
    "Dela+Gothic+One": (None, "宿泊DXラボ"),
}


def test_display_faces_are_loaded_only_on_the_home_page_as_subsets() -> None:
    from urllib.parse import unquote

    for path in public_files(".html", ".css", ".js"):
        text = path.read_text(encoding="utf-8")
        if path not in DOT_NUMBER_PAGES and path not in DOT_NUMBER_CSS:
            assert "DotGothic16" not in text, path
        if path != ROOT / "index.html" and path != ROOT / "css" / "home.css":
            for family in ("Zen+Kaku", "Zen Kaku", "Dela+Gothic", "Dela Gothic"):
                assert family not in text, (path, family)
    head = BeautifulSoup((ROOT / "index.html").read_text(encoding="utf-8"), "html.parser").head
    hrefs = [link.get("href", "") for link in head.find_all("link", rel="stylesheet") if "fonts.googleapis.com" in link.get("href", "")]
    for family, (weight, shown) in HOME_DISPLAY_FONTS.items():
        matches = [href for href in hrefs if family in href]
        assert len(matches) == 1, family
        href = matches[0]
        assert "display=swap" in href and "text=" in href, href
        if weight:
            assert f"{family}:{weight}" in href, href
        else:
            assert "wght" not in href, href
        subset = unquote(re.search(r"text=([^&]+)", href).group(1))
        assert set(shown) <= set(subset), (family, set(shown) - set(subset))


# DotGothic16 is back for numbers only (2026-10-16): the home page's group
# numbers 01〜04 and the DX diagnosis question numbers, answered count and score.
DOT_NUMBER_PAGES = {ROOT / "index.html": "01234", ROOT / "dx-diagnosis.html": "Q0123456789"}
DOT_NUMBER_CSS = {ROOT / "css" / "home.css", ROOT / "css" / "dx-diagnosis.css"}


def test_dot_face_is_a_numbers_only_subset() -> None:
    from urllib.parse import unquote

    for path, glyphs in DOT_NUMBER_PAGES.items():
        head = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser").head
        hrefs = [link.get("href", "") for link in head.find_all("link", rel="stylesheet") if "DotGothic16" in link.get("href", "")]
        assert len(hrefs) == 1, path
        assert "display=swap" in hrefs[0], hrefs[0]
        assert unquote(re.search(r"text=([^&]+)", hrefs[0]).group(1)) == glyphs, hrefs[0]
    home = BeautifulSoup((ROOT / "index.html").read_text(encoding="utf-8"), "html.parser")
    numbers = [node.get_text() for node in home.select(".tool-group__heading .tool-group__num[aria-hidden=true]")]
    assert numbers == ["01", "02", "03", "04"]
    assert set("".join(numbers)) <= set(DOT_NUMBER_PAGES[ROOT / "index.html"])


NOTO_URL = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap"


def test_pages_link_web_fonts_in_head_instead_of_css_import() -> None:
    assert not re.search(r"@import\s+url", SHELL_CSS.read_text(encoding="utf-8"))
    shell_pages = [path for path in public_files(".html") if "site-shell.css" in path.read_text(encoding="utf-8")]
    assert len(shell_pages) == 23
    for path in shell_pages:
        head = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser").head
        preconnects = [link.get("href") for link in head.find_all("link", rel="preconnect")]
        assert preconnects == ["https://fonts.googleapis.com", "https://fonts.gstatic.com"], path
        assert head.find("link", rel="preconnect", href="https://fonts.gstatic.com").has_attr("crossorigin"), path

        stylesheets = [link.get("href", "") for link in head.find_all("link", rel="stylesheet")]
        fonts = [href for href in stylesheets if "fonts.googleapis.com" in href]
        # Font CSS must be discoverable before any site stylesheet.
        assert stylesheets[: len(fonts)] == fonts, path
        assert fonts[0] == NOTO_URL, path
        # Home adds its two subset display faces and the dot numbers; classics notes add their mincho;
        # the DX diagnosis adds the dot numbers; other tools load Noto only.
        expected = 4 if path == ROOT / "index.html" else 2 if "classics-ai-management" in path.parts or path in DOT_NUMBER_PAGES else 1
        assert len(fonts) == expected, path


def test_shell_tokens_do_not_override_page_font_variables() -> None:
    # site-shell.css loads on classics pages too; their mincho --serif must survive.
    tokens = root_tokens(SHELL_CSS.read_text(encoding="utf-8"))
    assert not {"--serif", "--sans", "--latin"} & tokens.keys()
    assert tokens["--lab-font-sans"].startswith('"Noto Sans JP"')


def test_data_colors_are_pinned() -> None:
    tokens = root_tokens(SHELL_CSS.read_text(encoding="utf-8"))
    for name, value in EXPECTED_DATA_COLORS.items():
        assert tokens[name] == value, name


def test_lab_number_marks_and_their_styles_are_gone() -> None:
    # Decorative "LAB 01" codes and English eyebrows were dropped with the 2026-10 redesign.
    for path in public_files(".html"):
        page = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
        assert not page.select(".lab-code, .lab-eyebrow, .tool-group__index"), path
    for path in public_files(".css"):
        css = path.read_text(encoding="utf-8")
        assert "lab-code" not in css and "lab-eyebrow" not in css and "--lab-font-dot" not in css, path


def test_home_page_has_no_english_decoration() -> None:
    page = BeautifulSoup((ROOT / "index.html").read_text(encoding="utf-8"), "html.parser")
    for node in page.select("main .eyebrow, main h1, main h2, main h3"):
        text = node.get_text(" ", strip=True)
        assert not re.fullmatch(r"[A-Z0-9 !'&.-]+", text), text
    assert not page.select("main .eyebrow")
    # Meaningful short labels stay.
    body = page.get_text(" ", strip=True)
    assert "NEW" in body and "DX" in body and "PMS" in body and "AI" in body


def test_classics_pages_keep_their_own_typography() -> None:
    pages = [path for path in (ROOT / "classics-ai-management").rglob("*.html") if not is_redirect_stub(path)]
    assert pages
    for path in pages:
        page = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
        hrefs = [link.get("href", "") for link in page.find_all("link", rel="stylesheet")]
        assert not any("useful.css" in href for href in hrefs), path
        assert any("classics.css" in href for href in hrefs), path


def test_hotel_gold_only_identifies_the_selected_property() -> None:
    css = (ROOT / "css/hotel-price-trends.css").read_text(encoding="utf-8")
    gold_selectors = set()
    for selector, declarations in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        assert not re.search(r"#(?:b8913f|c79832)|var\(--gold\)", declarations), selector
        if "var(--data-self)" in declarations:
            gold_selectors.add(selector.strip())
            assert not re.search(r"(?:^|;)color:var\(--data-self\)", declarations)
    assert gold_selectors == {
        ".hpt-profile", ".hpt-selected-line", ".hpt-selected-dot",
        ".hpt-chart-legend .selected", ".hpt-position--selected .hpt-position__bar",
        ".hpt-rating-track i", ".hpt-core-row--selected",
        ".hpt-core-row--selected .hpt-core-row__index",
        ".hpt-core-row--selected .hpt-spark-line", ".hpt-core-row--selected .hpt-spark-dot",
    }
    assert ".hpt-rating-track b{" in css
    marker = re.search(r"\.hpt-rating-track b\{([^}]+)\}", css).group(1)
    assert "background:var(--data-market)" in marker
    js = (ROOT / "js/hotel-price-trends.js").read_text(encoding="utf-8")
    assert "金色の印" not in js
    assert "金色の棒：選択施設 ／ 線の印：" in js


def test_hotel_calendar_and_legend_share_fixed_semantic_tokens() -> None:
    css = (ROOT / "css/hotel-price-trends.css").read_text(encoding="utf-8")
    for level, token in [("low", "low"), ("mid", "mid"), ("high", "high"), ("none", "unavailable")]:
        assert f".hpt-legend-{level}:before,.hpt-calendar-cell--{level}{{background:var(--data-{token})}}" in css


def test_tool_page_heroes_carry_no_english_eyebrow() -> None:
    for filename in (
        "hotel-price-trends.html", "dx-diagnosis.html", "management-ai.html", "inbound-analysis.html", "report.html",
    ):
        page = BeautifulSoup((ROOT / filename).read_text(encoding="utf-8"), "html.parser")
        assert not page.select(".page-hero .eyebrow"), filename
        assert not re.search(r"(?:CROSS ANALYSIS|ISSUE ORGANIZER|MARKET SIGNAL|PRICE TRENDS|DX CHECK)", page.get_text()), filename


def test_caution_notes_are_labeled_without_gold_decoration() -> None:
    css = (ROOT / "css/useful.css").read_text(encoding="utf-8")
    for selector in [".survey-change-note", ".state-warning", ".trend-boundary-line"]:
        rule = re.search(re.escape(selector) + r"\{([^}]+)\}", css).group(1)
        assert "var(--lab-navy)" in rule
        assert "--gold" not in rule and "--data-self" not in rule
    for filename in ["inbound-analysis.html"]:
        page = BeautifulSoup((ROOT / filename).read_text(encoding="utf-8"), "html.parser")
        for note in page.select(".survey-change-note"):
            assert note.get_text().startswith("注意：")


def test_analysis_styles_use_loaded_weights() -> None:
    for filename in ["useful.css", "hotel-price-trends.css", "dx-diagnosis.css"]:
        css = (ROOT / "css" / filename).read_text(encoding="utf-8")
        assert not re.search(r"font(?:-weight)?:600", css)
        assert "font-size:9px" not in css
        for selector, declarations in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
            assert not re.search(r"(?:^|;)color:var\(--(?:data-self|gold)\)", declarations)


def test_diagnosis_gold_is_limited_to_own_score_visuals() -> None:
    css = (ROOT / "css/dx-diagnosis.css").read_text(encoding="utf-8")
    assert "var(--gold)" not in css
    assert {selector.strip() for selector, body in re.findall(r"([^{}]+)\{([^{}]*)\}", css)
            if "var(--data-self)" in body} == {".dx-score-ring", ".dx-scale-marker", ".dx-top-badge"}
