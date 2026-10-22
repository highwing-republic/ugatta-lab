"""料金ポジション診断（試作）: 1施設と周辺施設の空室プランを楽天トラベルAPIから1回取得する。

公開しない試作。サイトの公開データとは別物で、data/ には何も書かない。
結果は workflow 側で暗号化してから作業用ブランチに保存する。ログには料金も施設名も出さない。

取得するもの:
  1. 対象施設の施設情報（施設検索API、responseType=large）
  2. 対象施設から半径 radius_km 以内の施設一覧（同上、評価・部屋数を含む）
  3. 対象施設と近い順に最大14施設について、今日から horizon_days 泊分の空室プランすべて
     （空室検索API、プラン単位・安い順、全ページ）。大人1名と大人2名の2条件。

環境変数 RAKUTEN_APPLICATION_ID と RAKUTEN_ACCESS_KEY が必要。
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import update_business_hotel_prices as bh

SIMPLE_ENDPOINT = "https://openapi.rakuten.co.jp/engine/api/Travel/SimpleHotelSearch/20260731"
DETAIL_ENDPOINT = "https://openapi.rakuten.co.jp/engine/api/Travel/HotelDetailSearch/20260731"
KEYWORD_ENDPOINT = "https://openapi.rakuten.co.jp/engine/api/Travel/KeywordHotelSearch/20260731"
AREA_ENDPOINT = "https://openapi.rakuten.co.jp/engine/api/Travel/GetAreaClass/20260731"
MAX_PAGES = 12


def merge_parts(entry) -> dict:
    """施設検索の1施設分（formatVersion 1・2のどちらでも）を1つの辞書にまとめる。"""
    merged: dict = {}
    for part in bh._hotel_parts(entry):
        if isinstance(part, dict):
            merged.update(part)
    return merged


def describe(payload: dict) -> str:
    """応答の形だけをログに出す（施設名や料金は出さない）。"""
    hotels = payload.get("hotels") or []
    first = hotels[0] if hotels else None
    kinds = [sorted(p.keys()) for p in bh._hotel_parts(first) if isinstance(p, dict)] if first is not None else []
    return f"keys={sorted(payload.keys())} hotels={len(hotels)} first={type(first).__name__} parts={kinds}"


def find_target(client: bh.RakutenClient, hotel_no: int) -> dict | None:
    for extra in ({}, {"datumType": 1}):
        payload = client.search({"hotelNo": hotel_no, "formatVersion": 2, "responseType": "large", **extra}, endpoint=DETAIL_ENDPOINT)
        for entry in payload.get("hotels") or []:
            hotel = merge_parts(entry)
            if int((hotel.get("hotelBasicInfo") or {}).get("hotelNo") or 0) == hotel_no:
                return hotel
        print("施設情報APIの応答:", extra, describe(payload))
    return None


def discover(client: bh.RakutenClient, request: dict) -> None:
    """対象施設や地区コードを探すための下調べ。施設番号と施設名だけをログに出す（料金は出さない）。"""
    for keyword in request.get("discover_keywords", []):
        try:
            payload = client.search({"keyword": keyword, "middleClassCode": request.get("middle_class_code", "kagoshima"), "formatVersion": 2, "responseType": "small", "hits": 30}, endpoint=KEYWORD_ENDPOINT)
        except bh.ApiError as exc:
            print(f"キーワード {keyword}: エラー {exc}")
            continue
        hotels = [merge_parts(e).get("hotelBasicInfo") or {} for e in payload.get("hotels") or []]
        print(f"キーワード {keyword}: {len(hotels)} 件")
        for b in hotels:
            print("  ", b.get("hotelNo"), b.get("hotelName"), b.get("address2"))
    try:
        payload = client.search({"formatVersion": 2}, endpoint=AREA_ENDPOINT)
        text = json.dumps(payload, ensure_ascii=False)
        start = text.find("kagoshima")
        print("地区コード（鹿児島付近）:", text[start:start + 1500] if start >= 0 else describe(payload))
    except bh.ApiError as exc:
        print("地区コード: エラー", exc)


def search_hotels(client: bh.RakutenClient, params: dict) -> list[dict]:
    hotels: list[dict] = []
    page = 1
    while True:
        payload = client.search({**params, "formatVersion": 2, "responseType": "large", "datumType": 1, "hits": 30, "page": page}, endpoint=SIMPLE_ENDPOINT)
        if page == 1 and not payload.get("hotels"):
            print("施設検索APIの応答:", describe(payload))
        hotels.extend(merge_parts(entry) for entry in payload.get("hotels") or [])
        page_count = int((payload.get("pagingInfo") or {}).get("pageCount") or 1)
        if page >= page_count or page >= 5:
            return hotels
        page += 1


def distance_km(a: dict, b: dict) -> float:
    lat1, lon1 = math.radians(float(a["latitude"])), math.radians(float(a["longitude"]))
    lat2, lon2 = math.radians(float(b["latitude"])), math.radians(float(b["longitude"]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def parse_plan_rows(payload: dict) -> list[list]:
    """空室検索の応答から [施設番号, 1泊目の料金, 食事区分, 部屋区分, 部屋名, プラン名, プランID] の行を作る。"""
    rows: list[list] = []
    for entry in payload.get("hotels") or []:
        hotel_no = None
        rooms: list = []
        for part in bh._hotel_parts(entry):
            if not isinstance(part, dict):
                continue
            if "hotelBasicInfo" in part:
                hotel_no = part["hotelBasicInfo"].get("hotelNo")
            if "roomInfo" in part:
                rooms.extend(part["roomInfo"] or [])
            if "roomBasicInfo" in part or "dailyCharge" in part:
                rooms.append(part)
        if hotel_no is None:
            continue
        basic = None
        for item in rooms:
            if not isinstance(item, dict):
                continue
            if "roomBasicInfo" in item:
                basic = item["roomBasicInfo"]
            if "dailyCharge" in item and basic is not None:
                total = item["dailyCharge"].get("total")
                if isinstance(total, (int, float)) and total > 0:
                    rows.append([int(hotel_no), int(total), bh.meal_code(basic), basic.get("roomClass"), basic.get("roomName"), basic.get("planName"), basic.get("planId")])
                basic = None
    return rows


def observe_day(client: bh.RakutenClient, hotel_nos: list[int], stay: date, adults: int) -> dict:
    params = bh.base_params(stay, {"nights": 1, "adults": adults, "rooms": 1})
    params["hotelNo"] = ",".join(map(str, hotel_nos))
    rows: list[list] = []
    page = 1
    try:
        while True:
            payload = client.search({**params, "hits": 30, "page": page})
            rows.extend(parse_plan_rows(payload))
            page_count = int((payload.get("pagingInfo") or {}).get("pageCount") or 1)
            if page >= page_count or page >= MAX_PAGES:
                break
            page += 1
    except bh.AuthError:
        raise
    except bh.ApiError as exc:
        return {"stay_date": stay.isoformat(), "adults": adults, "status": "error", "error": str(exc)[:200], "pages": page, "plans": rows}
    return {"stay_date": stay.isoformat(), "adults": adults, "status": "ok", "pages": page, "truncated": page >= MAX_PAGES, "plans": rows}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--request", required=True, help="取得条件の JSON（target_hotel_no, radius_km, horizon_days, max_competitors）")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    request = json.loads(Path(args.request).read_text(encoding="utf-8"))
    target_no = int(request["target_hotel_no"])
    radius = float(request.get("radius_km", 3.0))
    horizon = int(request.get("horizon_days", 90))
    max_competitors = min(int(request.get("max_competitors", 14)), bh.MAX_HOTELS_PER_REQUEST - 1)
    adults_list = [int(a) for a in request.get("adults", [1, 2])]

    client = bh.RakutenClient(os.environ["RAKUTEN_APPLICATION_ID"], os.environ["RAKUTEN_ACCESS_KEY"], referer=os.getenv("RAKUTEN_REFERER", bh.DEFAULT_REFERER))
    started = datetime.now(bh.JST)
    today = started.date()

    if request.get("discover_keywords"):
        discover(client, request)
    target = find_target(client, target_no)
    if target is None:
        print("対象施設が見つかりませんでした")
        return 1
    tb = target["hotelBasicInfo"]
    nearby = search_hotels(client, {"latitude": tb["latitude"], "longitude": tb["longitude"], "searchRadius": radius})
    for hotel in nearby:
        hotel["distance_km"] = round(distance_km(tb, hotel["hotelBasicInfo"]), 2)
    nearby = [h for h in nearby if int(h["hotelBasicInfo"]["hotelNo"]) != target_no]
    nearby.sort(key=lambda h: h["distance_km"])
    competitors = [int(h["hotelBasicInfo"]["hotelNo"]) for h in nearby[:max_competitors]]
    print(f"周辺施設 {len(nearby)} 件、料金を取る施設 {len(competitors) + 1} 件")

    hotel_nos = [target_no, *competitors]
    observations = []
    for adults in adults_list:
        for stay in bh.stay_dates(today, horizon):
            observations.append(observe_day(client, hotel_nos, stay, adults))
        errors = sum(1 for o in observations if o["adults"] == adults and o["status"] != "ok")
        print(f"大人{adults}名: {horizon}泊分を取得（エラー {errors} 泊）")

    result = {
        "schema": "price-position-trial/1",
        "fetched_at": started.isoformat(timespec="seconds"),
        "finished_at": datetime.now(bh.JST).isoformat(timespec="seconds"),
        "request": request,
        "target": target,
        "nearby": nearby,
        "priced_hotels": hotel_nos,
        "plan_columns": ["hotel_no", "total_yen", "meal", "room_class", "room_name", "plan_name", "plan_id"],
        "meal_codes": {bh.MEAL_ROOM_ONLY: "素泊まり", bh.MEAL_BREAKFAST: "朝食付き", bh.MEAL_DINNER: "夕食付き", bh.MEAL_TWO_MEALS: "朝夕食付き"},
        "observations": observations,
        "request_count": client.request_count,
    }
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"API 呼び出し {client.request_count} 回")
    return 0


if __name__ == "__main__":
    sys.exit(main())
