"""旅館のAIO対策｜AIに聞かれる宿 診断 サンプル: the before/after numbers must agree with each other and with the demo sites."""
from __future__ import annotations

import json
import re
from collections import Counter

import yaml
from bs4 import BeautifulSoup

from scripts.build_demo_hotel import HTML_LANG, LANGS, URLS, output_path, render
from site_pages import ROOT, rendered

PAGE = "ai-inn-diagnosis/sample/index.html"
URL = "https://lab.ugatta-llc.com/ai-inn-diagnosis/sample/"
BEFORE = "demo/hotel-before/index.html"
AFTER = "demo/hotel/index.html"


def page() -> BeautifulSoup:
    return BeautifulSoup(rendered(PAGE), "html.parser")


def kpi(soup: BeautifulSoup, label: str) -> tuple[int, int, int]:
    """(before, after, total) of one summary figure."""
    for item in soup.select(".ai-kpi"):
        if item.dt.get_text(strip=True) == label:
            before = int(item.select_one(".ai-before").get_text())
            after = int(item.select_one("strong").get_text())
            total = int(re.search(r"/\s*(\d+)", item.dd.get_text()).group(1))
            return before, after, total
    raise AssertionError(label)


def tag(cell) -> str:
    return cell.select_one(".ai-tag").get_text(strip=True)


def column(rows, index: int) -> Counter:
    return Counter(tag(row.select("td")[index]) for row in rows)


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_sample_is_listed_and_reachable_from_the_home_page() -> None:
    tools = yaml.safe_load(read("_data/tools.yml"))
    entry = next(tool for tool in tools if tool["id"] == "ai-inn-sample")
    assert entry["url"] == "/ai-inn-diagnosis/sample/"
    assert entry["group"] == "facility"
    assert "AIO" in entry["summary"] and "対策前" in entry["summary"]
    assert "AIO対策を行った後" in next(tool for tool in tools if tool["id"] == "hotel-site-demo")["summary"]

    home = BeautifulSoup(read("index.html"), "html.parser")
    card = home.select_one('section[aria-labelledby="facility-tools"] a[data-tool-id="ai-inn-sample"]')
    assert card and card["href"] == "/ai-inn-diagnosis/sample/"
    assert "AIO対策" in card.get_text()
    graph = json.loads(home.find("script", type="application/ld+json").string)["@graph"]
    items = next(node for node in graph if node["@type"] == "CollectionPage")["mainEntity"]
    listed = items["itemListElement"]
    assert URL in [item["url"] for item in listed]
    assert items["numberOfItems"] == len(listed)
    assert [item["position"] for item in listed] == list(range(1, len(listed) + 1))

    sitemap = read("sitemap.xml")
    assert f"<loc>{URL}</loc>" in sitemap
    for url in URLS.values():
        assert f"<loc>https://lab.ugatta-llc.com{url}</loc>" in sitemap, url
    assert "hotel-before" not in sitemap
    assert "geo-diagnosis" not in sitemap and not (ROOT / "geo-diagnosis").exists()


def test_sample_is_framed_as_ryokan_aio_and_says_the_hotel_is_fictional() -> None:
    soup = page()
    assert soup.find("link", rel="canonical")["href"] == URL
    assert soup.find("meta", attrs={"name": "robots"})["content"].startswith("index,follow")
    title = soup.title.get_text()
    assert "旅館のAIO対策" in title and "AIに聞かれる宿" in title and "GEO" not in title
    assert "旅館のAIO対策" in soup.select_one(".page-hero .scope-badge").get_text()
    assert "架空の宿" in soup.select_one(".page-hero").get_text(" ", strip=True)
    sources = soup.select("#aio tbody tr")
    assert [row.th.get_text(strip=True) for row in sources] == ["公式サイトの本文", "構造化データ", "Googleビジネスプロフィール", "予約サイトと口コミ"]


def test_before_and_after_sites_are_both_shown_on_the_page() -> None:
    soup = page()
    sites = soup.select("#sites .ai-site")
    # The sites load only when the reader asks, so the report does not pull in both demos on every visit.
    assert not soup.select("#sites iframe")
    buttons = [site.select_one("[data-frame-src]") for site in sites]
    assert [button["data-frame-src"] for button in buttons] == ["/demo/hotel-before/", "/demo/hotel/"]
    assert "対策前のサイト" in sites[0].figcaption.get_text()
    assert "対策後のサイト" in sites[1].figcaption.get_text()
    for site, button in zip(sites, buttons):
        assert button["data-frame-title"] and site.figcaption.a["href"] == button["data-frame-src"]
        image = site.select_one(".ai-site__screen img")
        assert image["alt"] and image["loading"] == "lazy"
        assert (ROOT / image["src"].lstrip("/")).exists(), image["src"]
    front_matter = yaml.safe_load(read(PAGE).split("---")[1])
    sources = {source["name"]: source.get("url") for source in front_matter["tool_sources"]}
    assert sources["対策前のサイト"] == "/demo/hotel-before/"
    assert sources["対策後のサイト"] == "/demo/hotel/"


def test_sample_keeps_its_own_method_and_wording() -> None:
    # The report is built on answer checks, not on a weighted 100-point rubric.
    text = rendered(PAGE)
    for borrowed in ("GEO診断", "総合スコア", "6軸", "100点満点", "貼る前に宿側で確認すること", "判定 C"):
        assert borrowed not in text, borrowed


def test_answers_match_the_summary_and_the_journey_map() -> None:
    soup = page()
    rows = soup.select("#answers tbody tr")
    assert len(rows) == 12
    before = Counter(row["data-before"] for row in rows)
    after = Counter(row["data-after"] for row in rows)
    assert before == {"ok": 3, "caution": 1, "ask": 8}
    assert after == {"ok": 12}
    answered = (before["ok"] + before["caution"], after["ok"] + after["caution"], 12)
    assert kpi(soup, "旅館らしい質問にAIが答えられた数") == answered
    assert kpi(soup, "「宿に確認を」で終わった質問") == (before["ask"], after["ask"], 12)
    for row in rows:
        cells = row.select("td")
        assert f"ai-tag--{row['data-before']}" in cells[1].select_one(".ai-tag")["class"], row.th.get_text()
        assert f"ai-tag--{row['data-after']}" in cells[3].select_one(".ai-tag")["class"], row.th.get_text()

    # The journey map draws the state before the fixes.
    stages = ["know", "compare", "book", "go", "stay"]
    blocks = soup.select(".ai-journey > .ai-stage")
    assert [stage.h3.get_text(strip=True) for stage in blocks] == ["知る", "比べる", "予約する", "向かう", "泊まる"]
    for key, stage in zip(stages, blocks):
        expected = Counter(row["data-before"] for row in rows if row["data-stage"] == key)
        chips = Counter(chip["class"][1].removeprefix("ai-chip--") for chip in stage.select(".ai-chip"))
        assert chips == expected, key
        # A stage is drawn as broken when the AI could not answer more than half of its questions.
        broken = expected["ask"] * 2 > sum(expected.values())
        assert ("ai-stage--break" in stage["class"]) == broken, key
    assert len(soup.select("#answers .ai-next li")) == 3


def test_fact_sheet_counts_match_its_heading_and_summary() -> None:
    soup = page()
    rows = soup.select("#facts tbody tr")
    heading = soup.find(id="facts-title").get_text()
    total, missing = map(int, re.search(r"(\d+)項目のうち(\d+)項目がどこにも", heading).groups())
    before = column(rows, 2)
    assert len(rows) == total == 19
    assert before["どこにもない"] == missing == 10
    assert before["そろっている"] == 2 and before["食い違い"] == 1
    assert kpi(soup, "どこにも書かれていない旅館の情報") == (missing, 0, total)
    for row in rows:
        assert "ai-tag--ok" in row.select("td")[3].select_one(".ai-tag")["class"], row.th.get_text()
    fields = {row.select("td")[0].get_text(strip=True) for row in rows}
    assert fields == {"温泉", "食事", "客室", "家族", "規約", "アクセス"}


def test_checklist_count_matches_its_heading() -> None:
    soup = page()
    rows = soup.select("#checklist tbody tr")
    heading = soup.find(id="checklist-title").get_text()
    total, done_before, done_after = map(int, re.search(r"(\d+)項目中(\d+)項目から(\d+)項目", heading).groups())
    before, after = column(rows, 2), column(rows, 3)
    assert len(rows) == total == 15
    assert before["済"] == done_before == 1
    assert after["済"] == done_after == 10
    assert after == {"済": 10, "一部": 2, "見本のみ": 1, "対象外": 2}
    levels = [row.select_one(".ai-level")["class"][1] for row in rows]
    assert levels == sorted(levels), "checklist must run from level 1 to level 4"
    assert levels[0] == "ai-level--1" and "夕食" in rows[0].th.get_text()


def test_language_table_matches_the_demo_language_pages() -> None:
    soup = page()
    rows = soup.select("#languages tbody tr")
    assert len(rows) == 4
    assert [tag(row.select("td")[1]) for row in rows] == ["読める", "読めない", "読めない", "読めない"]
    assert [tag(row.select("td")[2]) for row in rows] == ["読める"] * 4
    assert [row.a["href"] for row in rows] == [URLS[lang] for lang in LANGS]
    assert kpi(soup, "外国語でAIに読まれるページ") == (0, 3, 3)
    assert soup.select_one('#languages a[href="/inbound-analysis.html"]')


def test_code_example_matches_the_after_site() -> None:
    soup = page()
    text = soup.find(id="code-hotel").get_text()
    data = json.loads(re.search(r"(\{.*\})", text, re.S).group(1))
    assert data["@type"] == "Hotel" and data["numberOfRooms"] == 20
    assert data["checkinTime"] == "15:00" and data["checkoutTime"] == "10:00"
    assert data["url"] == "https://lab.ugatta-llc.com/demo/hotel/"
    assert data["availableLanguage"] == [HTML_LANG[lang] for lang in LANGS]
    after = read(AFTER)
    for fact in ("ナトリウム－塩化物泉", "15:00〜24:00、6:00〜9:00", "40分・2,200円"):
        assert fact in text and fact in after, fact
    for button in soup.select("[data-copy-target]"):
        assert soup.find(id=button["data-copy-target"]), button["data-copy-target"]


def test_after_site_states_the_facts_the_report_says_it_does() -> None:
    after = read(AFTER)
    for fact in (
        "源泉かけ流し", "ナトリウム－塩化物泉", "15:00〜24:00、6:00〜9:00", "1回40分・2,200円", "前日17時まで",
        "部屋食はございません", "1名1,500円", "落花生", "全20室（和室4、ツイン8、シングル8）", "30㎡・定員4名",
        "22㎡・定員2名", "14㎡・定員1名", "¥6,000〜¥16,000", "¥8,000〜¥12,000", "1名1泊", "4名1室利用で1名6,000円", "ありません。男女別", "添い寝は無料",
        "お子さま朝食は1名800円", "前日50%、当日100%", "現金とクレジットカード", "入湯税", "蓮池駅から車で約10分",
        "20台・無料", "15:00〜22:00", "10:00まで",
    ):
        assert fact in after, fact
    soup = BeautifulSoup(after, "html.parser")
    for name in (soup.title.get_text(), soup.h1.get_text()):
        assert "蓮池温泉" in name and "ホテル翠蓮" in name, name
    booking = read("demo/booking/index.html")
    # 朝食料金は予約エンジンと PMS の精算で共用する js/suiren-demo-data.js にある
    shared = read("js/suiren-demo-data.js")
    assert "const BREAKFAST = 1500;" in shared and "const BF = SuirenDemo.BREAKFAST;" in booking
    assert "const BATH_TAX = 150;" in shared and "現地精算" in booking
    assert "朝食付き" in booking and "夕食" not in booking


def test_before_site_is_frozen_for_comparison() -> None:
    soup = BeautifulSoup(read(BEFORE), "html.parser")
    assert soup.find("meta", attrs={"name": "robots"})["content"] == "noindex,follow"
    assert soup.find("link", rel="canonical")["href"] == "https://lab.ugatta-llc.com/demo/hotel-before/"
    band = soup.select_one(".before-band")
    assert "対策前のサイト" in band.get_text()
    assert {a["href"] for a in band.find_all("a")} == {"/demo/hotel/", "/ai-inn-diagnosis/sample/"}
    text = read(BEFORE)
    for fact in ("15:00 − 22:00", "全20室", "20台・無料", "¥24,000", "季節の会席", "15:00〜24:00、6:00〜9:00"):
        assert fact in text, fact
    for absent in ("泉質", "かけ流し", "貸切", "部屋食", "アレルギー", "送迎", "添い寝", "キャンセル料"):
        assert absent not in text, absent
    for image in soup.find_all("img"):
        assert (ROOT / image["src"].lstrip("/")).exists(), image["src"]


def test_generated_demo_pages_are_up_to_date() -> None:
    for lang in LANGS:
        on_disk = output_path(lang).read_text(encoding="utf-8").replace("\r\n", "\n")
        assert on_disk == render(lang).replace("\r\n", "\n"), f"run python scripts/build_demo_hotel.py ({lang})"


def test_demo_language_pages_point_to_each_other() -> None:
    expected = {HTML_LANG[lang]: f"https://lab.ugatta-llc.com{URLS[lang]}" for lang in LANGS}
    expected["x-default"] = expected["ja"]
    for lang in LANGS:
        soup = BeautifulSoup(output_path(lang).read_text(encoding="utf-8"), "html.parser")
        assert soup.html["lang"] == HTML_LANG[lang]
        assert soup.find("link", rel="canonical")["href"] == f"https://lab.ugatta-llc.com{URLS[lang]}"
        alternates = {link["hreflang"]: link["href"] for link in soup.find_all("link", rel="alternate", hreflang=True)}
        assert alternates == expected, lang
        # The hotel is fictional: never describe it to search engines as a real business.
        assert not soup.find("script", type="application/ld+json"), lang
        for image in soup.find_all("img"):
            assert (ROOT / image["src"].lstrip("/")).exists(), image["src"]



def test_inquiry_button_is_marked_as_in_preparation() -> None:
    # Diagnosis requests are not open yet: the button says so and leads nowhere.
    cta = page().select_one("#request .ai-cta")
    assert "診断について問い合わせる（準備中）" in cta.get_text()
    assert "準備中" in cta.p.get_text() and "お問い合わせください" not in cta.get_text()
    assert not cta.find("a")


def test_sample_styles_follow_the_lab_brand_rules() -> None:
    css = read("css/ai-inn.css")
    assert "--data-self" not in css and "--gold" not in css
    assert not re.search(r"font(?:-weight)?:600", css)
    assert not re.search(r"font-size:(?:[0-9]|10)px", css)
