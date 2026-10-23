"""ビジネスホテル版料金トレンドの比較施設群と料金取得スクリプト。

APIには接続せず、楽天トラベル空室検索APIの応答の形をした偽の応答で確かめる。
"""
import json
from datetime import date, datetime

import pytest

from scripts import update_business_hotel_prices as bh

COHORT = bh.load_cohort()


def plan(breakfast=0, dinner=0):
    return {"roomBasicInfo": {"planName": "plan", "withBreakfastFlag": breakfast, "withDinnerFlag": dinner}}


def charge(total):
    return {"dailyCharge": {"stayDate": "2026-10-20", "total": total, "rakutenCharge": total, "chargeFlag": 0}}


def hotel(hotel_no, *rooms, version=1):
    parts = [{"hotelBasicInfo": {"hotelNo": hotel_no}}, {"roomInfo": list(rooms)}]
    return {"hotel": parts} if version == 1 else parts


class FakeResponse:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body

    def json(self):
        return self._body


class FakeSession:
    """hotelNo の指定に応じて応答を返す。呼ばれた検索条件を記録する。"""

    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def get(self, url, params, headers, timeout):
        self.calls.append((params, headers))
        status, body = self.routes(params)
        return FakeResponse(status, body)


def client(routes):
    session = FakeSession(routes)
    return bh.RakutenClient("app", "key", min_interval=0, session=session, sleep=lambda _: None), session


# ---------------------------------------------------------------- 比較施設群


def test_cohort_has_ten_markets_with_five_core_hotels_each():
    assert COHORT["cohort_version"] == "bh-v2"
    assert COHORT["conditions"] == {"adults": 1, "rooms": 1, "nights": 1, "price_basis": "lowest_plan_any_meal"}
    assert [m["name"] for m in COHORT["markets"]] == ["札幌", "仙台", "名古屋", "広島", "福岡", "金沢", "那覇", "鹿児島", "熊本", "岡山"]
    for market in COHORT["markets"]:
        roles = [p["role"] for p in market["properties"]]
        assert roles.count("core") == 5, market["code"]
        assert roles.count("backup") >= 3, market["code"]
        assert len(roles) <= bh.MAX_HOTELS_PER_REQUEST


def test_cross_city_brand_is_in_core_of_nine_markets():
    # 都市横断の比較に使うブランドは、札幌以外の9市場のCOREにある（札幌の同ブランドは改装工事中のため外している）
    brand = COHORT["cross_city_brand"]
    with_brand = []
    for market in COHORT["markets"]:
        core_brands = [p["brand"] for p in market["properties"] if p["role"] == "core"]
        assert all(core_brands.count(b) <= 2 for b in core_brands), market["code"]
        if brand in core_brands:
            with_brand.append(market["code"])
    assert len(with_brand) == 9 and "sapporo" not in with_brand


def test_cohort_v2_moved_toyoko_inn_to_backup_everywhere():
    for market in COHORT["markets"]:
        toyoko = [p for p in market["properties"] if p["brand"] == "東横イン"]
        assert toyoko and all(p["role"] == "backup" for p in toyoko), market["code"]
    assert COHORT["history"][0]["cohort_version"] == "bh-v1"


def test_cohort_rejects_duplicate_hotels_and_unknown_roles():
    broken = json.loads(json.dumps(COHORT))
    broken["markets"][1]["properties"][0]["hotel_no"] = broken["markets"][0]["properties"][0]["hotel_no"]
    with pytest.raises(ValueError):
        bh.validate_cohort(broken)
    broken = json.loads(json.dumps(COHORT))
    broken["markets"][0]["properties"][0]["role"] = "spare"
    with pytest.raises(ValueError):
        bh.validate_cohort(broken)


# ---------------------------------------------------------------- 応答の解釈


def test_meal_flags_map_to_one_letter_codes():
    assert bh.meal_code(plan()["roomBasicInfo"]) == "R"
    assert bh.meal_code(plan(breakfast=1)["roomBasicInfo"]) == "B"
    assert bh.meal_code(plan(dinner=1)["roomBasicInfo"]) == "D"
    assert bh.meal_code(plan(breakfast=1, dinner=1)["roomBasicInfo"]) == "T"


@pytest.mark.parametrize("version", [1, 2])
def test_parse_plans_reads_both_response_formats(version):
    payload = {"hotels": [
        hotel(111, plan(breakfast=1), charge(8800), plan(), charge(7600), version=version),
        hotel(222, plan(), charge(0), plan(breakfast=1, dinner=1), charge(15000), version=version),
    ]}
    assert bh.parse_plans(payload) == {111: [(8800, "B"), (7600, "R")], 222: [(15000, "T")]}


def test_parse_plans_reads_one_room_info_block_per_plan_and_flat_parts():
    payload = {"hotels": [
        {"hotel": [{"hotelBasicInfo": {"hotelNo": 111}}, {"roomInfo": [plan(), charge(7200)]}, {"roomInfo": [plan(breakfast=1), charge(8100)]}]},
        {"hotel": [{"hotelBasicInfo": {"hotelNo": 222}}, plan(breakfast=1), charge(9900)]},
    ]}
    assert bh.parse_plans(payload) == {111: [(7200, "R"), (8100, "B")], 222: [(9900, "B")]}


def test_cheapest_prefers_the_simpler_plan_on_a_tie():
    assert bh.cheapest([(9000, "B"), (9000, "R"), (9500, "R")]) == (9000, "R")
    assert bh.cheapest([]) is None


# ---------------------------------------------------------------- 取得


def test_observe_market_day_falls_back_per_hotel_and_marks_no_plan_and_errors():
    def routes(params):
        hotels = params["hotelNo"]
        if "," in hotels:  # まとめて検索: 111 と 222 だけが安い順の30件に入った
            return 200, {"hotels": [hotel(111, plan(), charge(7000)), hotel(222, plan(breakfast=1), charge(9000))]}
        if hotels == "333":
            return 200, {"hotels": [hotel(333, plan(breakfast=1, dinner=1), charge(18000), plan(), charge(12000))]}
        if hotels == "444":
            return 404, {"error": "not_found"}
        return 500, {"error": "system_error"}

    c, session = client(routes)
    result = bh.observe_market_day(c, [111, 222, 333, 444, 555], date(2026, 10, 20), COHORT["conditions"])
    assert result == {111: (7000, "R"), 222: (9000, "B"), 333: (12000, "R"), 444: (None, "-"), 555: (None, "?")}
    first = session.calls[0][0]
    assert first["adultNum"] == 1 and first["roomNum"] == 1 and first["searchPattern"] == 1
    assert first["sort"] == "+roomCharge" and first["checkinDate"] == "2026-10-20" and first["checkoutDate"] == "2026-10-21"
    assert session.calls[0][1]["accessKey"] == "key" and "accessKey" not in first
    assert session.calls[0][1]["Referer"] == "https://ugatta-llc.com/"


def test_rate_limit_is_retried_with_backoff():
    responses = iter([(429, {"error": "too_many_requests"}), (200, {"hotels": [hotel(111, plan(), charge(6500))]})])
    slept = []
    session = FakeSession(lambda params: next(responses))
    c = bh.RakutenClient("app", "key", min_interval=0, session=session, sleep=slept.append)
    assert bh.parse_plans(c.search({"hotelNo": "111"})) == {111: [(6500, "R")]}
    assert slept == [5.0]


def test_bad_credentials_stop_the_run_instead_of_recording_errors():
    c, _ = client(lambda params: (400, {"error": "wrong_parameter", "error_description": "specify valid applicationId"}))
    with pytest.raises(bh.AuthError):
        bh.observe_market_day(c, [111, 222], date(2026, 10, 20), COHORT["conditions"])


# ---------------------------------------------------------------- 保存


def test_snapshot_is_compact_and_kept_only_in_the_private_store(tmp_path):
    cohort = {**COHORT, "markets": [COHORT["markets"][0]]}
    sapporo = cohort["markets"][0]
    first, second = sapporo["properties"][0]["hotel_no"], sapporo["properties"][1]["hotel_no"]
    dates = bh.stay_dates(date(2026, 10, 16), 2)
    observations = {"sapporo": {dates[0]: {first: (8200, "R"), second: (None, "-")}, dates[1]: {first: (9100, "B")}}}
    snapshot = bh.build_snapshot(cohort, date(2026, 10, 16), dates, observations, datetime(2026, 10, 16, 6, 30, tzinfo=bh.JST))

    assert snapshot["stay_dates"] == ["2026-10-16", "2026-10-17"]
    [market] = snapshot["markets"]
    assert market["hotels"][0] == {"hotel_no": first, "price": [8200, 9100], "meal": "RB"}
    assert market["hotels"][1] == {"hotel_no": second, "price": [None, None], "meal": "-?"}
    assert snapshot["generated_at"] == "2026-10-16T06:30:00+09:00"

    raw = tmp_path / "raw"
    for old in ("2026-08-16", "2026-08-17"):
        bh.write_snapshot({**snapshot, "snapshot_date": old}, raw)
    path = bh.write_snapshot(snapshot, raw)
    assert path == raw / "2026-10-16.json"
    assert json.loads(path.read_text(encoding="utf-8")) == snapshot
    # 60日より前の日別料金は消す（10/16 から60日前 = 8/17 は残す）
    assert sorted(p.name for p in raw.iterdir()) == ["2026-08-17.json", "2026-10-16.json"]


def test_daily_prices_are_not_written_into_the_public_site():
    assert bh.RAW_DIR.relative_to(bh.ROOT).parts[0] == ".private"
    gitignore = (bh.ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert ".private/" in gitignore
    assert ".private" not in str(bh.DATA_DIR)


def test_error_ratio_counts_only_failed_lookups():
    snapshot = {"markets": [{"hotels": [{"meal": "RB-?"}, {"meal": "????"}]}]}
    assert bh.error_ratio(snapshot) == 5 / 8


def test_main_refuses_to_run_without_credentials(monkeypatch, capsys):
    monkeypatch.delenv("RAKUTEN_APPLICATION_ID", raising=False)
    monkeypatch.delenv("RAKUTEN_ACCESS_KEY", raising=False)
    assert bh.main(["--dry-run"]) == 2
    assert "RAKUTEN_APPLICATION_ID" in capsys.readouterr().err


# ---------------------------------------------------------------- ページ


def test_page_names_the_observation_conditions_and_credits_rakuten():
    from bs4 import BeautifulSoup
    from site_pages import rendered

    page = BeautifulSoup(rendered("business-hotel-price-trends.html"), "html.parser")
    assert page.h1.get_text(strip=True) == "ビジネスホテル料金トレンド"
    scope = page.select_one(".bht-scope").get_text()
    assert "全国10都市・比較50施設" in scope and "大人1名・1室・1泊" in scope
    attribution = page.find("a", href="https://developers.rakuten.com/", string="Supported by Rakuten Developers")
    assert attribution is not None
    noscript = page.find("noscript").get_text()
    for market in COHORT["markets"]:
        assert market["name"] in noscript
    # 観測施設数の表記は比較施設群（CORE）の数と一致させる
    core = sum(p["role"] == "core" for m in COHORT["markets"] for p in m["properties"])
    assert core == 50
