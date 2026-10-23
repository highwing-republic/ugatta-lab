"""ビジネスホテル版料金トレンドの施設写真（URL のみ）の取得。

APIには接続せず、楽天トラベル施設情報APIの応答の形をした偽の応答で確かめる。
"""
import json
from datetime import date, datetime
from pathlib import Path

from scripts import update_business_hotel_images as bhi
from scripts import update_business_hotel_prices as bh

ROOT = Path(__file__).resolve().parents[1]
COHORT = {
    "markets": [
        {"code": "a", "properties": [{"hotel_no": 101, "name": "A1"}, {"hotel_no": 102, "name": "A2"}]},
        {"code": "b", "properties": [{"hotel_no": 201, "name": "B1"}]},
    ]
}


def detail(hotel_no, image="http://img.travel.rakuten.co.jp/share/HOTEL/{n}/{n}.jpg", thumb="https://img.travel.rakuten.co.jp/HIMG/90_000/{n}/{n}.jpg"):
    basic = {"hotelNo": hotel_no, "hotelName": f"H{hotel_no}"}
    if image:
        basic["hotelImageUrl"] = image.format(n=hotel_no)
    if thumb:
        basic["hotelThumbnailUrl"] = thumb.format(n=hotel_no)
    return {"hotels": [[{"hotelBasicInfo": basic}, {"hotelRatingInfo": {}}]]}


class FakeResponse:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = json.dumps(body)

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def get(self, url, params, headers, timeout):
        self.calls.append((url, params))
        return FakeResponse(*self.routes(int(params["hotelNo"])))


def client(routes):
    session = FakeSession(routes)
    return bh.RakutenClient("app", "key", min_interval=0, max_retries=0, session=session, sleep=lambda _: None), session


def test_only_rakuten_image_hosts_are_kept_and_upgraded_to_https():
    assert bhi.image_url("http://img.travel.rakuten.co.jp/a.jpg") == "https://img.travel.rakuten.co.jp/a.jpg"
    assert bhi.image_url("https://trvimg.r10s.jp/b.jpg") == "https://trvimg.r10s.jp/b.jpg"
    for bad in ("https://example.com/a.jpg", "javascript:alert(1)", "ftp://img.travel.rakuten.co.jp/a.jpg", "", None):
        assert bhi.image_url(bad) is None


def test_parse_image_reads_both_formats_and_returns_none_without_photo():
    assert bhi.parse_image(detail(101), 101) == {
        "url": "https://img.travel.rakuten.co.jp/share/HOTEL/101/101.jpg",
        "thumbnail_url": "https://img.travel.rakuten.co.jp/HIMG/90_000/101/101.jpg",
    }
    v1 = {"hotels": [{"hotel": detail(101)["hotels"][0]}]}
    assert bhi.parse_image(v1, 101)["url"].endswith("/101.jpg")
    assert bhi.parse_image(detail(101, image=None, thumb=None), 101) is None
    assert bhi.parse_image(detail(101, image="https://example.com/x.jpg", thumb=None), 101) is None
    assert bhi.parse_image(detail(999), 101) is None


def test_first_run_checks_every_hotel_using_the_detail_endpoint():
    api, session = client(lambda n: (200, detail(n)) if n != 102 else (200, detail(n, image=None, thumb=None)))
    hotels, counts = bhi.update_images(api, COHORT, {}, date(2026, 10, 17), log=lambda _: None)
    assert list(hotels) == ["101", "102", "201"]
    assert hotels["102"] == {"image": None, "checked_on": "2026-10-17"}
    assert hotels["201"]["image"]["thumbnail_url"].startswith("https://img.travel.rakuten.co.jp/")
    assert counts == {"checked": 3, "with_photo": 2, "no_photo": 1, "errors": 0, "kept": 0}
    assert {url for url, _ in session.calls} == {bhi.ENDPOINT}


def test_hotels_are_checked_again_only_once_a_month():
    previous = {
        "101": {"image": {"url": "https://img.travel.rakuten.co.jp/old.jpg", "thumbnail_url": None}, "checked_on": "2026-10-01"},
        "102": {"image": None, "checked_on": "2026-09-30"},
        "999": {"image": None, "checked_on": "2026-10-01"},  # 比較施設群から外れた施設
    }
    api, session = client(lambda n: (200, detail(n)))
    hotels, counts = bhi.update_images(api, COHORT, previous, date(2026, 10, 17), log=lambda _: None)
    assert sorted(int(params["hotelNo"]) for _, params in session.calls) == [102, 201]
    assert hotels["101"] == previous["101"]
    assert hotels["102"]["image"] is not None and "999" not in hotels
    assert counts["kept"] == 1 and counts["checked"] == 2


def test_a_failed_lookup_keeps_the_previous_photo_and_is_retried_next_day():
    previous = {"101": {"image": {"url": "https://img.travel.rakuten.co.jp/old.jpg", "thumbnail_url": None}, "checked_on": "2026-09-01"}}
    api, _ = client(lambda n: (500, {}) if n == 101 else (200, detail(n)))
    hotels, counts = bhi.update_images(api, COHORT, previous, date(2026, 10, 17), log=lambda _: None)
    assert hotels["101"] == previous["101"] and bhi.needs_check(hotels["101"], date(2026, 10, 18))
    assert counts["errors"] == 1
    # 前回の値がない施設は記録しない（翌日にもう一度試す）
    api, _ = client(lambda n: (500, {}) if n == 201 else (200, detail(n)))
    hotels, _ = bhi.update_images(api, COHORT, {}, date(2026, 10, 17), log=lambda _: None)
    assert "201" not in hotels


def test_written_file_holds_urls_only(tmp_path):
    path = tmp_path / "images.json"
    bhi.write_images({"101": {"image": {"url": "https://img.travel.rakuten.co.jp/a.jpg", "thumbnail_url": None}, "checked_on": "2026-10-17"}}, datetime(2026, 10, 17, 6, 30, tzinfo=bh.JST), path)
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["credit"] == "写真：楽天トラベル"
    assert data["hotels"]["101"]["image"]["url"].startswith("https://img.travel.rakuten.co.jp/")
    assert bhi.load_images(path) == data["hotels"]
    assert bhi.load_images(tmp_path / "missing.json") == {}


def test_published_photo_urls_point_only_to_rakuten_image_servers():
    hotels = bhi.load_images()
    for entry in hotels.values():
        for url in (entry["image"] or {}).values():
            assert url is None or bhi.image_url(url) == url


def test_daily_workflow_fetches_photos_without_blocking_prices():
    workflow = (ROOT / ".github/workflows/update-business-hotel-prices.yml").read_text(encoding="utf-8")
    step = workflow.split("- name: Fetch facility photo URLs from Rakuten Travel", 1)[1].split("- name:", 1)[0]
    assert "continue-on-error: true" in step and "update_business_hotel_images.py" in step
    assert workflow.index("update_business_hotel_prices.py") < workflow.index("update_business_hotel_images.py") < workflow.index("git add -A data/business-hotel-price-trends")


def test_page_credits_rakuten_for_photos():
    from bs4 import BeautifulSoup
    from site_pages import rendered

    page = BeautifulSoup(rendered("business-hotel-price-trends.html"), "html.parser")
    assert page.select_one("#bht-photo-credit").get_text(strip=True).startswith("写真：楽天トラベル")
    script = (ROOT / "js/business-hotel-price-trends.js").read_text(encoding="utf-8")
    assert '"img.travel.rakuten.co.jp", "trvimg.r10s.jp"' in script and 'referrerpolicy="no-referrer"' in script
