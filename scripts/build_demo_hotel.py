"""Build the Hotel Suiren demo site (after AIO measures) as one static page per language.

The fictional inn's facts live in CONTENT below, once per language, so the four pages
cannot drift apart. Run from the repository root:

    python scripts/build_demo_hotel.py           # write the four HTML pages
    python scripts/build_demo_hotel.py --images  # also rebuild the WebP images

The page before the AIO measures is kept unchanged at demo/hotel-before/.
"""
from __future__ import annotations

import argparse
import html
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://lab.ugatta-llc.com"

LANGS = ["ja", "en", "zh", "ko"]
URLS = {"ja": "/demo/hotel/", "en": "/demo/hotel/en/", "zh": "/demo/hotel/zh-hant/", "ko": "/demo/hotel/ko/"}
HTML_LANG = {"ja": "ja", "en": "en", "zh": "zh-Hant", "ko": "ko"}
LANG_LABEL = {"ja": "日本語", "en": "ENGLISH", "zh": "繁體中文", "ko": "한국어"}
BOOKING_LANG = {"ja": "ja", "en": "en", "zh": "en", "ko": "en"}

# image file -> (width, height) of the optimized WebP that the pages use
IMAGES = {
    "hero": (1600, 900), "hero-800": (800, 450), "food": (1000, 750), "room": (1000, 667), "bath": (1000, 667),
    "night": (800, 600), "bath2": (800, 600), "food_sq": (800, 600),
}

PHOTO_CREDITS = [
    ("https://commons.wikimedia.org/wiki/File:Evening_twilight_in_Ginzan_Onsen_town_January_2022_B.jpg", "さかおり (CC BY-SA 4.0)"),
    ("https://commons.wikimedia.org/wiki/File:Kaiseki_001.jpg", "Yuya Tamai (CC BY 2.0)"),
    ("https://commons.wikimedia.org/wiki/File:Garden_and_engawa_in_Japan_(158).jpg", "Savannah Rivka (CC BY-SA 4.0)"),
    ("https://commons.wikimedia.org/wiki/File:%E3%81%AB%E3%81%94%E3%82%8A%E6%B9%AF%E6%BA%90%E6%B3%89%E3%81%8B%E3%81%91%E6%B5%81%E3%81%97%E7%A1%AB%E9%BB%84%E6%B3%89.jpg", "Oden1215 (CC BY-SA 3.0)"),
    ("https://commons.wikimedia.org/wiki/File:Evening_twilight_Ginzan_Onsen_town_seen_from_the_guest_room_of_Kosekiya_Bekkan.jpg", "さかおり (CC BY-SA 4.0)"),
    ("https://commons.wikimedia.org/wiki/File:Outdoor_hot_spring_bath_in_Nigorigo_Onsen.jpg", "Alpsdake (CC BY-SA 4.0)"),
]

CONTENT = {
    "ja": {
        "title": "ホテル翠蓮｜蓮池温泉の源泉かけ流しの温泉旅館（体験デモ）｜宿泊DXラボ",
        "desc": "架空の温泉旅館「ホテル翠蓮」の公式サイトデモ。蓮池温泉の源泉かけ流し、貸切風呂、季節の会席、全20室。日英中韓の4言語で、予約エンジンデモ・簡易PMSデモと連動します。",
        "band": "これは宿泊DXラボの体験デモです。実在しない架空の宿で、実際の予約はできません。",
        "brand": "翠蓮", "brandSub": "HOTEL SUIREN",
        "book": "ご予約", "nav": ["お料理", "客室", "温泉", "よくある質問", "ご案内"],
        "hname": "蓮池温泉　ホテル翠蓮", "catch": "湯のあかりに、心ほどける。",
        "alt": {"hero": "湯けむりと灯りがともる夕暮れの温泉街", "food": "器に盛られた季節の会席料理", "room": "縁側から庭を眺める和室",
                "bath": "翠色のにごり湯の露天風呂", "night": "夜の旅館の外観", "bath2": "森に囲まれた露天風呂", "food_sq": "季節の八寸"},
        "cuiH": "旬を、ひと皿ずつ",
        "cuiP": "山の菜、近海の幸。その日いちばんの食材を、器とともに仕立てる季節の会席です。朝は食事処「睡蓮」で、炊きたての土鍋ごはんと和の朝食を。",
        "cuiFacts": [
            ("夕食", "季節の会席（1名7,700円・税込）。ご予約のあと、前日17時までにお申し込みください。予約ページで選べるプランは、素泊まりと朝食付きです。"),
            ("夕食の場所", "食事処「睡蓮」の個室でご用意します。部屋食はございません。"),
            ("朝食", "1名1,500円。食事処「睡蓮」で、土鍋ごはんの和朝食です。"),
            ("食物アレルギー", "卵、乳、小麦、えび、かに、そば、落花生の7品目に対応します。ご予約時のご要望欄にご記入ください。"),
        ],
        "roomH": "寛ぎの間",
        "roomP": "全20室。縁側ごしに庭を眺める和室から、ひとり旅のための静かな一室まで。どの部屋にも、余白のある時間を用意しています。",
        "rooms": [("和室", "30㎡・定員4名"), ("ツイン", "22㎡・定員2名"), ("シングル", "14㎡・定員1名")],
        "perNight": "／1名1泊",
        "roomFacts": [
            ("寝具", "和室はお布団、ツインとシングルはベッドです。"),
            ("客室のお風呂", "客室に露天風呂は付いていません。温泉は大浴場、露天風呂、貸切風呂でお楽しみください。"),
            ("料金", "1名1泊（素泊まり）の料金で、1室に泊まる人数によって変わります。和室は4名1室利用で1名10,000円、3名で12,000円、2名で15,000円、1名で24,000円。ツインは2名1室利用で1名12,000円、1名で18,000円。シングルは12,000円。朝食付きは1名1泊1,500円を足した料金です。税とサービス料を含み、入湯税（1名1泊150円）は別にいただきます。"),
        ],
        "bathH": "翠の湯",
        "bathP": "湯船に満ちる、やわらかな翠色のにごり湯。夜は湯けむりの向こうに星を、朝は木々の光を眺めながら。（架空の温泉です）",
        "bathFacts": [
            ("泉質", "ナトリウム－塩化物泉（架空の温泉です）"),
            ("源泉かけ流し", "加水・加温・循環をしない、源泉かけ流しです。"),
            ("大浴場と露天風呂", "男女別。15:00〜24:00、6:00〜9:00"),
            ("貸切風呂「蓮」", "1回40分・2,200円。15:00〜22:00。チェックインの際にお申し込みください。"),
        ],
        "gallery": ["夜の佇まい", "森の露天風呂", "季節の八寸"],
        "faqH": "よくある質問",
        "faq": [
            ("源泉かけ流しですか？泉質は？", "加水・加温・循環をしない源泉かけ流しです。泉質はナトリウム－塩化物泉です（架空の温泉です）。"),
            ("露天風呂付きの客室はありますか？", "ありません。男女別の大浴場と露天風呂、貸切風呂「蓮」をご利用ください。"),
            ("貸切風呂はありますか？", "貸切風呂「蓮」が1つあります。1回40分・2,200円で、15:00〜22:00にご利用いただけます。チェックインの際にお申し込みください。"),
            ("夕食付きで泊まれますか？部屋食ですか？", "夕食は季節の会席（1名7,700円・税込）で、ご予約のあと前日17時までにお申し込みいただけます。食事処「睡蓮」の個室でご用意し、部屋食はございません。"),
            ("食物アレルギーに対応できますか？", "卵、乳、小麦、えび、かに、そば、落花生の7品目に対応します。ご予約時のご要望欄にご記入ください。"),
            ("子ども料金と添い寝について教えてください。", "小学生以下のお子さまの添い寝は無料です（お食事・お布団なし）。お子さま朝食は1名800円です。"),
            ("キャンセル料はいつからかかりますか？", "前日は宿泊料金の50%、当日は100%をいただきます。"),
            ("駅から送迎はありますか？", "蓮池駅から無料で送迎します。15:00〜18:00の間で、前日までにご予約ください。蓮池駅からは車で約10分です。"),
            ("チェックインは何時までですか？", "15:00〜22:00です。22時を過ぎる場合は、宿へご連絡ください。"),
            ("支払い方法は？", "現地精算で、現金とクレジットカードがご利用いただけます。料金は税・サービス料込みで、入湯税（1名1泊150円）は別です。"),
        ],
        "info": [
            ("チェックイン", "15:00〜22:00（22時を過ぎる場合はご連絡ください）"),
            ("チェックアウト", "10:00まで"),
            ("客室数", "全20室（和室4、ツイン8、シングル8）"),
            ("Wi-Fi", "全館無料"),
            ("駐車場", "20台・無料"),
            ("アクセス", "蓮池駅から車で約10分"),
            ("送迎", "蓮池駅から無料送迎（15:00〜18:00、前日までに要予約）"),
            ("お支払い", "現地精算（現金、クレジットカード）"),
            ("お子さま", "小学生以下の添い寝は無料（お食事・お布団なし）。お子さま朝食は1名800円"),
            ("キャンセル料", "前日50%、当日100%"),
            ("所在地", "〒000-0000 架空県蓮池市翠蓮1-2-3（実在しない住所です）"),
        ],
        "ctaH": "ご予約", "ctaP": "空室の確認からご予約まで、オンラインで承ります。", "ctaBtn": "空室を検索する",
        "ftNote": "本ページは宿泊DXラボの体験デモです。「ホテル翠蓮」は架空の宿であり、料金・住所・温泉などの情報はデモ用の創作です。予約ボタンの先の予約エンジンデモで確定した予約は、フロント業務画面（簡易PMSデモ）に連動します（お使いのブラウザ内のみ）。写真は雰囲気をお伝えするためのイメージで、実在の場所であり当デモの宿とは関係ありません。",
        "ftAio": "このサイトは、旅館のAIO対策を施した版です。", "ftBefore": "対策前のサイト", "ftReport": "対策の比較レポート",
        "ftPhoto": "写真", "ftBooking": "予約エンジンデモ", "ftPms": "フロント業務画面（簡易PMSデモ・日本語）",
    },
    "en": {
        "title": "Hotel Suiren | Hot-spring ryokan with free-flowing onsen in Hasuike Onsen (demo) | HOTEL DX Lab",
        "desc": "Demo website of Hotel Suiren, a fictional hot-spring ryokan in Hasuike Onsen: free-flowing natural hot spring, private bath, seasonal kaiseki dinner and 20 rooms, in four languages.",
        "band": "A hands-on demo by HOTEL DX Lab. This inn is fictional and no real reservations are accepted.",
        "brand": "翠蓮", "brandSub": "HOTEL SUIREN",
        "book": "Reserve", "nav": ["Cuisine", "Rooms", "Onsen", "FAQ", "Information"],
        "hname": "Hotel Suiren, Hasuike Onsen", "catch": "Unwind in the glow of the baths.",
        "alt": {"hero": "Hot-spring town at dusk with steam and lanterns", "food": "Seasonal kaiseki dishes arranged on tableware",
                "room": "Japanese-style room overlooking the garden from the veranda", "bath": "Open-air bath of milky jade-green hot spring water",
                "night": "The inn at night", "bath2": "Open-air bath surrounded by forest", "food_sq": "Seasonal appetizers (hassun)"},
        "cuiH": "The season, course by course",
        "cuiP": "Mountain vegetables and seafood from nearby waters, the day's best, composed dish by dish. Mornings bring a Japanese breakfast with clay-pot rice at our dining room, Suiren.",
        "cuiFacts": [
            ("Dinner", "Seasonal kaiseki, ¥7,700 per person (tax included). After booking your stay, please request it by 17:00 the day before arrival. Plans on the booking page are room only or with breakfast."),
            ("Where dinner is served", "In private rooms at our dining room, Suiren. Meals are not served in guest rooms."),
            ("Breakfast", "¥1,500 per person. A Japanese breakfast with clay-pot rice at Suiren."),
            ("Food allergies", "We can accommodate seven allergens: egg, milk, wheat, shrimp, crab, buckwheat and peanut. Please note them in the requests field when booking."),
        ],
        "roomH": "Rooms for quiet hours",
        "roomP": "Twenty rooms in all: tatami rooms that open onto the garden veranda, and calm single rooms for the solo traveler. Every room is designed around unhurried time.",
        "rooms": [("Japanese-style room", "30 m² · sleeps 4"), ("Twin room", "22 m² · sleeps 2"), ("Single room", "14 m² · sleeps 1")],
        "perNight": " / person / night",
        "roomFacts": [
            ("Bedding", "Futon in Japanese-style rooms; beds in twin and single rooms."),
            ("In-room baths", "Rooms do not have private open-air baths. Please enjoy the grand baths, open-air baths and our private bath."),
            ("Rates", "Per person per night (room only), depending on how many guests share the room. Japanese-style room: ¥10,000 each for 4 guests, ¥12,000 for 3, ¥15,000 for 2, ¥24,000 for 1. Twin room: ¥12,000 each for 2 guests, ¥18,000 for 1. Single room: ¥12,000. Breakfast adds ¥1,500 per person per night. Rates include tax and service charge; a bathing tax of ¥150 per person per night is charged separately."),
        ],
        "bathH": "The Jade Bath",
        "bathP": "A soft, jade-green hot spring fills the baths. Stars above the steam at night; morning light through the trees at dawn. (A fictional hot spring.)",
        "bathFacts": [
            ("Spring type", "Sodium chloride spring (a fictional hot spring)"),
            ("Free-flowing", "Pure free-flowing hot spring water, with no added water, heating or recirculation."),
            ("Grand and open-air baths", "Separate for men and women. 15:00–24:00 and 6:00–9:00"),
            ("Private bath “Hasu”", "40 minutes for ¥2,200, 15:00–22:00. Please reserve at check-in."),
        ],
        "gallery": ["Evenings at the inn", "Open-air bath in the forest", "Seasonal appetizers"],
        "faqH": "Frequently asked questions",
        "faq": [
            ("Is the hot spring free-flowing? What type of spring is it?", "Yes. It is free-flowing, with no added water, heating or recirculation. The spring type is sodium chloride (a fictional hot spring)."),
            ("Are there rooms with a private open-air bath?", "No. Please use the gender-separated grand baths and open-air baths, or our private bath, Hasu."),
            ("Is there a private bath?", "Yes, one private bath, Hasu: 40 minutes for ¥2,200, available 15:00–22:00. Please reserve at check-in."),
            ("Can I stay with dinner? Is it served in the room?", "Dinner is seasonal kaiseki at ¥7,700 per person (tax included). After booking, request it by 17:00 the day before. It is served in private rooms at our dining room, Suiren, not in guest rooms."),
            ("Can you accommodate food allergies?", "We handle seven allergens: egg, milk, wheat, shrimp, crab, buckwheat and peanut. Please note them in the requests field when booking."),
            ("What are the rates for children? Can they share a bed?", "Children of elementary school age and under can share a bed for free (no meals or futon). Children's breakfast is ¥800."),
            ("When do cancellation fees apply?", "50% of the room rate the day before, and 100% on the day."),
            ("Is there a shuttle from the station?", "Yes, a free shuttle from Hasuike Station between 15:00 and 18:00. Please reserve by the day before. The drive takes about 10 minutes."),
            ("Until what time can I check in?", "Check-in is 15:00–22:00. Please contact us if you will arrive after 22:00."),
            ("How can I pay?", "Pay at the property by cash or credit card. Rates include tax and service charge; the bathing tax of ¥150 per person per night is extra."),
        ],
        "info": [
            ("Check-in", "15:00–22:00 (please contact us if arriving after 22:00)"),
            ("Check-out", "By 10:00"),
            ("Rooms", "20 rooms (4 Japanese-style, 8 twin, 8 single)"),
            ("Wi-Fi", "Free throughout"),
            ("Parking", "20 cars, free"),
            ("Access", "About 10 minutes by car from Hasuike Station"),
            ("Shuttle", "Free shuttle from Hasuike Station (15:00–18:00, reserve by the day before)"),
            ("Payment", "Pay at the property (cash or credit card)"),
            ("Children", "Children of elementary school age and under may share a bed for free (no meals or futon). Children's breakfast ¥800"),
            ("Cancellation", "50% the day before, 100% on the day"),
            ("Address", "1-2-3 Suiren, Hasuike City, Kaku Pref. 000-0000, Japan (a fictional address)"),
        ],
        "ctaH": "Reservations", "ctaP": "Check availability and book online.", "ctaBtn": "Search availability",
        "ftNote": "This page is a hands-on demo by HOTEL DX Lab. Hotel Suiren is fictional; rates, addresses and the hot spring are invented for the demo. Bookings made through the booking demo flow into the front-desk demo (mini PMS), within your browser only. Photos are for atmosphere; they show real places unrelated to this fictional inn.",
        "ftAio": "This version of the site has been prepared for AI search (AIO).", "ftBefore": "Site before the changes (Japanese)", "ftReport": "Comparison report (Japanese)",
        "ftPhoto": "Photos", "ftBooking": "Booking engine demo", "ftPms": "Front-desk demo (mini PMS, Japanese)",
    },
    "zh": {
        "title": "翠蓮旅館｜蓮池溫泉的源泉放流溫泉旅館（體驗示範）｜住宿DX實驗室",
        "desc": "虛構溫泉旅館「翠蓮旅館」的官網示範。蓮池溫泉的源泉放流溫泉、包租湯屋、季節會席料理，全館20間客房，提供日英中韓四種語言。",
        "band": "這是住宿DX實驗室的體驗示範。此旅館為虛構，無法進行真實訂房。",
        "brand": "翠蓮", "brandSub": "HOTEL SUIREN",
        "book": "立即訂房", "nav": ["餐飲", "客房", "溫泉", "常見問題", "資訊"],
        "hname": "蓮池溫泉　翠蓮旅館", "catch": "湯煙燈影，身心舒展。",
        "alt": {"hero": "湯煙與燈火映照的黃昏溫泉街", "food": "盛於器皿中的季節會席料理", "room": "從緣廊眺望庭園的和室",
                "bath": "翠綠色濁湯的露天風呂", "night": "夜晚的旅館外觀", "bath2": "被森林環繞的露天風呂", "food_sq": "季節八寸"},
        "cuiH": "當季食材，逐皿呈現",
        "cuiP": "山間時蔬與近海鮮味——以當日最好的食材，連同器皿一道一道細心烹製的季節會席。早晨在餐廳「睡蓮」享用砂鍋炊飯與日式早餐。",
        "cuiFacts": [
            ("晚餐", "季節會席料理（每人7,700日圓，含稅）。請於訂房後、入住前一天17點前申請。訂房頁面可選擇的方案為純住宿與含早餐。"),
            ("用餐地點", "於餐廳「睡蓮」的包廂用餐，不提供客房內用餐。"),
            ("早餐", "每人1,500日圓。在餐廳「睡蓮」享用砂鍋炊飯的日式早餐。"),
            ("食物過敏", "可對應蛋、乳、小麥、蝦、蟹、蕎麥、花生等7種過敏原。請於訂房時在需求欄註明。"),
        ],
        "roomH": "靜謐客房",
        "roomP": "全館20間客房：有隔著緣廊眺望庭園的和室，也有為獨旅而備的安靜單人房。每間客房，都為您留有從容的時光。",
        "rooms": [("和室", "30㎡・可住4人"), ("雙床房", "22㎡・可住2人"), ("單人房", "14㎡・可住1人")],
        "perNight": "／每人每晚",
        "roomFacts": [
            ("寢具", "和室為日式床墊（布團），雙床房與單人房為床鋪。"),
            ("客房浴池", "客房不附露天浴池。溫泉請至大浴場、露天風呂與包租湯屋享用。"),
            ("價格", "為每人每晚（不含餐）價格，依同房入住人數而異。和室：4人同住每人10,000日圓、3人12,000日圓、2人15,000日圓、1人24,000日圓。雙床房：2人同住每人12,000日圓、1人18,000日圓。單人房：12,000日圓。含早餐另加每人每晚1,500日圓。含稅及服務費，另收入湯稅（每人每晚150日圓）。"),
        ],
        "bathH": "翠之湯",
        "bathP": "浴池中盈滿柔和的翠綠色濁湯。夜晚隔著湯煙仰望星空，清晨在林間光影中入浴。（虛構溫泉）",
        "bathFacts": [
            ("泉質", "鈉－氯化物泉（虛構溫泉）"),
            ("源泉放流", "不加水、不加溫、不循環的源泉放流。"),
            ("大浴場與露天風呂", "男女分開。15:00〜24:00、6:00〜9:00"),
            ("包租湯屋「蓮」", "每次40分鐘・2,200日圓，15:00〜22:00。請於辦理入住時申請。"),
        ],
        "gallery": ["夜之風情", "森林露天風呂", "季節前菜"],
        "faqH": "常見問題",
        "faq": [
            ("是源泉放流嗎？泉質是什麼？", "是不加水、不加溫、不循環的源泉放流。泉質為鈉－氯化物泉（虛構溫泉）。"),
            ("有附露天浴池的客房嗎？", "沒有。請使用男女分開的大浴場、露天風呂，或包租湯屋「蓮」。"),
            ("有包租湯屋嗎？", "有一間包租湯屋「蓮」，每次40分鐘・2,200日圓，開放時間15:00〜22:00。請於辦理入住時申請。"),
            ("可以含晚餐入住嗎？是在客房內用餐嗎？", "晚餐為季節會席料理（每人7,700日圓，含稅），請於訂房後、入住前一天17點前申請。於餐廳「睡蓮」包廂用餐，不提供客房內用餐。"),
            ("可以對應食物過敏嗎？", "可對應蛋、乳、小麥、蝦、蟹、蕎麥、花生等7種過敏原。請於訂房時在需求欄註明。"),
            ("兒童費用與不佔床的規定是？", "小學生以下兒童不佔床免費（不含餐點與寢具）。兒童早餐每人800日圓。"),
            ("取消費從什麼時候開始收取？", "前一天收取住宿費的50%，當天收取100%。"),
            ("有車站接送嗎？", "有，蓮池站免費接送，時間為15:00〜18:00，請於前一天預約。從車站開車約10分鐘。"),
            ("最晚幾點辦理入住？", "入住時間為15:00〜22:00。超過22點抵達時，請與我們聯絡。"),
            ("付款方式有哪些？", "現場付款，可使用現金或信用卡。價格含稅及服務費，入湯稅（每人每晚150日圓）另計。"),
        ],
        "info": [
            ("入住", "15:00〜22:00（超過22點請與我們聯絡）"),
            ("退房", "10:00前"),
            ("客房數", "全20間（和室4・雙床房8・單人房8）"),
            ("Wi-Fi", "全館免費"),
            ("停車場", "20輛・免費"),
            ("交通", "從蓮池站開車約10分鐘"),
            ("接送", "蓮池站免費接送（15:00〜18:00，請於前一天預約）"),
            ("付款", "現場付款（現金、信用卡）"),
            ("兒童", "小學生以下兒童不佔床免費（不含餐點與寢具）。兒童早餐每人800日圓"),
            ("取消費", "前一天50%，當天100%"),
            ("地址", "〒000-0000 架空縣蓮池市翠蓮1-2-3（虛構地址）"),
        ],
        "ctaH": "線上訂房", "ctaP": "查詢空房與訂房，皆可線上完成。", "ctaBtn": "查詢空房",
        "ftNote": "本頁為住宿DX實驗室的體驗示範。「翠蓮旅館」為虛構旅館，價格、地址與溫泉均為示範用創作。透過訂房示範完成的預約，將同步顯示於櫃台業務畫面（簡易PMS示範），僅限於您的瀏覽器內。照片僅供氛圍參考，為與本虛構旅館無關的真實地點。",
        "ftAio": "本網站為已完成AI搜尋對策（AIO）的版本。", "ftBefore": "對策前的網站（日文）", "ftReport": "對策比較報告（日文）",
        "ftPhoto": "照片", "ftBooking": "訂房引擎示範", "ftPms": "櫃台業務畫面（簡易PMS示範・日文）",
    },
    "ko": {
        "title": "호텔 스이렌｜하스이케 온천의 원천 가케나가시 온천 료칸 (체험 데모)｜숙박DX랩",
        "desc": "가상의 온천 료칸 '호텔 스이렌'의 공식 사이트 데모. 하스이케 온천의 원천 가케나가시, 전세탕, 계절 가이세키, 전 20실. 일본어・영어・중국어・한국어 4개 언어.",
        "band": "숙박DX랩의 체험 데모입니다. 가상의 숙소이며 실제 예약은 불가합니다.",
        "brand": "翠蓮", "brandSub": "HOTEL SUIREN",
        "book": "예약하기", "nav": ["요리", "객실", "온천", "자주 묻는 질문", "안내"],
        "hname": "하스이케 온천 호텔 스이렌", "catch": "온천의 불빛에, 마음이 풀리다.",
        "alt": {"hero": "김이 피어오르고 불빛이 켜진 해 질 녘 온천 거리", "food": "그릇에 담긴 계절 가이세키 요리", "room": "툇마루에서 정원을 바라보는 일본식 객실",
                "bath": "비취빛 탁탕의 노천탕", "night": "밤의 료칸 외관", "bath2": "숲에 둘러싸인 노천탕", "food_sq": "계절의 핫슨(전채)"},
        "cuiH": "제철을, 한 접시씩",
        "cuiP": "산나물과 가까운 바다의 해산물 — 그날 가장 좋은 식재료를 그릇과 함께 정성껏 차려내는 계절 가이세키입니다. 아침에는 식당 '수련'에서 뚝배기 솥밥과 일본식 조식을.",
        "cuiFacts": [
            ("저녁 식사", "계절 가이세키(1인 7,700엔, 세금 포함). 숙박 예약 후 전날 17시까지 신청해 주세요. 예약 페이지에서 선택할 수 있는 플랜은 숙박만, 조식 포함입니다."),
            ("식사 장소", "식당 '수련'의 개별실에서 준비합니다. 객실 식사는 제공하지 않습니다."),
            ("조식", "1인 1,500엔. 식당 '수련'에서 뚝배기 솥밥과 일본식 조식."),
            ("식품 알레르기", "달걀, 우유, 밀, 새우, 게, 메밀, 땅콩의 7개 품목에 대응합니다. 예약 시 요청 사항란에 적어 주세요."),
        ],
        "roomH": "쉼의 방",
        "roomP": "전 20실. 툇마루 너머 정원을 바라보는 일본식 객실부터 혼자 여행자를 위한 조용한 싱글룸까지. 모든 객실에 여유로운 시간을 준비했습니다.",
        "rooms": [("일본식 객실", "30㎡・정원 4명"), ("트윈룸", "22㎡・정원 2명"), ("싱글룸", "14㎡・정원 1명")],
        "perNight": "／1인 1박",
        "roomFacts": [
            ("침구", "일본식 객실은 이불, 트윈룸과 싱글룸은 침대입니다."),
            ("객실 욕조", "객실에 노천탕은 없습니다. 대욕장, 노천탕, 전세탕을 이용해 주세요."),
            ("요금", "1인 1박(식사 없음) 요금이며 한 객실에 묵는 인원에 따라 달라집니다. 일본식 객실은 4인 이용 시 1인 10,000엔, 3인 12,000엔, 2인 15,000엔, 1인 24,000엔. 트윈룸은 2인 이용 시 1인 12,000엔, 1인 18,000엔. 싱글룸은 12,000엔. 조식 포함은 1인 1박 1,500엔이 추가됩니다. 세금과 서비스료가 포함되어 있으며 입탕세(1인 1박 150엔)는 별도입니다."),
        ],
        "bathH": "비취의 탕",
        "bathP": "욕조 가득 부드러운 비취빛 탁탕. 밤에는 수증기 너머 별을, 아침에는 나무 사이 빛을 바라보며. (가상의 온천입니다)",
        "bathFacts": [
            ("천질", "나트륨-염화물천(가상의 온천입니다)"),
            ("원천 가케나가시", "가수·가온·순환을 하지 않는 원천 가케나가시입니다."),
            ("대욕장과 노천탕", "남녀 구분. 15:00〜24:00, 6:00〜9:00"),
            ("전세탕 '하스'", "1회 40분·2,200엔. 15:00〜22:00. 체크인 시 신청해 주세요."),
        ],
        "gallery": ["밤의 정취", "숲속 노천탕", "계절의 전채"],
        "faqH": "자주 묻는 질문",
        "faq": [
            ("원천 가케나가시인가요? 천질은 무엇인가요?", "가수·가온·순환을 하지 않는 원천 가케나가시입니다. 천질은 나트륨-염화물천입니다(가상의 온천입니다)."),
            ("노천탕이 딸린 객실이 있나요?", "없습니다. 남녀 구분 대욕장과 노천탕, 전세탕 '하스'를 이용해 주세요."),
            ("전세탕이 있나요?", "전세탕 '하스'가 하나 있습니다. 1회 40분·2,200엔이며 15:00〜22:00에 이용할 수 있습니다. 체크인 시 신청해 주세요."),
            ("저녁 식사 포함으로 묵을 수 있나요? 객실에서 식사하나요?", "저녁은 계절 가이세키(1인 7,700엔, 세금 포함)로, 숙박 예약 후 전날 17시까지 신청할 수 있습니다. 식당 '수련'의 개별실에서 준비하며 객실 식사는 없습니다."),
            ("식품 알레르기에 대응해 주나요?", "달걀, 우유, 밀, 새우, 게, 메밀, 땅콩의 7개 품목에 대응합니다. 예약 시 요청 사항란에 적어 주세요."),
            ("어린이 요금과 침대 공유는 어떻게 되나요?", "초등학생 이하 어린이의 침대 공유는 무료입니다(식사・이불 없음). 어린이 조식은 1인 800엔입니다."),
            ("취소 수수료는 언제부터 발생하나요?", "전날은 숙박 요금의 50%, 당일은 100%입니다."),
            ("역에서 송영이 있나요?", "하스이케역에서 무료로 송영합니다. 15:00〜18:00 사이이며 전날까지 예약해 주세요. 역에서 차로 약 10분입니다."),
            ("체크인은 몇 시까지인가요?", "15:00〜22:00입니다. 22시 이후 도착하실 경우 숙소에 연락해 주세요."),
            ("결제 방법은요?", "현지 결제이며 현금과 신용카드를 사용할 수 있습니다. 요금은 세금・서비스료 포함이며 입탕세(1인 1박 150엔)는 별도입니다."),
        ],
        "info": [
            ("체크인", "15:00〜22:00 (22시 이후 도착 시 연락 주세요)"),
            ("체크아웃", "10:00까지"),
            ("객실 수", "전 20실(일본식 4・트윈 8・싱글 8)"),
            ("Wi-Fi", "전관 무료"),
            ("주차장", "20대・무료"),
            ("교통", "하스이케역에서 차로 약 10분"),
            ("송영", "하스이케역 무료 송영(15:00〜18:00, 전날까지 예약)"),
            ("결제", "현지 결제(현금, 신용카드)"),
            ("어린이", "초등학생 이하 어린이의 침대 공유는 무료(식사・이불 없음). 어린이 조식 1인 800엔"),
            ("취소 수수료", "전날 50%, 당일 100%"),
            ("주소", "〒000-0000 가쿠현 하스이케시 스이렌 1-2-3(실재하지 않는 주소입니다)"),
        ],
        "ctaH": "예약", "ctaP": "공실 확인부터 예약까지 온라인으로.", "ctaBtn": "공실 검색",
        "ftNote": "본 페이지는 숙박DX랩의 체험 데모입니다. '호텔 스이렌'은 가상의 숙소이며 요금・주소・온천 등은 데모용 창작입니다. 예약 데모에서 완료한 예약은 프런트 업무 화면(간이 PMS 데모)에 연동됩니다(사용 중인 브라우저 내에서만). 사진은 분위기 전달용 이미지로, 본 데모의 숙소와 무관한 실제 장소입니다.",
        "ftAio": "이 사이트는 AI 검색 대책(AIO)을 적용한 버전입니다.", "ftBefore": "대책 전 사이트(일본어)", "ftReport": "대책 비교 보고서(일본어)",
        "ftPhoto": "사진", "ftBooking": "예약 엔진 데모", "ftPms": "프런트 업무 화면(간이 PMS 데모・일본어)",
    },
}

CSS = """
:root{
  --bg:#ffffff;--bg2:#f7f5f0;--fg:#3c3a36;--muted:#8c877d;--line:#e6e2d8;--ink:#1f2b28;--gold:#9b8352;
  --font-serif:"Hiragino Mincho ProN","Yu Mincho","YuMincho","Noto Serif CJK JP","Noto Serif JP",serif;
  --font-display:"Shippori Mincho","Hiragino Mincho ProN","Yu Mincho","YuMincho",serif;
  --font-sans:"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic UI","Meiryo",system-ui,sans-serif;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--fg);font-family:var(--font-serif);margin:0;font-size:14px;line-height:2;letter-spacing:.04em}
img{max-width:100%;display:block}
.demo-band{background:#f3ece2;color:#8a6a3c;font-family:var(--font-sans);font-size:11.5px;text-align:center;padding:6px 14px;letter-spacing:.06em}
.hdr{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.97);border-bottom:1px solid var(--line)}
header.top{max-width:1120px;margin:0 auto;padding:20px 20px 10px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
nav.secnav{max-width:1120px;margin:0 auto;padding:0 20px 14px;display:flex;gap:26px;font-family:var(--font-sans);font-size:12px;letter-spacing:.2em}
nav.secnav a{color:var(--muted);text-decoration:none;padding:2px 0;border-bottom:1px solid transparent}
nav.secnav a:hover{color:var(--fg);border-bottom-color:var(--gold)}
@media (max-width:560px){nav.secnav{gap:18px;font-size:11px;overflow-x:auto;white-space:nowrap}}
.brand{display:flex;align-items:baseline;gap:10px;text-decoration:none;color:var(--fg)}
.brand b{font-family:var(--font-display);font-size:25px;font-weight:600;letter-spacing:.3em}
.brand small{font-family:var(--font-sans);font-size:10px;color:var(--muted);letter-spacing:.28em}
.topnav{margin-left:auto;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.lnsw{display:flex;gap:2px;font-family:var(--font-sans)}
.lnsw a{color:var(--muted);font-size:11.5px;padding:3px 8px;letter-spacing:.05em;text-decoration:none;border-bottom:2px solid transparent}
.lnsw a[aria-current="page"]{color:var(--fg);border-bottom-color:var(--gold)}
.lnsw a:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
a.bookbtn{font-family:var(--font-sans);font-size:13px;font-weight:500;letter-spacing:.14em;color:#fff;background:var(--ink);text-decoration:none;padding:10px 26px;border-radius:2px}
a.bookbtn:hover{background:#31443f}
.hero{position:relative;overflow:hidden}
.hero img{width:100%;height:min(76vh,620px);object-fit:cover}
html[lang="ja"] .hero .catch,html[lang="zh-Hant"] .hero .catch{writing-mode:vertical-rl;letter-spacing:.4em;line-height:1.9;max-height:62%}
@media (prefers-reduced-motion: no-preference){
  .hero .catch{opacity:0;animation:fadeUp 1.6s .3s ease forwards}
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  .fx{opacity:0;transform:translateY(22px);transition:opacity 1s ease,transform 1s ease}
  .fx.in{opacity:1;transform:none}
}
.hero .veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,20,25,.25),rgba(15,20,25,.05) 40%,rgba(15,20,25,.45));display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#fdfdf9;padding:20px;gap:14px}
.hero .hname{font-family:var(--font-display);font-size:clamp(13px,1.6vw,15px);font-weight:500;letter-spacing:.32em;margin:0;text-shadow:0 1px 10px rgba(0,0,0,.5)}
.hero .catch{font-family:var(--font-display);font-size:clamp(22px,4.2vw,34px);font-weight:500;letter-spacing:.28em;text-shadow:0 1px 14px rgba(0,0,0,.45);margin:0}
main{display:block}
section.row{max-width:1120px;margin:0 auto;padding:72px 20px 0;display:grid;grid-template-columns:7fr 5fr;gap:48px;align-items:center}
section.row.rev{grid-template-columns:5fr 7fr}
section.row.rev .ph{order:2}
section.row .ph{overflow:hidden}
section.row .ph img{width:100%;height:auto;aspect-ratio:3/2;object-fit:cover}
.eyebrow{font-family:var(--font-sans);color:var(--gold);font-size:11px;letter-spacing:.42em;margin:0 0 14px}
section h2{font-family:var(--font-display);font-size:23px;font-weight:500;letter-spacing:.2em;margin:0 0 20px;text-wrap:balance;position:relative;padding-bottom:16px}
section h2::after{content:"";position:absolute;left:1px;bottom:0;width:38px;height:1px;background:var(--gold)}
section.row p.copy{margin:0;color:#55524b;font-size:13.5px}
.rates{width:100%;border-collapse:collapse;margin-top:22px;font-variant-numeric:tabular-nums}
.rates td{border-top:1px solid var(--line);padding:10px 4px;font-size:13px}
.rates tr:last-child td{border-bottom:1px solid var(--line)}
.rates td:last-child{text-align:right;white-space:nowrap}
.rates .cap{color:var(--muted);font-size:11.5px;font-family:var(--font-sans);margin-left:8px}
.rates .note{color:var(--muted);font-size:11px;font-family:var(--font-sans)}
dl.facts{margin:20px 0 0;display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:13px;line-height:1.85}
dl.facts dt{color:var(--gold);font-family:var(--font-sans);font-size:12px;white-space:nowrap;padding-top:1px}
dl.facts dd{margin:0;color:#55524b}
.gallery{max-width:1120px;margin:76px auto 0;padding:0 20px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.gallery figure{margin:0;overflow:hidden}
.gallery img{width:100%;height:auto;aspect-ratio:4/3;object-fit:cover}
.gallery figcaption{font-family:var(--font-sans);font-size:11px;color:var(--muted);letter-spacing:.2em;padding-top:8px}
@media (max-width:560px){.gallery{grid-template-columns:1fr 1fr;gap:10px}}
.faq{max-width:880px;margin:0 auto;padding:76px 20px 0}
.faq dl{margin:0;border-top:1px solid var(--line)}
.faq dt{font-weight:600;font-size:14px;padding:16px 0 4px;color:var(--fg)}
.faq dt::before{content:"Q. ";color:var(--gold);font-family:var(--font-sans)}
.faq dd{margin:0;padding:0 0 16px;border-bottom:1px solid var(--line);color:#55524b;font-size:13.5px}
.infowrap{background:var(--bg2);margin-top:76px;padding:56px 20px}
.info{max-width:1120px;margin:0 auto}
.info dl{margin:18px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:4px 40px;font-size:13px}
.info dl div{display:grid;grid-template-columns:7.5em 1fr;gap:18px;padding:4px 0;border-bottom:1px solid var(--line)}
.info dt{color:var(--muted);font-family:var(--font-sans);font-size:12px;padding-top:2px}
.info dd{margin:0}
.cta{background:var(--ink);color:#f4f2ea;text-align:center;padding:64px 20px}
.cta h2{font-family:var(--font-display);font-size:20px;font-weight:500;letter-spacing:.3em;margin:0 0 10px;padding:0}
.cta h2::after{display:none}
.cta p{font-family:var(--font-sans);font-size:12px;opacity:.75;margin:0 0 26px;letter-spacing:.1em}
.cta a.bookbtn{background:#f4f2ea;color:var(--ink);font-weight:600}
.cta a.bookbtn:hover{background:#fff}
footer{max-width:1120px;margin:0 auto;padding:30px 20px 46px;font-family:var(--font-sans);font-size:11px;color:var(--muted);line-height:1.9}
footer a{color:var(--gold)}
footer .links{margin-top:8px}
footer .brandmark{text-align:center;margin-bottom:22px}
footer .brandmark b{font-family:var(--font-display);font-size:21px;font-weight:500;letter-spacing:.3em;color:var(--fg)}
footer .brandmark small{display:block;font-size:10px;letter-spacing:.3em}
@media (max-width:760px){
  section.row,section.row.rev{grid-template-columns:1fr;gap:22px;padding-top:52px}
  section.row.rev .ph{order:0}
  .hero img{height:min(62vh,440px)}
  header.top{padding-top:14px}
  .brand b{font-size:21px}
  .info dl div{grid-template-columns:6.5em 1fr}
}
"""

SCRIPT = """
"use strict";
if(!matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window){
  const io = new IntersectionObserver(es => es.forEach(e => {
    if(e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target); }
  }), { rootMargin: "0px 0px -12% 0px" });
  document.querySelectorAll("section.row, .gallery, .faq, .infowrap, .cta").forEach(el => {
    if(el.getBoundingClientRect().top > innerHeight){ el.classList.add("fx"); io.observe(el); }
  });
}
"""


def esc(text: str) -> str:
    return html.escape(text, quote=True)


def display_font_link(t: dict) -> str:
    """Shippori Mincho for headings only, subset to the characters this page shows."""
    shown = "".join([t["brand"], t["hname"], t["catch"], t["cuiH"], t["roomH"], t["bathH"], t["faqH"], t["ctaH"]])
    chars = "".join(sorted(set(shown)))
    return ("https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;600&display=swap&text=" + quote(chars))


def img(name: str, alt: str, *, lazy: bool = True, priority: bool = False) -> str:
    width, height = IMAGES[name]
    attrs = f'src="/demo/hotel/img/{name}.webp" alt="{esc(alt)}" width="{width}" height="{height}"'
    if name == "hero":
        attrs += ' srcset="/demo/hotel/img/hero-800.webp 800w, /demo/hotel/img/hero.webp 1600w" sizes="100vw"'
    if priority:
        attrs += ' fetchpriority="high"'
    elif lazy:
        attrs += ' loading="lazy" decoding="async"'
    return f"<img {attrs}>"


def facts(rows: list[tuple[str, str]]) -> str:
    return '<dl class="facts">' + "".join(f"<dt>{esc(k)}</dt><dd>{esc(v)}</dd>" for k, v in rows) + "</dl>"


def render(lang: str) -> str:
    t = CONTENT[lang]
    url = SITE + URLS[lang]
    alternates = "\n".join(
        f'<link rel="alternate" hreflang="{HTML_LANG[other]}" href="{SITE}{URLS[other]}">' for other in LANGS
    ) + f'\n<link rel="alternate" hreflang="x-default" href="{SITE}{URLS["ja"]}">'
    switcher = "".join(
        f'<a href="{URLS[other]}" hreflang="{HTML_LANG[other]}" lang="{HTML_LANG[other]}"'
        + (' aria-current="page"' if other == lang else "") + f">{LANG_LABEL[other]}</a>"
        for other in LANGS
    )
    booking = f"/demo/booking/?lang={BOOKING_LANG[lang]}"
    nav_ids = ["cuisine", "rooms", "onsen", "faq", "info"]
    nav = "".join(f'<a href="#{i}">{esc(label)}</a>' for i, label in zip(nav_ids, t["nav"]))
    rooms = "".join(
        f'<tr><td><span>{esc(name)}</span><span class="cap">{esc(cap)}</span></td><td>{price}<span class="note">{esc(t["perNight"])}</span></td></tr>'
        for (name, cap), price in zip(t["rooms"], ["¥10,000〜¥24,000", "¥12,000〜¥18,000", "¥12,000"])
    )
    gallery = "".join(
        f"<figure>{img(name, t['alt'][name])}<figcaption>{esc(caption)}</figcaption></figure>"
        for name, caption in zip(["night", "bath2", "food_sq"], t["gallery"])
    )
    faq = "".join(f"<dt>{esc(q)}</dt><dd>{esc(a)}</dd>" for q, a in t["faq"])
    info = "".join(f"<div><dt>{esc(k)}</dt><dd>{esc(v)}</dd></div>" for k, v in t["info"])
    credits = " /\n    ".join(f'<a href="{href}" target="_blank" rel="noopener">{esc(name)}</a>' for href, name in PHOTO_CREDITS)
    return f"""---
# Built by Jekyll: the analytics tags and the demo bar come from _includes/.
# Generated by scripts/build_demo_hotel.py. Edit CONTENT there and rebuild instead of editing this file.
---
<!DOCTYPE html>
<html lang="{HTML_LANG[lang]}">
<head>
{{% include lab-analytics.html %}}
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(t["title"])}</title>
<meta name="description" content="{esc(t["desc"])}">
<link rel="canonical" href="{url}">
{alternates}
<meta property="og:locale" content="{ {"ja": "ja_JP", "en": "en_US", "zh": "zh_TW", "ko": "ko_KR"}[lang] }">
<meta property="og:type" content="website">
<meta property="og:site_name" content="宿泊DXラボ">
<meta property="og:title" content="{esc(t["title"])}">
<meta property="og:description" content="{esc(t["desc"])}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/images/og-lab.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(t["title"])}">
<meta name="twitter:description" content="{esc(t["desc"])}">
<meta name="twitter:image" content="{SITE}/images/og-lab.jpg">
<link rel="stylesheet" href="/css/demo-bar.css?v=20261012demo">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="{esc(display_font_link(t))}" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="{esc(display_font_link(t))}"></noscript>
<style>{CSS}</style>
</head>
<body>
{{% include demo-bar.html %}}
<div class="demo-band">{esc(t["band"])}</div>

<div class="hdr">
<header class="top">
  <a class="brand" href="{URLS[lang]}"><b>{esc(t["brand"])}</b><small>{esc(t["brandSub"])}</small></a>
  <div class="topnav">
    <nav class="lnsw" aria-label="Language">{switcher}</nav>
    <a class="bookbtn" href="{booking}">{esc(t["book"])}</a>
  </div>
</header>
<nav class="secnav" aria-label="Sections">{nav}</nav>
</div>

<div class="hero">
  {img("hero", t["alt"]["hero"], priority=True)}
  <div class="veil">
    <h1 class="hname">{esc(t["hname"])}</h1>
    <p class="catch">{esc(t["catch"])}</p>
  </div>
</div>

<main>
  <section class="row" id="cuisine">
    <div class="ph">{img("food", t["alt"]["food"])}</div>
    <div>
      <p class="eyebrow">CUISINE</p>
      <h2>{esc(t["cuiH"])}</h2>
      <p class="copy">{esc(t["cuiP"])}</p>
      {facts(t["cuiFacts"])}
    </div>
  </section>

  <section class="row rev" id="rooms">
    <div class="ph">{img("room", t["alt"]["room"])}</div>
    <div>
      <p class="eyebrow">ROOMS</p>
      <h2>{esc(t["roomH"])}</h2>
      <p class="copy">{esc(t["roomP"])}</p>
      <table class="rates">{rooms}</table>
      {facts(t["roomFacts"])}
    </div>
  </section>

  <section class="row" id="onsen">
    <div class="ph">{img("bath", t["alt"]["bath"])}</div>
    <div>
      <p class="eyebrow">ONSEN</p>
      <h2>{esc(t["bathH"])}</h2>
      <p class="copy">{esc(t["bathP"])}</p>
      {facts(t["bathFacts"])}
    </div>
  </section>

  <section class="gallery">{gallery}</section>

  <section class="faq" id="faq">
    <p class="eyebrow">FAQ</p>
    <h2>{esc(t["faqH"])}</h2>
    <dl>{faq}</dl>
  </section>

  <div class="infowrap" id="info">
    <div class="info">
      <p class="eyebrow">INFORMATION</p>
      <dl>{info}</dl>
    </div>
  </div>

  <div class="cta">
    <h2>{esc(t["ctaH"])}</h2>
    <p>{esc(t["ctaP"])}</p>
    <a class="bookbtn" href="{booking}">{esc(t["ctaBtn"])}</a>
  </div>
</main>

<footer>
  <div class="brandmark"><b>{esc(t["brand"])}</b><small>{esc(t["brandSub"])}</small></div>
  <span>{esc(t["ftNote"])}</span>
  <div class="links">{esc(t["ftAio"])} <a href="/demo/hotel-before/">{esc(t["ftBefore"])}</a> ／ <a href="/ai-inn-diagnosis/sample/">{esc(t["ftReport"])}</a></div>
  <div class="links">
    {esc(t["ftPhoto"])}:
    {credits}
    — via Wikimedia Commons
  </div>
  <div class="links"><a href="/">宿泊DXラボ</a> ／ <a href="{booking}">{esc(t["ftBooking"])}</a> ／ <a href="/demo/mini-pms/">{esc(t["ftPms"])}</a></div>
</footer>

<script>{SCRIPT}</script>
</body>
</html>
"""


def output_path(lang: str) -> Path:
    return ROOT / URLS[lang].strip("/") / "index.html"


def build_images() -> None:
    from PIL import Image

    folder = ROOT / "demo/hotel/img"
    for name, (width, height) in IMAGES.items():
        source = Image.open(folder / f"{name.removesuffix('-800')}.jpg").convert("RGB")
        # cover-crop to the target ratio, then scale down
        ratio = width / height
        src_w, src_h = source.size
        if src_w / src_h > ratio:
            new_w = int(src_h * ratio)
            left = (src_w - new_w) // 2
            source = source.crop((left, 0, left + new_w, src_h))
        else:
            new_h = int(src_w / ratio)
            top = (src_h - new_h) // 2
            source = source.crop((0, top, src_w, top + new_h))
        source.resize((width, height), Image.LANCZOS).save(folder / f"{name}.webp", "WEBP", quality=72, method=6)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--images", action="store_true", help="also rebuild the WebP images from the JPEG originals")
    args = parser.parse_args(argv)
    if args.images:
        build_images()
    for lang in LANGS:
        path = output_path(lang)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render(lang), encoding="utf-8", newline="\n")
        print("wrote", path.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
