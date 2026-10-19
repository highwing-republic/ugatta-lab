"""ビジネスホテル版料金トレンドの「催しカレンダー」（events.json）をまとめて検証する。

催しは週1回、docs/business-hotel-events-research.md の手順で調べる（GitHub Actions の research-business-hotel-events.yml）。
調べた結果は都市ごとの JSON に書き、このスクリプトで1つの events.json にまとめる。

  python scripts/business_hotel_events.py merge DIR --researched-on 2026-11-01   # DIR/<code>.json をまとめて保存
  python scripts/business_hotel_events.py check                                  # 保存済みの events.json を検証

検証すること: 市場コード、日付の形と順序、調査期間に重なること、出典URL（http/https）、
文に料金・満室・予約などの推測が入っていないこと、同じ催しの重複。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

try:
    from scripts.update_business_hotel_prices import DATA_DIR, load_cohort
except ImportError:  # pragma: no cover  (python scripts/business_hotel_events.py で動かすとき)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from scripts.update_business_hotel_prices import DATA_DIR, load_cohort

EVENTS_FILE = "events.json"
SCHEMA_VERSION = 2
COVERAGE_DAYS = 60
CATEGORIES = {"concert", "sports", "marathon", "convention", "trade_show", "festival", "exam"}
NAME_LIMIT = 60
VENUE_LIMIT = 40
NOTE_LIMIT = 40
MAX_SOURCES = 2
# 料金や客室の埋まり具合の推測は載せない（料金は別に集計している）
FORBIDDEN_IN_TEXT = re.compile(r"円|％|%|倍|満室|空室|料金|価格|値上|高騰|予約|混雑")
URL = re.compile(r"^https?://[^\s\"'<>]+$")


def _date(value) -> date | None:
    try:
        return date.fromisoformat(value) if isinstance(value, str) and len(value) == 10 else None
    except ValueError:
        return None


def validate(data: dict, cohort: dict) -> list[str]:
    """events.json の問題を文で返す（空なら問題なし）。"""
    errors: list[str] = []
    codes = {m["code"] for m in cohort["markets"]}
    if data.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"schema_version は {SCHEMA_VERSION}")
    researched = _date(data.get("researched_on"))
    coverage = data.get("coverage") or {}
    start, end = _date(coverage.get("start")), _date(coverage.get("end"))
    if not researched or not start or not end or end < start:
        errors.append("researched_on と coverage.start / coverage.end を YYYY-MM-DD で（start <= end）")
        return errors
    seen = set()
    for index, event in enumerate(data.get("events") or []):
        where = f"events[{index}] {event.get('name', '')}"
        if event.get("market") not in codes:
            errors.append(f"{where}: 市場コード {event.get('market')!r} が cohort.json にない")
        first, last = _date(event.get("start")), _date(event.get("end"))
        if not first or not last or last < first:
            errors.append(f"{where}: start / end は YYYY-MM-DD で start <= end")
        elif last < start or first > end:
            errors.append(f"{where}: 調査期間 {start}〜{end} に重ならない")
        if event.get("category") not in CATEGORIES:
            errors.append(f"{where}: category は {sorted(CATEGORIES)} のいずれか")
        for field, limit, required in (("name", NAME_LIMIT, True), ("venue", VENUE_LIMIT, True), ("note", NOTE_LIMIT, False)):
            value = event.get(field)
            if value is None and not required:
                continue
            if not isinstance(value, str) or not value.strip():
                errors.append(f"{where}: {field} が空")
            elif len(value) > limit:
                errors.append(f"{where}: {field} は{limit}字以内")
            elif FORBIDDEN_IN_TEXT.search(value):
                errors.append(f"{where}: {field} に料金・満室・予約などの語は書かない")
        sources = event.get("sources")
        if not isinstance(sources, list) or not 1 <= len(sources) <= MAX_SOURCES:
            errors.append(f"{where}: sources は1〜{MAX_SOURCES}件")
        else:
            for source in sources:
                if not isinstance(source, dict) or not URL.match(str(source.get("url", ""))) or not str(source.get("title", "")).strip():
                    errors.append(f"{where}: 出典は url（http/https）と title が必要")
        key = (event.get("market"), event.get("name"), event.get("start"))
        if key in seen:
            errors.append(f"{where}: 同じ催しが重複")
        seen.add(key)
    return errors


def merge(directory: Path, researched_on: date, cohort: dict) -> dict:
    """DIR/<code>.json（{"events": [...]}）を1つにまとめ、日付順に並べる。"""
    events = []
    for market in cohort["markets"]:
        path = directory / f"{market['code']}.json"
        if not path.exists():
            raise FileNotFoundError(f"{path} がない（10都市すべて調べてからまとめる）")
        for event in json.loads(path.read_text(encoding="utf-8")).get("events", []):
            item = {key: event.get(key) for key in ("market", "name", "start", "end", "venue", "category", "note")}
            item["market"] = market["code"]
            item["note"] = item["note"] or None
            item["sources"] = [{"url": s["url"], "title": s.get("title") or s["url"]} for s in event.get("sources", [])][:MAX_SOURCES]
            events.append(item)
    events.sort(key=lambda e: (e["start"] or "", e["market"], e["name"] or ""))
    return {
        "schema_version": SCHEMA_VERSION,
        "researched_on": researched_on.isoformat(),
        "coverage": {"start": researched_on.isoformat(), "end": (researched_on + timedelta(days=COVERAGE_DAYS)).isoformat()},
        "method": "Claude（Anthropic）が週1回、10都市の向こう2か月の催しをWebで調べ、出典ページで開催日と会場を確かめたもの。",
        "events": events,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    merge_cmd = sub.add_parser("merge")
    merge_cmd.add_argument("directory", type=Path)
    merge_cmd.add_argument("--researched-on", type=date.fromisoformat, required=True)
    sub.add_parser("check")
    args = parser.parse_args(argv)

    cohort = load_cohort()
    path = DATA_DIR / EVENTS_FILE
    if args.command == "merge":
        data = merge(args.directory, args.researched_on, cohort)
    else:
        data = json.loads(path.read_text(encoding="utf-8"))
    errors = validate(data, cohort)
    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        return 1
    if args.command == "merge":
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    counts = {}
    for event in data["events"]:
        counts[event["market"]] = counts.get(event["market"], 0) + 1
    print(f"{len(data['events'])} events {data['coverage']['start']}..{data['coverage']['end']}: {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
