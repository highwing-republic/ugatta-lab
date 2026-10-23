"""ビジネスホテル版料金トレンドの料金を楽天トラベル空室検索APIから取得する。

既存の「宿泊料金トレンド」（温泉地・大人2名）とは独立した仕組み。
data/business-hotel-price-trends/cohort.json の比較施設群（CORE・BACKUPとも）について、
大人1名・1室・1泊の「最安プラン（食事条件は問わない）」と、そのプランの食事区分を
今日から horizon_days 泊分、毎日1回記録する。

取得の流れ（市場×宿泊日ごと）:
  1. 市場の全施設をまとめて検索（プラン単位・料金の安い順・30件）。
     安い順に並ぶので、ここに出た施設は最初に出たプランがその施設の最安値になる。
  2. 1回目に出なかった施設だけ、施設ごとに検索し直す。
     それでも出ない施設は「販売プランなし」（満室とは判定しない）。

出力（公開しない保管場所。リポジトリにはコミットしない）:
  .private/business-hotel-price-trends/raw/YYYY-MM-DD.json  … 施設ごとの日別料金。直近 RAW_KEEP_DAYS 日分だけ残す
GitHub Actions ではこの保管場所をキャッシュで次の実行へ引き継ぐ。公開するファイル（今朝の取得・集計・manifest）は
scripts/build_business_hotel_public.cjs がここから作る。

環境変数 RAKUTEN_APPLICATION_ID と RAKUTEN_ACCESS_KEY が必要。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterable

import requests

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "business-hotel-price-trends"
RAW_DIR = ROOT / ".private" / "business-hotel-price-trends" / "raw"
# 公開ページの「泊まる日ごとの値段の動き」は60日前までの取得を使う。それより古い日別料金は保管しない
RAW_KEEP_DAYS = 60
ENDPOINT = "https://openapi.rakuten.co.jp/engine/api/Travel/VacantHotelSearch/20170426"
JST = timezone(timedelta(hours=9))
# 楽天のアプリに登録した「許可されたWebサイト」。新しい楽天APIは Referer が無いと 403 を返す。
DEFAULT_REFERER = "https://ugatta-llc.com/"
MAX_HOTELS_PER_REQUEST = 15
SCHEMA_VERSION = 1

# 1文字の状態コード。料金がある日は食事区分、ない日は理由を表す。
MEAL_ROOM_ONLY = "R"
MEAL_BREAKFAST = "B"
MEAL_DINNER = "D"
MEAL_TWO_MEALS = "T"
NO_PLAN = "-"  # 検索結果に販売プランが出なかった（満室とは限らない）
ERROR = "?"  # API エラーで確認できなかった


class ApiError(Exception):
    """Rakuten API が使える結果を返さなかった。"""


class AuthError(ApiError):
    """アプリIDやアクセスキーが受け付けられない。続けても全件失敗するので中断する。"""


# --------------------------------------------------------------------------- 設定


def load_cohort(path: Path = DATA_DIR / "cohort.json") -> dict:
    cohort = json.loads(path.read_text(encoding="utf-8"))
    validate_cohort(cohort)
    return cohort


def validate_cohort(cohort: dict) -> None:
    seen: set[int] = set()
    for market in cohort["markets"]:
        hotels = [prop["hotel_no"] for prop in market["properties"]]
        if len(hotels) > MAX_HOTELS_PER_REQUEST:
            raise ValueError(f"{market['code']}: 1回の検索で指定できるのは{MAX_HOTELS_PER_REQUEST}施設まで")
        for prop in market["properties"]:
            if prop["role"] not in {"core", "backup"}:
                raise ValueError(f"{prop['hotel_no']}: role は core か backup")
            if prop["hotel_no"] in seen:
                raise ValueError(f"{prop['hotel_no']}: 施設番号が重複しています")
            seen.add(prop["hotel_no"])


def stay_dates(start: date, horizon_days: int) -> list[date]:
    return [start + timedelta(days=offset) for offset in range(horizon_days)]


# --------------------------------------------------------------------------- 応答の解釈


def meal_code(room_basic_info: dict) -> str:
    breakfast = int(room_basic_info.get("withBreakfastFlag") or 0) == 1
    dinner = int(room_basic_info.get("withDinnerFlag") or 0) == 1
    if breakfast and dinner:
        return MEAL_TWO_MEALS
    if breakfast:
        return MEAL_BREAKFAST
    if dinner:
        return MEAL_DINNER
    return MEAL_ROOM_ONLY


def _hotel_parts(entry) -> list:
    """formatVersion 1（{"hotel": [...]}）と 2（[...]）のどちらにも対応する。"""
    if isinstance(entry, dict) and "hotel" in entry:
        return entry["hotel"]
    if isinstance(entry, list):
        return entry
    return []


def parse_plans(payload: dict) -> dict[int, list[tuple[int, str]]]:
    """空室検索の応答から {施設番号: [(1泊目の料金, 食事区分), ...]} を作る。"""
    plans: dict[int, list[tuple[int, str]]] = {}
    for entry in payload.get("hotels") or []:
        hotel_no = None
        rooms: list = []
        # プランは roomInfo ごとに並ぶことも、施設の配列に直接並ぶこともあるので、出てきた順にすべて拾う。
        for part in _hotel_parts(entry):
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
        current_meal = None
        for item in rooms:
            if not isinstance(item, dict):
                continue
            if "roomBasicInfo" in item:
                current_meal = meal_code(item["roomBasicInfo"])
            if "dailyCharge" in item and current_meal is not None:
                total = item["dailyCharge"].get("total")
                if isinstance(total, (int, float)) and total > 0:
                    plans.setdefault(int(hotel_no), []).append((int(total), current_meal))
                current_meal = None
    return plans


def cheapest(plans: Iterable[tuple[int, str]]) -> tuple[int, str] | None:
    """最安プラン。同額なら食事なし→朝食→夕食→2食の順に、簡素なプランを代表にする。"""
    order = {MEAL_ROOM_ONLY: 0, MEAL_BREAKFAST: 1, MEAL_DINNER: 2, MEAL_TWO_MEALS: 3}
    plans = list(plans)
    if not plans:
        return None
    return min(plans, key=lambda plan: (plan[0], order[plan[1]]))


# --------------------------------------------------------------------------- API


@dataclass
class RakutenClient:
    application_id: str
    access_key: str
    referer: str = DEFAULT_REFERER
    min_interval: float = 1.1
    max_retries: int = 4
    session: requests.Session = field(default_factory=requests.Session)
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic
    request_count: int = 0
    _last: float = -1e9

    def search(self, params: dict, endpoint: str = ENDPOINT) -> dict:
        """1回の検索。該当なし（404）は空の結果として返す。"""
        query = {"applicationId": self.application_id, "format": "json", **params}
        headers = {"accessKey": self.access_key, "Referer": self.referer, "Origin": self.referer.rstrip("/"), "User-Agent": "HOTEL-DX-Lab business-hotel-price-trends"}
        for attempt in range(self.max_retries + 1):
            wait = self.min_interval - (self.clock() - self._last)
            if wait > 0:
                self.sleep(wait)
            self._last = self.clock()
            self.request_count += 1
            try:
                response = self.session.get(endpoint, params=query, headers=headers, timeout=30)
            except requests.RequestException as exc:
                error = f"network error: {type(exc).__name__}"
            else:
                if response.status_code == 200:
                    return response.json()
                if response.status_code == 404:
                    return {"hotels": []}
                if response.status_code in (400, 401, 403):
                    text = _error_text(response)
                    if response.status_code in (401, 403) or "applicationId" in text or "accessKey" in text:
                        raise AuthError(f"HTTP {response.status_code}: {text}")
                    raise ApiError(f"HTTP {response.status_code}: {text}")
                error = f"HTTP {response.status_code}"
            if attempt < self.max_retries:
                self.sleep(min(60.0, 5.0 * 2 ** attempt))
        raise ApiError(error)


def _error_text(response) -> str:
    try:
        body = response.json()
    except ValueError:
        return (response.text or "応答本文なし")[:300]
    if isinstance(body, dict) and ("error" in body or "error_description" in body):
        return f"{body.get('error')}: {body.get('error_description')}"
    return json.dumps(body, ensure_ascii=False)[:300]


def base_params(stay: date, conditions: dict) -> dict:
    return {
        "checkinDate": stay.isoformat(),
        "checkoutDate": (stay + timedelta(days=conditions["nights"])).isoformat(),
        "adultNum": conditions["adults"],
        "roomNum": conditions["rooms"],
        "searchPattern": 1,
        "sort": "+roomCharge",
    }


def observe_market_day(client: RakutenClient, hotel_nos: list[int], stay: date, conditions: dict) -> dict[int, tuple[int | None, str]]:
    """1市場・1宿泊日分。{施設番号: (料金 or None, 状態コード)}"""
    result: dict[int, tuple[int | None, str]] = {}
    params = base_params(stay, conditions)
    try:
        plans = parse_plans(client.search({**params, "hotelNo": ",".join(map(str, hotel_nos)), "hits": 30}))
    except AuthError:
        raise
    except ApiError:
        plans = {}
    for hotel_no in hotel_nos:
        best = cheapest(plans.get(hotel_no, []))
        if best:
            result[hotel_no] = best
    for hotel_no in hotel_nos:
        if hotel_no in result:
            continue
        try:
            best = cheapest(parse_plans(client.search({**params, "hotelNo": str(hotel_no), "hits": 5})).get(hotel_no, []))
        except AuthError:
            raise
        except ApiError:
            result[hotel_no] = (None, ERROR)
            continue
        result[hotel_no] = best if best else (None, NO_PLAN)
    return result


# --------------------------------------------------------------------------- 保存


def build_snapshot(cohort: dict, snapshot_date: date, dates: list[date], observations: dict[str, dict[date, dict[int, tuple[int | None, str]]]], generated_at: datetime) -> dict:
    markets = []
    for market in cohort["markets"]:
        by_date = observations.get(market["code"], {})
        hotels = []
        for prop in market["properties"]:
            prices, codes = [], []
            for stay in dates:
                price, code = by_date.get(stay, {}).get(prop["hotel_no"], (None, ERROR))
                prices.append(price)
                codes.append(code)
            hotels.append({"hotel_no": prop["hotel_no"], "price": prices, "meal": "".join(codes)})
        markets.append({"code": market["code"], "hotels": hotels})
    return {
        "schema_version": SCHEMA_VERSION,
        "snapshot_date": snapshot_date.isoformat(),
        "generated_at": generated_at.isoformat(timespec="seconds"),
        "cohort_version": cohort["cohort_version"],
        "conditions": cohort["conditions"],
        "codes": {MEAL_ROOM_ONLY: "素泊まり", MEAL_BREAKFAST: "朝食付き", MEAL_DINNER: "夕食付き", MEAL_TWO_MEALS: "朝夕食付き", NO_PLAN: "販売プランなし", ERROR: "取得エラー"},
        "stay_dates": [stay.isoformat() for stay in dates],
        "markets": markets,
    }


def error_ratio(snapshot: dict) -> float:
    codes = "".join(hotel["meal"] for market in snapshot["markets"] for hotel in market["hotels"])
    return codes.count(ERROR) / len(codes) if codes else 1.0


def write_snapshot(snapshot: dict, raw_dir: Path = RAW_DIR, keep_days: int = RAW_KEEP_DAYS) -> Path:
    """日別料金を非公開の保管場所に書き、keep_days 日より前の取得を消す。"""
    raw_dir.mkdir(parents=True, exist_ok=True)
    path = raw_dir / f"{snapshot['snapshot_date']}.json"
    path.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    prune_raw(raw_dir, date.fromisoformat(snapshot["snapshot_date"]), keep_days)
    return path


def prune_raw(raw_dir: Path, latest: date, keep_days: int = RAW_KEEP_DAYS) -> list[Path]:
    oldest = latest - timedelta(days=keep_days)
    removed = []
    for path in sorted(raw_dir.glob("????-??-??.json")):
        if date.fromisoformat(path.stem) < oldest:
            path.unlink()
            removed.append(path)
    return removed


# --------------------------------------------------------------------------- 実行


def run(client: RakutenClient, cohort: dict, snapshot_date: date, horizon: int, market_codes: set[str] | None = None, log=print) -> dict:
    dates = stay_dates(snapshot_date, horizon)
    observations: dict[str, dict[date, dict]] = {}
    for market in cohort["markets"]:
        if market_codes and market["code"] not in market_codes:
            continue
        hotel_nos = [prop["hotel_no"] for prop in market["properties"]]
        before = client.request_count
        observations[market["code"]] = {stay: observe_market_day(client, hotel_nos, stay, cohort["conditions"]) for stay in dates}
        log(f"{market['name']}: {len(dates)}泊分 / {client.request_count - before}リクエスト")
    snapshot = build_snapshot(cohort, snapshot_date, dates, observations, datetime.now(JST))
    if market_codes:
        snapshot["markets"] = [m for m in snapshot["markets"] if m["code"] in market_codes]
    return snapshot


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--date", help="取得日（YYYY-MM-DD、既定は日本時間の今日）")
    parser.add_argument("--horizon", type=int, help="何泊先まで取得するか（既定は cohort.json の horizon_days）")
    parser.add_argument("--market", action="append", help="一部の市場だけ取得（試験用。保存はしない）")
    parser.add_argument("--dry-run", action="store_true", help="保存せず結果の概要だけ表示する")
    parser.add_argument("--probe", type=int, metavar="HOTEL_NO", help="1施設・翌日分の検索結果をそのまま表示する（応答の形の確認用）")
    parser.add_argument("--max-error-ratio", type=float, default=0.2, help="取得エラーの割合がこれを超えたら保存しない")
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR, help="日別料金の保管場所（公開しない）")
    args = parser.parse_args(argv)

    application_id = os.environ.get("RAKUTEN_APPLICATION_ID", "").strip()
    access_key = os.environ.get("RAKUTEN_ACCESS_KEY", "").strip()
    if not application_id or not access_key:
        print("RAKUTEN_APPLICATION_ID と RAKUTEN_ACCESS_KEY を環境変数に設定してください。", file=sys.stderr)
        return 2

    cohort = load_cohort()
    snapshot_date = date.fromisoformat(args.date) if args.date else datetime.now(JST).date()
    horizon = args.horizon or cohort["horizon_days"]
    market_codes = set(args.market) if args.market else None
    client = RakutenClient(application_id, access_key, referer=os.environ.get("RAKUTEN_REFERER", "").strip() or DEFAULT_REFERER)
    if args.probe:
        params = {**base_params(snapshot_date + timedelta(days=1), cohort["conditions"]), "hotelNo": str(args.probe), "hits": 5}
        payload = client.search(params)
        print(json.dumps(payload, ensure_ascii=False, indent=2)[:6000])
        print("解釈結果:", parse_plans(payload))
        return 0
    try:
        snapshot = run(client, cohort, snapshot_date, horizon, market_codes)
    except AuthError as exc:
        print(f"楽天APIの認証に失敗したため中断しました（{exc}）。アプリIDとアクセスキーを確認してください。", file=sys.stderr)
        return 2

    ratio = error_ratio(snapshot)
    codes = "".join(h["meal"] for m in snapshot["markets"] for h in m["hotels"])
    summary = {code: codes.count(code) for code in snapshot["codes"]}
    print(f"取得日 {snapshot['snapshot_date']} / {client.request_count}リクエスト / 状態 {summary} / エラー率 {ratio:.1%}")
    if args.dry_run or market_codes:
        return 0
    if ratio > args.max_error_ratio:
        print(f"エラー率 {ratio:.1%} が上限 {args.max_error_ratio:.0%} を超えたため保存しません。", file=sys.stderr)
        return 1
    path = write_snapshot(snapshot, args.raw_dir)
    print(f"保存（非公開）: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
