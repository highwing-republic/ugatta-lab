"""一斉診断の集計レポート：ページは非公開の集計から作った HTML だけで、集計データや宿ごとのデータは置かない。"""
from __future__ import annotations

import re

import yaml
from bs4 import BeautifulSoup

from site_pages import ROOT, rendered

PAGE = "ai-inn-diagnosis/bulk/index.html"
URL = "https://lab.ugatta-llc.com/ai-inn-diagnosis/bulk/"
# 宿ごとの結果に出てくる項目。ページのどこにも出してはいけない
PER_INN_KEYS = ("inn_id", "official_url", "rakuten_hotel_no", "rooms_source", "near_miss", "hotel_no", "summary.json")


def source() -> str:
    return (ROOT / PAGE).read_text(encoding="utf-8")


def page() -> BeautifulSoup:
    return BeautifulSoup(rendered(PAGE), "html.parser")


def test_no_aggregate_or_per_inn_data_in_this_repository() -> None:
    # 集計JSONは公開しない。ページの HTML だけを置く
    assert not (ROOT / "data" / "ai-inn-bulk").exists()
    assert not list(ROOT.glob("scripts/*ai_inn_bulk*"))
    text = source()
    for key in PER_INN_KEYS:
        assert key not in text, key
    assert "fetch(" not in text
    assert "<script src" not in text.replace('<script src="/js/site-shell.js', "")


def test_page_structure() -> None:
    p = page()
    assert len(p.select("#one-short .ai-bars__row")) == 11
    assert len(p.select("#items .ai-bars__row")) == 19
    assert p.select_one(".breadcrumb li[aria-current]").get_text() == "AIに聞かれる宿 一斉診断 集計レポート"


def test_registry_home_and_llms_quote_the_page_numbers() -> None:
    p = page()
    kpis = {k["data-kpi"]: k.dd.strong.get_text() for k in p.select(".ai-kpi")}
    inns = re.search(r"(\d+)軒", p.select_one(".scope-badge").get_text()).group(1)
    expected = [f"{inns}軒", f"{float(kpis['answered']):.1f}問", f"{kpis['one-short']}問"]
    tool = next(t for t in yaml.safe_load((ROOT / "_data/tools.yml").read_text(encoding="utf-8")) if t["id"] == "ai-inn-bulk")
    assert tool["url"] == "/ai-inn-diagnosis/bulk/"
    home = BeautifulSoup((ROOT / "index.html").read_text(encoding="utf-8"), "html.parser")
    card = home.select_one('a[data-tool-id="ai-inn-bulk"]').get_text()
    llms = next(line for line in (ROOT / "llms.txt").read_text(encoding="utf-8").splitlines() if URL in line)
    for text in (tool["summary"], card, llms):
        for number in expected:
            assert number in text, (number, text)
    assert f"<loc>{URL}</loc>" in (ROOT / "sitemap.xml").read_text(encoding="utf-8")


def test_both_ai_inn_pages_share_the_same_three_step_path() -> None:
    bulk = BeautifulSoup(source(), "html.parser").select_one("nav.ai-series")
    sample = BeautifulSoup((ROOT / "ai-inn-diagnosis/sample/index.html").read_text(encoding="utf-8"), "html.parser")
    nav = sample.select_one("nav.ai-series")
    # サンプルページの案内は手で置いているので、集計の数字が変わったらここで気づく
    strip = lambda n: [(a["href"], a.get_text()) for a in n.select("a")]
    assert strip(nav) == strip(bulk)
    assert bulk.select_one('a[aria-current]')["href"] == "/ai-inn-diagnosis/bulk/"
    assert nav.select_one('a[aria-current]')["href"] == "/ai-inn-diagnosis/sample/"
    assert [a["href"] for a in nav.select("a")] == ["/ai-inn-diagnosis/bulk/", "/ai-inn-diagnosis/sample/", "#request"]
    assert sample.select_one("#request")
    tools = [t["id"] for t in yaml.safe_load((ROOT / "_data/tools.yml").read_text(encoding="utf-8"))]
    assert tools.index("ai-inn-bulk") + 1 == tools.index("ai-inn-sample")  # 実態 → サンプルの順
