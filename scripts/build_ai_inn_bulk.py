"""Build the public page of the bulk "AIに聞かれる宿" diagnosis from its published aggregate.

The page reads only data/ai-inn-bulk/summary.json, the aggregate that the private
diagnosis repository publishes (groups under 5 inns already left out, no per-inn rows).
Nothing per inn comes into this repository, so the page cannot show it. Every number on
the page is computed here from that file, so the page and the data cannot drift apart.
Run from the repository root after replacing summary.json:

    python scripts/build_ai_inn_bulk.py
"""
from __future__ import annotations

import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "ai-inn-bulk" / "summary.json"
OUTPUT = ROOT / "ai-inn-diagnosis" / "bulk" / "index.html"
URL = "https://lab.ugatta-llc.com/ai-inn-diagnosis/bulk/"
NAME = "AIに聞かれる宿 一斉診断 集計レポート"

# 予約の判断に要る条件（料金・規約・家族向け）。19項目のグラフで色を付ける
BOOKING_ITEMS = ("I11", "I13", "I14", "I15", "I16")
NOJS = {"readable": "JavaScriptなしで本文が読める", "partial": "JavaScriptなしでは一部しか読めない",
        "unreadable": "JavaScriptなしではほぼ読めない"}
MULTILINGUAL = {"separate_urls": "言語ごとにURLが分かれている", "js_only": "JavaScriptで切り替えるだけ",
                "none": "外国語ページがない"}
STRUCTURED = {"lodging_type": "宿泊施設の型がある", "other_type": "ほかの型だけある", "none": "ない"}


def esc(text) -> str:
    return html.escape(str(text), quote=True)


def num(value: float, digits: int = 1) -> str:
    return f"{value:.{digits}f}"


def count(value: float) -> str:
    """中央値など、整数になることが多い値。整数なら小数点を付けない。"""
    return str(int(value)) if float(value).is_integer() else f"{value:.1f}"


def pct(rate: float | None) -> str:
    return "—" if rate is None else f"{round(rate * 100)}%"


def yen(value: float | None) -> str:
    return "—" if value is None else f"{round(value):,}円"


def width(value: float, total: float) -> str:
    return f"{max(0.0, min(100.0, value / total * 100)):.1f}%"


def scored_questions(overall: dict) -> list[tuple[str, dict]]:
    return [(qid, q) for qid, q in overall["questions"].items() if q["scored"]]


def one_short_total(overall: dict) -> int:
    return sum((q.get("one_short") or {}).get("count", 0) for _, q in scored_questions(overall))


def missing_count(overall: dict, qid: str, element: str) -> int:
    return ((overall["questions"][qid].get("one_short") or {}).get("missing") or {}).get(element, 0)


def facts(summary: dict) -> dict:
    """ページの文章に入る数字。どれも summary.json から計算する。"""
    o = summary["overall"]
    total = one_short_total(o)
    per_inn = total / o["inns"]
    items = o["items"]
    return {
        "inns": o["inns"], "not_judged": o["inns_not_judged"],
        "mean": o["answered"]["mean"], "median": o["answered"]["median"], "rate": o["answered"]["rate"],
        "one_short_total": total, "one_short_per_inn": per_inn, "estimate": o["answered"]["mean"] + per_inn,
        "price_absent": items["I11"]["absent_rate"], "cancel_absent": items["I14"]["absent_rate"],
        "child_absent": items["I13"]["absent_rate"], "hidden": o["inns_with_hidden_questions"],
        "no_price": missing_count(o, "Q04", "1泊の料金"), "no_deadline": missing_count(o, "Q11", "チェックインの締め切り"),
        "no_flow": missing_count(o, "Q02", "源泉かけ流しかどうか"), "no_place": missing_count(o, "Q06", "部屋食かどうか"),
        "markets": len(summary["markets"]), "updated": summary["generated_at"][:10],
    }


def bar_rows_questions(overall: dict) -> str:
    rows = sorted(scored_questions(overall), key=lambda kv: (-kv[1]["answered"], kv[0]))
    out = []
    for qid, q in rows:
        short = (q.get("one_short") or {}).get("count", 0)
        total = q["applicable"]
        value = f'{q["answered"]}<span class="ai-bars__to"> → {q["answered"] + short}</span>' if short else str(q["answered"])
        label = (f'{qid} {q["text"]}：答えられた{q["answered"]}軒、あと1行で答えられる{short}軒（{total}軒中）'
                 if short else f'{qid} {q["text"]}：答えられた{q["answered"]}軒（{total}軒中）')
        out.append(
            f'<li class="ai-bars__row"><span class="ai-bars__label">{esc(qid)} {esc(q["text"])}</span>'
            f'<span class="ai-bars__track" role="img" aria-label="{esc(label)}">'
            f'<span class="ai-bars__fill" style="width:{width(q["answered"], total)}"></span>'
            + (f'<span class="ai-bars__fill ai-bars__fill--short" style="width:{width(short, total)}"></span>' if short else "")
            + f'</span><span class="ai-bars__value">{value}</span></li>')
    return "\n          ".join(out)


def one_short_table(overall: dict) -> str:
    rows = []
    for qid, q in sorted(scored_questions(overall), key=lambda kv: -(kv[1].get("one_short") or {}).get("count", 0)):
        short = q.get("one_short")
        if not short:
            continue
        parts = "、".join(f"{esc(element)} {count}軒" for element, count in short["missing"].items())
        rows.append(f'<tr><th scope="row">{esc(qid)} {esc(q["text"])}</th><td>{short["count"]}軒</td><td>{parts}</td></tr>')
    return "\n          ".join(rows)


def bar_rows_items(overall: dict) -> str:
    rows = sorted(overall["items"].items(), key=lambda kv: (-kv[1]["absent_rate"], kv[0]))
    out = []
    for iid, it in rows:
        booking = iid in BOOKING_ITEMS
        out.append(
            f'<li class="ai-bars__row{" ai-bars__row--key" if booking else ""}"><span class="ai-bars__label">{esc(it["name"])}</span>'
            f'<span class="ai-bars__track" role="img" aria-label="{esc(it["name"])}：{it["absent"]}軒（{it["applicable"]}軒中）で書かれていない">'
            f'<span class="ai-bars__fill{" ai-bars__fill--key" if booking else " ai-bars__fill--muted"}" style="width:{width(it["absent_rate"], 1)}"></span>'
            f'</span><span class="ai-bars__value">{pct(it["absent_rate"])}</span></li>')
    return "\n          ".join(out)


def bar_rows_markets(summary: dict) -> str:
    o = summary["overall"]
    out = [f'<li class="ai-bars__row ai-bars__row--total"><span class="ai-bars__label">全体（{o["inns"]}軒）</span>'
           f'<span class="ai-bars__track" role="img" aria-label="全体：平均{o["answered"]["mean"]}問">'
           f'<span class="ai-bars__fill" style="width:{width(o["answered"]["mean"], 11)}"></span></span>'
           f'<span class="ai-bars__value">{num(o["answered"]["mean"], 2)}</span></li>']
    for g in sorted(summary["markets"], key=lambda g: (-g["answered"]["mean"], g["group"]["code"])):
        mean = g["answered"]["mean"]
        out.append(
            f'<li class="ai-bars__row"><span class="ai-bars__label">{esc(g["group"]["name"])}</span>'
            f'<span class="ai-bars__track" role="img" aria-label="{esc(g["group"]["name"])}：平均{num(mean)}問（{g["inns"]}軒）">'
            f'<span class="ai-bars__fill ai-bars__fill--muted" style="width:{width(mean, 11)}"></span></span>'
            f'<span class="ai-bars__value">{num(mean)}</span></li>')
    return "\n          ".join(out)


def stage_rows(overall: dict) -> str:
    return "\n          ".join(
        f'<tr><th scope="row">{esc(stage)}</th><td>{s["answered"]} / {s["denominator"]}</td><td>{pct(s["rate"])}</td></tr>'
        for stage, s in overall["stages"].items())


def lowest_stages(overall: dict) -> list[str]:
    return [stage for stage, _ in sorted(overall["stages"].items(), key=lambda kv: kv[1]["rate"])[:2]]


def size_rows(summary: dict) -> str:
    return "\n          ".join(
        f'<tr><th scope="row">{esc(g["group"]["label"])}</th><td>{g["inns"]}軒</td><td>{num(g["answered"]["mean"], 2)}問</td>'
        f'<td>{count(g["answered"]["median"])}問</td></tr>' for g in summary["sizes"])


def machine_rows(overall: dict) -> str:
    rows = []
    for title, key, labels in (("JavaScriptなしで読めるか", "nojs", NOJS), ("外国語ページ", "multilingual", MULTILINGUAL),
                               ("宿泊施設の構造化データ", "structured_data", STRUCTURED)):
        counts = overall["machine"][key]
        for i, (value, label) in enumerate(labels.items()):
            c = counts.get(value, {"count": 0, "rate": 0})
            head = f'<th scope="rowgroup" rowspan="{len(labels)}">{esc(title)}</th>' if i == 0 else ""
            rows.append(f'<tr>{head}<td>{esc(label)}</td><td>{c["count"]}軒</td><td>{pct(c["rate"])}</td></tr>')
    return "\n          ".join(rows)


def price_section(overall: dict) -> str:
    pc = overall.get("price_comparison")
    if not pc:
        return ""
    lo, hi = pc["lower_half"], pc["upper_half"]
    rows = [
        ("答えられた質問（中央値）", f'{count(lo["answered_median"])}問', f'{count(hi["answered_median"])}問'),
        ("2食付きの料金（中央値）", yen(lo["two_meals_price_median_yen"]), yen(hi["two_meals_price_median_yen"])),
        ("参考最低料金（中央値）", yen(lo["reference_min_charge_yen_median"]), yen(hi["reference_min_charge_yen_median"])),
        ("総合評価（中央値）", num(lo["review_average_median"], 2), num(hi["review_average_median"], 2)),
        ("風呂の評価（中央値）", num(lo["bath_rating_median"], 2), num(hi["bath_rating_median"], 2)),
        ("夕食の評価（中央値）", num(lo["dinner_rating_median"], 2), num(hi["dinner_rating_median"], 2)),
    ]
    body = "\n          ".join(f'<tr><th scope="row">{a}</th><td>{b}</td><td>{c}</td></tr>' for a, b, c in rows)
    return f'''
    <section class="ai-section" id="price" aria-labelledby="price-title"><div class="container">
      <h2 class="ai-h2" id="price-title">よく答えられる宿と、そうでない宿の料金と評価</h2>
      <p class="ai-lead">楽天トラベルの料金と評価がある宿を、答えられた質問の数で上位半分と下位半分に分けて比べました。評価はほとんど変わりません。</p>
      <div class="ai-table-wrap ai-table-wrap--narrow"><table class="ai-table">
        <thead><tr><th scope="col">比べたもの</th><th scope="col">下位半分（{lo["inns"]}軒）</th><th scope="col">上位半分（{hi["inns"]}軒）</th></tr></thead>
        <tbody>
          {body}
        </tbody>
      </table></div>
      <p class="ai-note">{esc(pc["note"])}</p>
    </div></section>
'''


def series_nav(f: dict, current: str) -> str:
    """「AIに聞かれる宿」の3つのページの流れ。サンプルページにも同じものを手で置いている（tests で一致を確かめる）。"""
    steps = [
        ("bulk", "/ai-inn-diagnosis/bulk/", "実態を知る", f'実在の温泉旅館{f["inns"]}軒の集計', f'AIが答えられた質問は平均{num(f["mean"])}問'),
        ("sample", "/ai-inn-diagnosis/sample/", "対策の効果を見る", "対策前後のサンプル", "架空の宿で4問から12問へ"),
        ("request", "#request", "自館を診断する", "自館の診断（準備中）", "その宿の結果と直す順番をお渡しします"),
    ]
    items = "".join(
        f'<li><a class="ai-series__step" href="{href}"{' aria-current="page"' if key == current else ''}>'
        f'<span class="ai-series__num">{i}</span><span class="ai-series__kicker">{kicker}</span>'
        f'<strong>{esc(title)}</strong><span class="ai-series__note">{esc(note)}</span></a></li>'
        for i, (key, href, kicker, title, note) in enumerate(steps, 1))
    return f'<nav class="ai-series" aria-label="AIに聞かれる宿 診断のページ"><div class="container"><ol>{items}</ol></div></nav>'


def render(summary: dict) -> str:
    f = facts(summary)
    o = summary["overall"]
    low = lowest_stages(o)
    means = [g["answered"]["mean"] for g in summary["markets"]]
    market_inns = sorted({g["inns"] for g in summary["markets"]})
    each = f"各地{market_inns[0]}軒" if len(market_inns) == 1 else "各地5軒前後"
    models = "、".join(summary["models"])
    title = f'温泉旅館{f["inns"]}軒のAIO診断｜{NAME}｜宿泊DXラボ'
    description = (f'温泉地の旅館・ホテル{f["inns"]}軒の公式サイトを、旅館ならではの12の質問で一斉に診断した集計です。'
                   f'AIが答えられた質問は平均{num(f["mean"], 2)}問（11問中）。あと1行書けば答えられる質問が、1軒あたり{num(f["one_short_per_inn"])}問ありました。')
    return f'''---
# このページは scripts/build_ai_inn_bulk.py が data/ai-inn-bulk/summary.json から作ります。直接は編集しません。
tool: ai-inn-bulk
tool_purpose: 温泉地の旅館・ホテル{f["inns"]}軒の公式サイトを、AIに聞かれる旅館ならではの12の質問で一斉に診断した集計です。AIが答えられた質問の数、あと1行書けば答えられる質問、サイトに書かれていない情報を、温泉地と客室数の区分でまとめました。宿ごとの結果は公開していません。
tool_scope:
  - label: 対象
    text: 宿泊DXラボの宿泊料金トレンドで料金を見ている温泉地の旅館・ホテルのうち、公式サイトを読めた{f["inns"]}軒（読めなかった{f["not_judged"]}軒は除いています）。
  - label: データ
    text: 公式サイトの本文。AIに12の質問と19の項目を3回ずつ判定させ、AIが挙げた引用が本文に実在するかをプログラムで確かめた結果です。
  - label: 条件
    text: 判定するのは「サイトに書いてあるか」と「ページ同士が食い違っていないか」だけで、内容が事実どおりかは確かめていません。5軒未満の区分は出していません。
tool_cta:
  label: 集計を見る
  href: "#summary"
  tool_id: ai-inn-bulk-summary
tool_updated: "{f["updated"]}"
tool_updated_label: 集計日
tool_sources:
  - name: 対象の宿
    publisher: 宿泊DXラボ 宿泊料金トレンドで料金を見ている温泉地の旅館・ホテル
    url: /hotel-price-trends.html
  - name: 料金と評価
    publisher: 楽天トラベル（宿泊料金トレンドの{esc(summary.get("price_snapshot_date") or "")}時点のデータ）
tool_notes:
  - 宿ごとの結果、集めたページ、AIへの入力と出力は公開していません。診断を希望する宿には、その宿の結果だけをお渡しします。
  - ページ同士の食い違いは多めに数えている可能性があり確かめていないため、この集計では「宿に確認を」に含めています。
  - AIの判定は回ごとに少し揺れます。数%の差は誤差の範囲です。
  - 集めたのは公式サイトの一部のページです。予約システムの中だけにある料金や規約は読まれていません。それ自体が、AIから見えていないことを示しています。
tool_related:
  - ai-inn-sample
  - hotel-price-trends
  - dx-diagnosis
---
<!DOCTYPE html>
<html lang="ja">
<head>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-QS9HSHCY33"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments)}}gtag('js',new Date());gtag('config','G-QS9HSHCY33');gtag('config','GT-M3S9S5D7');</script>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="{URL}">
  <meta property="og:locale" content="ja_JP">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="宿泊DXラボ">
  <meta property="og:title" content="{esc(f'温泉旅館{f["inns"]}軒のAIO診断｜{NAME}')}">
  <meta property="og:description" content="{esc(description)}">
  <meta property="og:url" content="{URL}">
  <meta property="og:image" content="https://lab.ugatta-llc.com/images/og-lab.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{esc(f'温泉旅館{f["inns"]}軒のAIO診断｜{NAME}')}">
  <meta name="twitter:description" content="{esc(description)}">
  <meta name="twitter:image" content="https://lab.ugatta-llc.com/images/og-lab.jpg">
  <meta name="theme-color" content="#17324d">
  <link rel="icon" type="image/png" href="/favicon.png?v=20261013">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&amp;display=swap">
  <link rel="stylesheet" href="/css/useful.css?v=20261012shell">
  <link rel="stylesheet" href="/css/tool-standard.css?v=20261015guide">
  <link rel="stylesheet" href="/css/ai-inn.css?v=20261023bulk">
  <script type="application/ld+json">
  {json.dumps({"@context": "https://schema.org", "@graph": [
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "ホーム", "item": "https://lab.ugatta-llc.com/"},
            {"@type": "ListItem", "position": 2, "name": "分析・ツール", "item": "https://lab.ugatta-llc.com/#analysis-tools"},
            {"@type": "ListItem", "position": 3, "name": NAME, "item": URL}]},
        {"@type": "Report", "name": NAME, "url": URL, "inLanguage": "ja-JP", "datePublished": f["updated"],
         "description": description,
         "publisher": {"@type": "Organization", "@id": "https://lab.ugatta-llc.com/#organization", "name": "宿泊DXラボ",
                       "url": "https://lab.ugatta-llc.com/"}}]}, ensure_ascii=False)}
  </script>
  <link rel="stylesheet" href="/css/site-shell.css?v=20261012shell">
  <script src="/js/site-shell.js?v=20261012shell2" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">本文へ移動</a>
  {{% include site-header.html %}}
  <main id="main">
    <nav class="breadcrumb container" aria-label="パンくずリスト"><ol><li><a href="/">ホーム</a></li><li><a href="/#analysis-tools">分析・ツール</a></li><li aria-current="page">{NAME}</li></ol></nav>
    <section class="page-hero tool-page-hero"><div class="container page-hero-grid"><div><span class="scope-badge scope-badge--facility">旅館のAIO対策（{f["inns"]}軒の集計）</span><h1>AIに聞かれる宿<br>一斉診断<br>集計レポート</h1></div><div><p>「源泉かけ流しの宿は？」「部屋食で、子どもも泊まれる旅館は？」。AIに宿を相談したとき、AIは旅館の公式サイトから答えられるのでしょうか。温泉地の旅館・ホテル{f["inns"]}軒の公式サイトを、旅館ならではの12の質問で一斉に診断しました。</p><p class="ai-hero-note">このページは集計値だけを載せています。宿ごとの結果は公開していません。</p></div></div></section>
    {series_nav(f, "bulk")}
    {{% include tool-overview.html %}}

    <section class="ai-section" id="summary" aria-labelledby="summary-title"><div class="container">
      <h2 class="ai-h2" id="summary-title">AIが公式サイトから答えられた質問は、11問中平均{num(f["mean"], 2)}問でした</h2>
      <p class="ai-lead">温泉、食事、客室、子ども連れ、送迎、キャンセル料について、公式サイトの本文だけで答えられるかを確かめました。答えられなかった質問の多くは、もう1行書いてあれば答えられるものでした。</p>
      <dl class="ai-kpis">
        <div class="ai-kpi" data-kpi="answered"><dt>AIが答えられた質問（平均）</dt><dd><strong>{num(f["mean"], 2)}</strong><span> / 11問</span></dd><p>中央値は{count(f["median"])}問です。11問のうち{pct(f["rate"])}に答えられました。</p></div>
        <div class="ai-kpi" data-kpi="one-short"><dt>あと1行で答えられる質問（1軒あたり）</dt><dd><strong>{num(f["one_short_per_inn"])}</strong><span> 問</span></dd><p>すべて書き足せば、平均{num(f["estimate"])}問前後になる試算です。</p></div>
        <div class="ai-kpi ai-kpi--warn" data-kpi="price"><dt>1泊の料金が本文に書かれていない宿</dt><dd><strong>{pct(f["price_absent"])}</strong></dd><p>キャンセル料は{pct(f["cancel_absent"])}、子ども料金と添い寝は{pct(f["child_absent"])}の宿で書かれていません。</p></div>
        <div class="ai-kpi" data-kpi="hidden"><dt>JavaScriptを動かさないと答えられない質問があった宿</dt><dd><strong>{f["hidden"]}</strong><span> 軒</span></dd><p>多くのAIの巡回はJavaScriptを動かさないため、その部分は読まれません。</p></div>
      </dl>
      <p class="ai-callout"><strong>いちばん多い「あと一歩」：</strong>{f["no_price"]}軒は、部屋の広さを書いているのに1泊の料金がありません。そのため「部屋の広さと1泊の料金は？」に、AIは「宿に確認を」と答えるしかありませんでした。</p>
    </div></section>

    <section class="ai-section ai-section--plain" id="one-short" aria-labelledby="one-short-title"><div class="container">
      <h2 class="ai-h2" id="one-short-title">あと1行で答えられる質問が、1軒あたり{num(f["one_short_per_inn"])}問あります</h2>
      <p class="ai-lead">質問ごとに、答えられた宿と、足りないのが1つの要素だけだった宿を数えました。右の数字は「今答えられた宿 → 1行書き足した場合」です。</p>
      <ul class="ai-legend ai-legend--bars" aria-label="凡例"><li><span class="ai-swatch"></span>答えられた</li><li><span class="ai-swatch ai-swatch--short"></span>あと1行で答えられる</li><li><span class="ai-swatch ai-swatch--rest"></span>それ以外の「宿に確認を」</li></ul>
      <ol class="ai-bars" aria-label="質問ごとの、答えられた宿とあと1行で答えられる宿（{f["inns"]}軒中）">
          {bar_rows_questions(o)}
      </ol>
      <div class="ai-table-wrap ai-table-wrap--spaced"><table class="ai-table">
        <thead><tr><th scope="col">質問</th><th scope="col">あと1行の宿</th><th scope="col">足りなかったもの</th></tr></thead>
        <tbody>
          {one_short_table(o)}
        </tbody>
      </table></div>
      <p class="ai-note">「露天風呂付きの客室」「貸切風呂」「送迎」の「宿に確認を」には、その設備やサービスがない宿も含まれます。「ありません」と書けば、AIは答えられます。</p>
    </div></section>

    <section class="ai-section" id="items" aria-labelledby="items-title"><div class="container">
      <h2 class="ai-h2" id="items-title">書かれていないのは、料金・キャンセル料・子ども料金など予約の判断に要る条件です</h2>
      <p class="ai-lead">旅館の情報を19の項目に分け、本文に書かれていなかった宿の割合を並べました（一部だけ書かれていた宿は含めていません）。温泉や料理など宿の魅力はよく書かれています。</p>
      <ul class="ai-legend ai-legend--bars" aria-label="凡例"><li><span class="ai-swatch ai-swatch--key"></span>予約の判断に要る条件（料金・規約・家族向け）</li><li><span class="ai-swatch ai-swatch--muted"></span>そのほか</li></ul>
      <ol class="ai-bars" aria-label="19項目ごとの、書かれていない宿の割合">
          {bar_rows_items(o)}
      </ol>
      <p class="ai-note">料金や規約は、予約システムの中にだけ書かれていることが多いと考えられます。AIが読む公式サイトの本文にも、目安を書いておくと答えられます。</p>
    </div></section>

    <section class="ai-section ai-section--plain" id="stages" aria-labelledby="stages-title"><div class="container">
      <h2 class="ai-h2" id="stages-title">旅の段階では「{esc(low[0])}」と「{esc(low[1])}」で、AIが答えに詰まっています</h2>
      <p class="ai-lead">12の質問を、宿泊客の旅の5つの段階に分けて、答えられた割合を出しました。「どんな旅館？おすすめは？」は点数に入れていません。</p>
      <div class="ai-table-wrap ai-table-wrap--narrow"><table class="ai-table">
        <thead><tr><th scope="col">旅の段階</th><th scope="col">答えられた質問 / 対象</th><th scope="col">割合</th></tr></thead>
        <tbody>
          {stage_rows(o)}
        </tbody>
      </table></div>
    </div></section>

    <section class="ai-section" id="markets" aria-labelledby="markets-title"><div class="container">
      <h2 class="ai-h2" id="markets-title">温泉地ごとの平均は{num(min(means))}〜{num(max(means))}問。{each}のため、温泉地の差というより宿ごとの差です</h2>
      <p class="ai-lead">公開できる{f["markets"]}の温泉地について、答えられた質問の平均（11問中）を並べました。宿の数が5軒未満の区分（{summary["suppressed_groups"]}区分）は、宿が特定されないよう出していません。</p>
      <ol class="ai-bars ai-bars--markets" aria-label="温泉地ごとの、答えられた質問の平均">
          {bar_rows_markets(summary)}
      </ol>
    </div></section>

    <section class="ai-section ai-section--plain" id="sizes" aria-labelledby="sizes-title"><div class="container">
      <h2 class="ai-h2" id="sizes-title">客室数が多い宿ほど書いてある、とは限りません</h2>
      <p class="ai-lead">客室数で分けた区分ごとの、答えられた質問の数です。「規模不明」は、公式サイトに客室数が書かれていなかった宿です。</p>
      <div class="ai-table-wrap ai-table-wrap--narrow"><table class="ai-table">
        <thead><tr><th scope="col">客室数</th><th scope="col">宿の数</th><th scope="col">平均</th><th scope="col">中央値</th></tr></thead>
        <tbody>
          {size_rows(summary)}
        </tbody>
      </table></div>
    </div></section>

    <section class="ai-section" id="machine" aria-labelledby="machine-title"><div class="container">
      <h2 class="ai-h2" id="machine-title">サイトの作り：JavaScript、外国語ページ、構造化データ</h2>
      <p class="ai-lead">AIに読まれやすいかを左右するサイトの作りを、プログラムで確かめました。</p>
      <div class="ai-table-wrap ai-table-wrap--narrow"><table class="ai-table">
        <thead><tr><th scope="col">確かめたこと</th><th scope="col">結果</th><th scope="col">宿の数</th><th scope="col">割合</th></tr></thead>
        <tbody>
          {machine_rows(o)}
        </tbody>
      </table></div>
      <p class="ai-note">構造化データがあっても、本文に書かれていなければAIの答えにはなりません。</p>
    </div></section>
{price_section(o)}
    <section class="ai-section ai-section--plain" id="advice" aria-labelledby="advice-title"><div class="container">
      <h2 class="ai-h2" id="advice-title">宿のサイトで、すぐにできること</h2>
      <p class="ai-lead">効きやすい順に並べました。いちばん手軽なのは、よくある質問に3行足すことです。実際に対策すると答えがどう変わるかは、<a href="/ai-inn-diagnosis/sample/">架空の宿で対策前と対策後を比べたサンプル</a>で見られます。</p>
      <ol class="ai-steps">
        <li><strong>よくある質問に3行足す。</strong>「チェックインは◯時まで」「キャンセル料は◯日前から◯%」「小学生◯円・添い寝◯円」の3つです。チェックインの締め切りだけが足りない宿は{f["no_deadline"]}軒ありました。</li>
        <li><strong>客室ページに料金の目安を書く。</strong>「2名1室1泊◯円〜（夕朝食付き）」の1行です。広さはあるのに料金がない宿が{f["no_price"]}軒ありました。</li>
        <li><strong>温泉ページに湯の扱いを書く。</strong>「源泉かけ流し」か「加水・加温・循環あり」かを書きます。泉質だけの宿が{f["no_flow"]}軒ありました。</li>
        <li><strong>食事ページに場所を書く。</strong>「夕食は部屋食／個室の食事処／レストラン」を書きます。夕食付きだけの宿が{f["no_place"]}軒ありました。</li>
        <li><strong>「ない」も書く。</strong>送迎、露天風呂付きの客室、貸切風呂がない場合も「ありません」と書きます。</li>
        <li><strong>ページ同士の数字をそろえ、古いお知らせを消す。</strong>所要時間、営業時間、送迎の条件がページによって違うと、AIは「宿に確認を」と答えます。</li>
        <li><strong>大事な情報はJavaScriptなしで読めるようにする。</strong>料金表やチェックインの案内を、HTMLの本文に置きます。</li>
      </ol>
    </div></section>

    <section class="ai-section" id="method" aria-labelledby="method-title"><div class="container">
      <h2 class="ai-h2" id="method-title">診断のしかた</h2>
      <ul class="ai-steps ai-steps--plain">
        <li>公式サイトのトップページと、温泉・食事・客室・アクセス・よくある質問などのページを集めました。集めるときは各サイトの robots.txt に従い、間隔をあけています。</li>
        <li>JavaScriptを動かさずに読める本文をAI（{esc(models)}）に渡し、12の質問と19の項目を宿ごとに3回判定しました。AIが挙げた引用が本文に実在するかは、プログラムで確かめています。</li>
        <li>「答えられた」は、本文に根拠となる記述があるという意味です。内容が事実どおりかは確かめていません。</li>
        <li>「あと1行で答えられる」は、答えられなかった質問のうち、足りないのが1つの要素だけだったものです（3回の判定の過半数で数えています）。</li>
        <li>温泉のない宿では、温泉の質問を対象から外しています。</li>
      </ul>
    </div></section>

    <section class="ai-section ai-section--plain" id="request" aria-labelledby="request-title"><div class="container">
      <div class="ai-cta">
        <div><h2 class="ai-h2" id="request-title">自館の結果を知りたい方へ</h2><p>この集計に含まれる宿には、その宿の結果だけをお渡しできます。どの質問に答えられなかったか、何を1行足せばよいかがわかります。<a href="/ai-inn-diagnosis/sample/">サンプルレポート</a>もご覧ください。診断の受付は準備中です。</p></div>
        <span class="button ai-cta__pending">診断について問い合わせる（準備中）</span>
      </div>
    </div></section>

    {{% include tool-sources.html %}}
    {{% include tool-related.html %}}
  </main>
  {{% include site-footer.html %}}
<script defer src="/js/site.js?v=20261002-shell"></script>
</body>
</html>
'''


def main() -> None:
    summary = json.loads(DATA.read_text(encoding="utf-8"))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(render(summary))
    print(f"wrote {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
