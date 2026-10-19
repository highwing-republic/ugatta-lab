/* ホテル翠蓮デモの共有データ（簡易PMSデモ /demo/mini-pms/ と予約エンジンデモ /demo/booking/ で共用）。
   部屋マスタ・料金表・精算の計算・サンプル予約・保存の読み込みをここにまとめる。
   ブラウザの localStorage に1つの状態として保存し、両ページで同じ予約・ブロックを読み書きする。

   サンプルの予約とブロックは「開いた日」を基準に作る。日付が変わってから開くと、サンプルだけを
   その日の基準で作り直し、利用者が登録した予約・ブロックはそのまま残す（サンプルが過去に流れて
   空っぽになるのを防ぐ）。サンプルは予約 id 1〜8・ブロック id 1、利用者の分は 9・2 以降。 */
(function(){
  "use strict";
  const KEY = "mini-pms-v3";
  const SAMPLE_MAX_RES_ID = 8, SAMPLE_MAX_BLOCK_ID = 1;

  const pad = n => String(n).padStart(2,"0");
  const iso = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
  const addDays = (s,n) => { const d = new Date(s+"T00:00:00"); d.setDate(d.getDate()+n); return iso(d); };
  const today = () => { const d = new Date(); d.setHours(0,0,0,0); return iso(d); };

  /* 部屋マスタ（架空ホテル：2〜5階、各階5室） */
  const ROOMS = [];
  const addRooms = (floor, nos, type, cap) => nos.forEach(no => ROOMS.push({no, floor, type, cap}));
  ["5","4","3","2"].forEach(f => {
    addRooms(f+"階", [f+"01",f+"02"], "ツイン", 2);
    addRooms(f+"階", [f+"03",f+"04"], "シングル", 1);
    addRooms(f+"階", [f+"05"], "和室", 4);
  });

  /* 料金（1名1泊・素泊まり・税とサービス料込み）。1室に泊まる人数で1人あたりの料金が変わる
     （例：ツインを2名で使うと1名12,000円、1名で使うと18,000円）。公式サイト（scripts/build_demo_hotel.py）と同じ値 */
  const TYPES = [
    {type:"シングル", cap:1, perPerson:{1:12000}},
    {type:"ツイン",   cap:2, perPerson:{1:18000, 2:12000}},
    {type:"和室",     cap:4, perPerson:{1:24000, 2:15000, 3:12000, 4:10000}}
  ];
  const BREAKFAST = 1500; // 朝食 1名1泊（税込）
  const BATH_TAX = 150;   // 入湯税 1名1泊（消費税の対象外）
  /* 精算で足せる追加料金（公式サイトの案内と同じ値・税込）。price が null のものは金額を入力する */
  const EXTRAS = [
    {key:"dinner", label:"夕食（季節の会席）", price:7700, unit:"名"},
    {key:"bath",   label:"貸切風呂「蓮」",     price:2200, unit:"回"},
    {key:"kidsbf", label:"お子さま朝食",       price:800,  unit:"名"},
    {key:"shop",   label:"売店・お飲み物",     price:null, unit:"点"}
  ];
  const nightsOf = r => Math.round((new Date(r.outDate+"T00:00:00") - new Date(r.inDate+"T00:00:00"))/86400000);
  /* 1名1泊の料金。人数は1〜定員に丸める */
  function personRate(type, pax){
    const tp = TYPES.find(x => x.type === type);
    if(!tp) return 0;
    return tp.perPerson[Math.min(Math.max(pax, 1), tp.cap)] || 0;
  }
  /* 1室1泊の合計（1名あたり × 人数） */
  function nightRate(type, pax){
    const tp = TYPES.find(x => x.type === type);
    if(!tp) return 0;
    const n = Math.min(Math.max(pax, 1), tp.cap);
    return personRate(type, n) * n;
  }
  /* 精算の明細。公式サイト予約は予約時に示した宿泊料金（roomTotal）をそのまま使う */
  function folio(r){
    const n = nightsOf(r);
    const room = r.room ? ROOMS.find(x => x.no === r.room) : null;
    const type = room ? room.type : (r.typePref || "");
    const lines = [];
    const roomTotal = typeof r.roomTotal === "number" ? r.roomTotal : nightRate(type, r.pax) * n;
    const unit = r.pax * n ? Math.round(roomTotal / (r.pax * n)) : personRate(type, r.pax);
    lines.push({kind:"room", label:"宿泊料金（" + (type || "部屋未定") + "・" + r.pax + "名1室利用）", unit, qty:r.pax * n, qtyLabel:r.pax + "名×" + n + "泊", amount:roomTotal, taxable:true});
    if(r.plan === "bf") lines.push({kind:"bf", label:"朝食", unit:BREAKFAST, qty:r.pax * n, qtyLabel:r.pax + "名×" + n + "泊", amount:BREAKFAST * r.pax * n, taxable:true});
    (r.extras || []).forEach(x => lines.push({kind:"extra", id:x.id, label:x.label, unit:x.price, qty:x.qty, qtyLabel:x.qty + (x.unit || ""), amount:x.price * x.qty, taxable:true}));
    lines.push({kind:"bathtax", label:"入湯税", unit:BATH_TAX, qty:r.pax * n, qtyLabel:r.pax + "名×" + n + "泊", amount:BATH_TAX * r.pax * n, taxable:false});
    const total = lines.reduce((s, l) => s + l.amount, 0);
    const taxableTotal = lines.filter(l => l.taxable).reduce((s, l) => s + l.amount, 0);
    return { lines, total, taxableTotal, consumptionTax: Math.floor(taxableTotal * 10 / 110), nights:n, type };
  }

  function seed(){
    const T0 = today();
    return { seedDate: T0, nextId: 9, nextBlockId: 2,
      reservations: [
        { id:1, name:"田中物産 佐藤様", pax:1, inDate:addDays(T0,-3), outDate:addDays(T0,25), typePref:"シングル", memo:"長期法人。請求書は月末まとめ（サンプル）", room:"303", status:"in" },
        { id:2, name:"高橋様", pax:2, inDate:addDays(T0,-2), outDate:T0, typePref:"ツイン", memo:"本日出発。朝食付き・夕食会席を追加（サンプル）", room:"501", status:"in",
          plan:"bf", extras:[{ id:1, label:"夕食（季節の会席）", price:7700, unit:"名", qty:2 }] },
        { id:3, name:"Smith様", pax:1, inDate:T0, outDate:addDays(T0,1), typePref:"シングル", memo:"英語対応（サンプル）", room:"204", status:"booked" },
        { id:4, name:"山田様", pax:2, inDate:T0, outDate:addDays(T0,2), typePref:"ツイン", memo:"記念日。眺望良い部屋希望（サンプル）", room:null, status:"booked" },
        { id:5, name:"鈴木様ご家族", pax:4, inDate:addDays(T0,1), outDate:addDays(T0,3), typePref:"和室", memo:"お子様2名添い寝（サンプル）", room:null, status:"booked" },
        { id:6, name:"南海電装 中村様", pax:1, inDate:addDays(T0,2), outDate:addDays(T0,12), typePref:"", memo:"工事関係・長期（サンプル）", room:null, status:"booked" },
        { id:7, name:"伊藤様", pax:1, inDate:addDays(T0,3), outDate:addDays(T0,4), typePref:"", memo:"（サンプル）", room:null, status:"booked" },
        { id:8, name:"渡辺様", pax:2, inDate:addDays(T0,1), outDate:addDays(T0,2), typePref:"ツイン", memo:"電話にて取消連絡あり（サンプル）", room:null, status:"cancelled" }
      ],
      blocks: [
        { id:1, room:"405", fromDate:T0, toDate:addDays(T0,5), reason:"空調故障" }
      ]};
  }

  const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
  function roomBusy(reservations, blocks, roomNo, inD, outD){
    return reservations.some(r => r.status !== "cancelled" && r.room === roomNo && overlaps(inD, outD, r.inDate, r.outDate))
        || blocks.some(b => b.room === roomNo && overlaps(inD, outD, b.fromDate, b.toDate));
  }

  /* 日付が変わった状態：サンプルだけ今日の基準で作り直す */
  function refreshSamples(old){
    const fresh = seed();
    const ownRes = old.reservations.filter(r => !(r.id <= SAMPLE_MAX_RES_ID));
    const ownBlocks = old.blocks.filter(b => !(b.id <= SAMPLE_MAX_BLOCK_ID));
    // 利用者の予約やブロックがある部屋には、サンプルのブロックを置かない
    const blocks = fresh.blocks.filter(b => !roomBusy(ownRes, ownBlocks, b.room, b.fromDate, b.toDate)).concat(ownBlocks);
    // サンプルの割当済み部屋が利用者の予約とぶつかるときは、同じタイプの空き部屋へ移す
    const placed = ownRes.slice();
    fresh.reservations.forEach(r => {
      if(r.room && roomBusy(placed, blocks, r.room, r.inDate, r.outDate)){
        const alt = ROOMS.find(rm => rm.type === r.typePref && rm.cap >= r.pax && !roomBusy(placed, blocks, rm.no, r.inDate, r.outDate));
        r.room = alt ? alt.no : null;
        if(!r.room && r.status === "in") r.status = "booked";
      }
      placed.push(r);
    });
    return { seedDate: fresh.seedDate,
      nextId: Math.max(old.nextId || 0, fresh.nextId), nextBlockId: Math.max(old.nextBlockId || 0, fresh.nextBlockId),
      reservations: fresh.reservations.concat(ownRes), blocks };
  }

  function load(){
    let s = null;
    try{
      const raw = localStorage.getItem(KEY);
      if(raw){ const v = JSON.parse(raw); if(v && Array.isArray(v.reservations) && Array.isArray(v.blocks)) s = v; }
    }catch(e){}
    if(!s) return seed();
    return s.seedDate === today() ? s : refreshSamples(s);
  }

  window.SuirenDemo = { KEY, ROOMS, TYPES, BREAKFAST, BATH_TAX, EXTRAS, personRate, nightRate, folio, seed, load };
})();
