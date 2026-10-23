"""Search basics for the Lab: site name, operator, breadcrumbs and honest counts.

The home page names the site and says who it is for; the structured data ties the
Lab to its operator (合同会社UGATTA) and its note account, so search engines can
tell the official site from the note profile of the same name.
"""
import json
import re

import yaml
from bs4 import BeautifulSoup

from site_pages import ROOT, rendered

LAB = "https://lab.ugatta-llc.com/"
LAB_ORG = LAB + "#organization"
UGATTA_ORG = "https://ugatta-llc.com/#organization"
NOTE = "https://note.com/hotel_dx_lab"
TOOL_PAGES = [
    "dx-diagnosis.html", "inbound-analysis.html",
    "management-ai.html", "hotel-price-trends.html", "report.html",
    "business-hotel-price-trends.html", "kpi-calculator.html", "ota-fee-simulator.html", "security-check.html",
    "ai-time-estimate.html",
]


def soup(path):
    return BeautifulSoup(rendered(path), "html.parser")


def graph(page):
    nodes = []
    for script in page.select('script[type="application/ld+json"]'):
        data = json.loads(script.string)
        nodes.extend(data.get("@graph", [data]))
    return nodes


def by_type(nodes, kind):
    return [node for node in nodes if node.get("@type") == kind]


def test_home_title_and_description_name_the_site_and_its_audience():
    page = soup("index.html")
    title = page.title.get_text()
    assert title.startswith("宿泊DXラボ｜") and "旅館・ホテル" in title
    assert page.find("meta", property="og:title")["content"] == title
    assert page.find("meta", attrs={"name": "twitter:title"})["content"] == title
    description = page.find("meta", attrs={"name": "description"})["content"]
    assert description.startswith("宿泊DXラボは、旅館・ホテル") and "合同会社UGATTA" in description
    assert "旅館・ホテル" in page.select_one(".home-hero__lead").get_text()


def test_home_structured_data_links_site_operator_and_note():
    nodes = graph(soup("index.html"))
    [site] = by_type(nodes, "WebSite")
    assert site["name"] == "宿泊DXラボ" and site["url"] == LAB
    assert site["alternateName"] == ["HOTEL DX Lab"]
    assert site["publisher"] == {"@id": LAB_ORG}
    orgs = {node["@id"]: node for node in by_type(nodes, "Organization")}
    lab = orgs[LAB_ORG]
    assert lab["name"] == "宿泊DXラボ" and lab["url"] == LAB
    assert lab["parentOrganization"] == {"@id": UGATTA_ORG}
    assert NOTE in lab["sameAs"]
    assert orgs[UGATTA_ORG]["name"] == "合同会社UGATTA"
    assert orgs[UGATTA_ORG]["url"] == "https://ugatta-llc.com/"


def test_home_tool_count_matches_the_tool_registry():
    tools = yaml.safe_load((ROOT / "_data/tools.yml").read_text(encoding="utf-8"))
    reports = [tool for tool in tools if "サンプル" in tool["tag"] or "調査レポート" in tool["tag"]]
    text = soup("index.html").select_one(".tool-groups > p").get_text()
    count = int(re.search(r"公開中の(\d+)ツール", text).group(1))
    assert count == len(tools) - len(reports)
    assert reports and "サンプルレポート" in text and "調査レポート" in text


def test_tool_pages_have_breadcrumbs_and_name_the_lab_as_provider():
    for path in TOOL_PAGES:
        page = soup(path)
        canonical = page.find("link", rel="canonical")["href"]
        nodes = graph(page)
        [crumbs] = by_type(nodes, "BreadcrumbList")
        items = crumbs["itemListElement"]
        visible = [item.get_text(strip=True) for item in page.select("nav.breadcrumb li")]
        assert len(items) == len(visible) == 3, path
        assert items[0]["item"] == LAB and items[-1]["item"] == canonical, path
        for app in by_type(nodes, "WebApplication"):
            assert app["provider"]["@id"] == LAB_ORG, path


def scope_text(path, label):
    page = soup(path)
    for row in page.select(".tool-overview__scope > div"):
        if row.dt.get_text(strip=True) == label:
            return row.dd.get_text(strip=True)
    raise AssertionError((path, label))


def test_price_trends_names_its_observed_markets_without_javascript():
    text = scope_text("hotel-price-trends.html", "対象")
    count, names = re.match(r"全国(\d+)市場（(.+?)）", text).groups()
    names = names.split("・")
    manifest = json.loads((ROOT / "data/hotel-price-trends/manifest.json").read_text(encoding="utf-8"))
    observed = {region["name"] for region in manifest["regions"]}
    assert len(names) == int(count) and len(set(names)) == len(names)
    assert set(names) <= observed, set(names) - observed


def test_dx_diagnosis_names_all_eight_categories_without_javascript():
    model = (ROOT / "js/dx-diagnosis-model.js").read_text(encoding="utf-8")
    categories = list(dict.fromkeys(re.findall(r'id: "\w+", category: "([^"]+)"', model)))
    text = scope_text("dx-diagnosis.html", "条件")
    assert len(categories) == 8 and f"{len(categories)}カテゴリ" in text
    assert all(category in text for category in categories), categories


def test_area_headings_read_naturally_before_the_data_loads():
    for path, fallback in [
        ("inbound-analysis.html", "選択した地域"),
    ]:
        assert soup(path).find(id="selected-area-name").get_text() == fallback, path
