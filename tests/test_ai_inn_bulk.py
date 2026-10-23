"""一斉診断の集計レポート：ページは公開集計（summary.json）だけから作り、宿ごとのデータは含まない。"""
from __future__ import annotations

import json
import re

import yaml
from bs4 import BeautifulSoup

from scripts.build_ai_inn_bulk import DATA, OUTPUT, facts, render
from site_pages import ROOT, rendered

PAGE = "ai-inn-diagnosis/bulk/index.html"
URL = "https://lab.ugatta-llc.com/ai-inn-diagnosis/bulk/"
# 宿ごとの結果に出てくる項目。公開集計のどこにも出してはいけない
PER_INN_KEYS = {"inn_id", "official_url", "rakuten_hotel_no", "rooms", "rooms_source", "quote", "evidence",
                "runs", "final", "near_miss", "inns_list", "hotel_no"}


def summary() -> dict:
    return json.loads(DATA.read_text(encoding="utf-8"))


def keys(value) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {k for v in value.values() for k in keys(v)}
    if isinstance(value, list):
        return {k for v in value for k in keys(v)}
    return set()


def test_page_is_built_from_the_current_summary() -> None:
    # summary.json を差し替えたら python scripts/build_ai_inn_bulk.py を実行する
    assert OUTPUT.read_text(encoding="utf-8") == render(summary())


def test_public_summary_has_no_per_inn_data() -> None:
    s = summary()
    assert not keys(s) & PER_INN_KEYS
    assert "inns_with_conflict" not in s["overall"]
    for g in s["markets"] + s["sizes"]:
        assert g["inns"] >= s["min_group_size"], g["group"]
    for g in s["markets"]:
        # 市場の区分は顔ぶれがわかるため、質問ごとの軒数は出さない
        assert set(g) == {"group", "inns", "inns_not_judged", "answered", "items_absent"}
        assert set(g["answered"]) == {"mean", "median", "rate"}


def test_page_reads_no_other_data() -> None:
    source = (ROOT / "scripts" / "build_ai_inn_bulk.py").read_text(encoding="utf-8")
    assert re.findall(r'ROOT / "data" / "([^"]+)"', source) == ["ai-inn-bulk"]
    page = OUTPUT.read_text(encoding="utf-8")
    assert "<script src" not in page.replace('<script src="/js/site-shell.js', "")
    assert "fetch(" not in page


def test_headline_numbers_match_the_summary() -> None:
    s, f = summary(), facts(summary())
    page = BeautifulSoup(rendered(PAGE), "html.parser")
    kpis = {k["data-kpi"]: k.dd.strong.get_text() for k in page.select(".ai-kpi")}
    assert kpis["answered"] == f"{s['overall']['answered']['mean']:.2f}"
    assert kpis["one-short"] == f"{f['one_short_per_inn']:.1f}"
    assert len(page.select("#markets .ai-bars__row")) == len(s["markets"]) + 1
    assert len(page.select("#one-short .ai-bars__row")) == 11
    assert len(page.select("#items .ai-bars__row")) == 19
    assert page.select_one(".breadcrumb li[aria-current]").get_text() == "AIに聞かれる宿 一斉診断 集計レポート"


def test_registry_home_and_llms_quote_the_current_numbers() -> None:
    f = facts(summary())
    expected = [f"{f['inns']}軒", f"{f['mean']:.1f}問", f"{f['one_short_per_inn']:.1f}問"]
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
    from scripts.build_ai_inn_bulk import series_nav
    f = facts(summary())
    sample = (ROOT / "ai-inn-diagnosis/sample/index.html").read_text(encoding="utf-8")
    # サンプルページの案内は手で置いているので、集計の数字が変わったらここで気づく
    assert series_nav(f, "sample") in sample
    assert series_nav(f, "bulk") in OUTPUT.read_text(encoding="utf-8")
    page = BeautifulSoup(sample, "html.parser")
    assert [a["href"] for a in page.select(".ai-series a")] == ["/ai-inn-diagnosis/bulk/", "/ai-inn-diagnosis/sample/", "#request"]
    assert page.select_one("#request")
    tools = [t["id"] for t in yaml.safe_load((ROOT / "_data/tools.yml").read_text(encoding="utf-8"))]
    assert tools.index("ai-inn-bulk") + 1 == tools.index("ai-inn-sample")  # 実態 → サンプルの順
