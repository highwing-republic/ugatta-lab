const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "../js/suiren-demo-data.js"), "utf8");

// 指定日の「今日」と、保存済みの状態を持たせてデモデータを読み込む
function demoOn(day, stored) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [`${day}T09:00:00`])); }
  }
  const store = new Map(stored ? [["mini-pms-v3", JSON.stringify(stored)]] : []);
  const window = {};
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null) };
  vm.runInNewContext(SOURCE, { window, localStorage, Date: FakeDate, JSON });
  return window.SuirenDemo;
}

test("サンプルは開いた日を基準に作られる", () => {
  const s = demoOn("2026-10-16").load();
  assert.equal(s.seedDate, "2026-10-16");
  assert.equal(s.reservations.find((r) => r.id === 3).inDate, "2026-10-16");
  assert.equal(s.blocks[0].fromDate, "2026-10-16");
});

test("同じ日のうちは保存した状態をそのまま使う", () => {
  const first = demoOn("2026-10-16").load();
  first.reservations.find((r) => r.id === 4).room = "502";
  assert.equal(demoOn("2026-10-16", first).load().reservations.find((r) => r.id === 4).room, "502");
});

test("日付が変わるとサンプルだけ作り直し、利用者の予約は残す", () => {
  const old = demoOn("2026-10-01").load();
  old.reservations.push({ id: 9, name: "Web様", pax: 1, inDate: "2026-10-20", outDate: "2026-10-21",
    typePref: "ツイン", memo: "", room: null, status: "booked", bookingNo: "WABCDE", source: "web" });
  old.nextId = 10;
  const s = demoOn("2026-10-16", old).load();
  assert.equal(s.seedDate, "2026-10-16");
  assert.equal(s.reservations.find((r) => r.id === 3).inDate, "2026-10-16");
  assert.equal(s.reservations.find((r) => r.id === 9).inDate, "2026-10-20");
  assert.equal(s.nextId, 10);
  assert.equal(s.reservations.length, 9);
});

test("日付のない古い保存データも作り直す", () => {
  const old = demoOn("2026-10-01").load();
  delete old.seedDate;
  assert.equal(demoOn("2026-10-16", old).load().reservations.find((r) => r.id === 1).room, "303");
});

test("利用者の予約と部屋がぶつかるサンプルは、同じタイプの空き部屋へ移る", () => {
  const old = demoOn("2026-10-01").load();
  old.reservations.push({ id: 9, name: "長期様", pax: 1, inDate: "2026-10-10", outDate: "2026-11-30",
    typePref: "シングル", memo: "", room: "303", status: "in" });
  old.blocks.push({ id: 2, room: "405", fromDate: "2026-10-15", toDate: "2026-10-18", reason: "点検" });
  const s = demoOn("2026-10-16", old).load();
  const sato = s.reservations.find((r) => r.id === 1);
  assert.notEqual(sato.room, "303");
  assert.equal(s.blocks.map((b) => b.id).join(","), "2");
  const busy = (room) => s.reservations.filter((r) => r.room === room && r.status !== "cancelled"
    && r.inDate < sato.outDate && sato.inDate < r.outDate);
  assert.equal(busy(sato.room).length, 1);
});

test("精算の明細：宿泊料金は1名あたり×人数×泊数、朝食・追加料金・入湯税を足す", () => {
  const demo = demoOn("2026-10-16");
  const takahashi = demo.load().reservations.find((r) => r.id === 2);
  const f = demo.folio(takahashi);
  // ツイン2名利用 12,000×2名×2泊、朝食 1,500×2名×2泊、夕食 7,700×2名、入湯税 150×2名×2泊
  assert.equal(f.lines.map((l) => l.amount).join(","), "48000,6000,15400,600");
  assert.equal(f.total, 70000);
  assert.equal(f.taxableTotal, 69400);
  assert.equal(f.consumptionTax, 6309);
  const room = f.lines[0];
  assert.equal(room.unit, 12000);
  assert.equal(room.qtyLabel, "2名×2泊");
  assert.equal(room.label, "宿泊料金（ツイン・2名1室利用）");
});

test("料金表：1名あたりの料金は1室の人数で変わり、人数は定員までに丸める", () => {
  const demo = demoOn("2026-10-16");
  const cap = (type) => demo.TYPES.find((t) => t.type === type).cap;
  assert.deepEqual([1, 2, 3, 4].map((n) => demo.personRate("和室", n)), [24000, 15000, 12000, 10000]);
  assert.deepEqual([1, 2].map((n) => demo.personRate("ツイン", n)), [18000, 12000]);
  assert.equal(demo.personRate("シングル", 1), 12000);
  assert.equal(cap("和室"), 4);
  assert.equal(demo.nightRate("和室", 3), 36000);
  assert.equal(demo.nightRate("和室", 4), 40000);
  assert.equal(demo.nightRate("ツイン", 4), 24000);
  assert.equal(demo.personRate("ツイン", 0), 18000);
});

test("精算の明細：公式サイト予約は予約時に示した宿泊料金を使う（料金表を変えた後も変わらない）", () => {
  const demo = demoOn("2026-10-16");
  const web = { pax: 1, inDate: "2026-10-16", outDate: "2026-10-17", room: "502", plan: "room", roomTotal: 12000 };
  assert.equal(demo.folio(web).total, 12000 + 150);
  assert.equal(demo.folio({ ...web, pax: 2, roomTotal: 16000 }).lines[0].unit, 8000);
});
