"""ビジネスホテル版料金トレンドの「催しカレンダー」（events.json）。"""
import json
from datetime import date

import pytest

from scripts import business_hotel_events as ev
from scripts import update_business_hotel_prices as bh

COHORT = bh.load_cohort()
PATH = bh.DATA_DIR / ev.EVENTS_FILE


def event(**overrides):
    base = {"market": "naha", "name": "NAHAマラソン", "start": "2026-12-06", "end": "2026-12-06", "venue": "奥武山公園発着",
            "category": "marathon", "note": "市民マラソン", "sources": [{"url": "https://example.jp/naha", "title": "大会案内"}]}
    return {**base, **overrides}


def calendar(*events):
    return {"schema_version": 2, "researched_on": "2026-10-16", "coverage": {"start": "2026-10-16", "end": "2026-12-15"}, "events": list(events)}


def test_saved_calendar_is_valid():
    data = json.loads(PATH.read_text(encoding="utf-8"))
    assert ev.validate(data, COHORT) == []
    assert data["events"], "催しが1件もない"
    assert {e["market"] for e in data["events"]} <= {m["code"] for m in COHORT["markets"]}


def test_valid_event_passes():
    assert ev.validate(calendar(event()), COHORT) == []


@pytest.mark.parametrize("overrides, message", [
    ({"market": "tokyo"}, "市場コード"),
    ({"start": "2026-12-07", "end": "2026-12-06"}, "start <= end"),
    ({"start": "2027-01-10", "end": "2027-01-10"}, "調査期間"),
    ({"category": "party"}, "category"),
    ({"note": "ホテルは満室の見込み"}, "料金・満室"),
    ({"name": "料金が上がる祭り"}, "料金・満室"),
    ({"sources": []}, "sources"),
    ({"sources": [{"url": "javascript:alert(1)", "title": "x"}]}, "出典"),
    ({"venue": ""}, "venue が空"),
])
def test_invalid_events_are_reported(overrides, message):
    errors = ev.validate(calendar(event(**overrides)), COHORT)
    assert any(message in error for error in errors), errors


def test_duplicates_are_reported():
    assert any("重複" in error for error in ev.validate(calendar(event(), event()), COHORT))


def test_merge_combines_city_files_in_date_order(tmp_path):
    for market in COHORT["markets"]:
        events = []
        if market["code"] == "naha":
            events = [event(), event(name="首里城祭", start="2026-10-31", end="2026-11-03", category="festival", note="")]
        (tmp_path / f"{market['code']}.json").write_text(json.dumps({"market": market["code"], "events": events}, ensure_ascii=False), encoding="utf-8")
    data = ev.merge(tmp_path, date(2026, 11, 1), COHORT)
    assert data["coverage"] == {"start": "2026-11-01", "end": "2026-12-31"}
    assert [e["name"] for e in data["events"]] == ["首里城祭", "NAHAマラソン"]
    assert data["events"][0]["note"] is None
    assert ev.validate(data, COHORT) == []


def test_merge_requires_every_city(tmp_path):
    with pytest.raises(FileNotFoundError):
        ev.merge(tmp_path, date(2026, 11, 1), COHORT)


def test_page_labels_event_candidates_as_ai_reference():
    from bs4 import BeautifulSoup
    from site_pages import rendered

    page = BeautifulSoup(rendered("business-hotel-price-trends.html"), "html.parser")
    box = page.select_one("#bht-events")
    assert box is not None and box.has_attr("hidden")  # 読み込めたときだけ出す
    assert "AI調べ・参考" in box.get_text()
    assert "料金が上がった理由と確かめたものではありません" in box.get_text()
    assert page.select_one("#bht-market-events") is not None
    assert "週1回" in page.select_one(".bht-method").get_text()
