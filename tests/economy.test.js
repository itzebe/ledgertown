// Unit tests for the pure economic derivations the interface reads.
// No network, no chain. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GOODS,
  GOOD_NAMES,
  STOCK_MAX,
  stockTarget,
  merchantRead,
  priceBoard,
  scarcity,
  townSummary,
  riskNote,
  marketRead,
} from "../web/economy.js";

test("goods table mirrors the contract constants", () => {
  // [name, ref, cost, dbase] — must match contract/src/lib.rs GOODS.
  assert.deepEqual(GOOD_NAMES, ["grain", "iron", "cloth", "ale"]);
  assert.deepEqual(
    GOODS.map((g) => [g.good, g.ref, g.cost, g.dbase]),
    [["grain", 12, 10, 16], ["iron", 21, 17, 9], ["cloth", 33, 27, 6], ["ale", 15, 12, 11]]
  );
  assert.equal(STOCK_MAX, 400);
});

test("stock target is twice base demand", () => {
  assert.equal(stockTarget("grain"), 32);
  assert.equal(stockTarget("iron"), 18);
  assert.equal(stockTarget("cloth"), 12);
  assert.equal(stockTarget("ale"), 22);
  assert.equal(stockTarget("gold"), 0);
});

test("merchantRead derives cost, margin and health from real fields only", () => {
  const m = {
    id: "brewer", name: "Brewer", specialty: "ale", fixed_cost: 25, state: "open",
    cash: 816, inventory: { ale: 11 }, cost_basis: { ale: 132 },
    list_price: { ale: 15 }, bid_price: { ale: 11 },
  };
  const r = merchantRead(m);
  assert.equal(r.reserve, 50);
  assert.equal(r.target, 22);
  assert.equal(r.avgCost, 12); // 132 / 11
  assert.equal(r.margin, 3);   // 15 - 12
  assert.equal(r.marginPct, 25);
  assert.equal(r.health, "healthy"); // 816 >= 50
});

test("merchantRead health tracks the contract's closure conditions", () => {
  const base = { id: "x", specialty: "iron", fixed_cost: 25, state: "open", inventory: {}, cost_basis: {}, list_price: {}, bid_price: {} };
  assert.equal(merchantRead({ ...base, cash: 100 }).health, "healthy");
  assert.equal(merchantRead({ ...base, cash: 40 }).health, "thin");       // < 2x fixed
  assert.equal(merchantRead({ ...base, cash: 10 }).health, "distressed"); // < fixed
  assert.equal(merchantRead({ ...base, cash: -1 }).health, "insolvent");
  assert.equal(merchantRead({ ...base, cash: 0, state: "closed" }).health, "closed");
});

test("merchantRead falls back to the reference price when stock is zero", () => {
  const r = merchantRead({ id: "m", specialty: "cloth", fixed_cost: 25, state: "open", cash: 100, inventory: {}, cost_basis: {}, list_price: {}, bid_price: {} });
  assert.equal(r.avgCost, 33); // cloth reference price
  assert.equal(r.stockRatio, 0);
});

test("priceBoard orders quotes cheapest-first and flags leader + dearest", () => {
  const merchants = [
    { id: "a", name: "A", state: "open", list_price: { iron: 30 }, bid_price: { iron: 20 } },
    { id: "b", name: "B", state: "open", list_price: { iron: 21 }, bid_price: { iron: 15 } },
    { id: "c", name: "C", state: "closed", list_price: { iron: 5 }, bid_price: { iron: 1 } },
  ];
  const board = priceBoard(merchants);
  assert.deepEqual(board.iron.map((q) => q.id), ["b", "a"]); // closed shop excluded
  assert.equal(board.iron[0].cheapest, true);
  assert.equal(board.iron[1].dearest, true);
  assert.equal(board.iron[0].bid, 15);
});

test("scarcity reports days of cover and a verdict from summed stock", () => {
  const merchants = [
    { id: "a", state: "open", inventory: { iron: 4 } },
    { id: "b", state: "open", inventory: { iron: 5 } },
    { id: "c", state: "closed", inventory: { iron: 100 } }, // closed excluded
  ];
  const s = scarcity(merchants);
  assert.equal(s.iron.stock, 9);   // 4 + 5
  assert.equal(s.iron.shops, 2);
  assert.equal(s.iron.daysOfCover, 1); // 9 / 9 base demand
  assert.equal(s.iron.verdict, "tight");
  assert.equal(s.cloth.stock, 0);
  assert.equal(s.cloth.verdict, "none");
});

test("townSummary counts open/closed and totals cash", () => {
  const s = townSummary({
    merchants: [
      { id: "a", state: "open", cash: 100 },
      { id: "b", state: "closed", cash: 5 },
    ],
  });
  assert.deepEqual(s, { open: 1, closed: 1, total: 2, cash: 105 });
});

test("riskNote states the real mechanic for each state", () => {
  const r = merchantRead({ id: "m", specialty: "iron", fixed_cost: 25, state: "open", cash: 100, inventory: { iron: 9 }, cost_basis: { iron: 153 }, list_price: { iron: 21 }, bid_price: { iron: 15 } });
  assert.equal(riskNote({ id: "m", state: "open", cash: 100, fixed_cost: 25 }, r).level, "ok");

  const thin = merchantRead({ id: "m", specialty: "iron", fixed_cost: 25, state: "open", cash: 40, inventory: {}, cost_basis: {}, list_price: {}, bid_price: {} });
  assert.equal(riskNote({ id: "m", state: "open", cash: 40, fixed_cost: 25 }, thin).level, "warn");

  const distressed = merchantRead({ id: "m", specialty: "iron", fixed_cost: 25, state: "open", cash: 10, inventory: {}, cost_basis: {}, list_price: {}, bid_price: {} });
  const note = riskNote({ id: "m", state: "open", cash: 10, fixed_cost: 25, bankrupt_days: 1 }, distressed);
  assert.equal(note.level, "critical");
  assert.match(note.text, /2 more days/);

  const closed = merchantRead({ id: "m", specialty: "iron", fixed_cost: 25, state: "closed", cash: 12, inventory: {}, cost_basis: {}, list_price: {}, bid_price: {} });
  const cn = riskNote({ id: "m", state: "closed", cash: 12, fixed_cost: 25, closed_on: 22 }, closed);
  assert.equal(cn.level, "closed");
  assert.match(cn.text, /day 22/);
  assert.match(cn.text, /38 more credits/);
});

test("marketRead assembles summary, board, scarcity, reads and risk", () => {
  const state = {
    merchants: [
      { id: "smith", name: "Smith", specialty: "iron", fixed_cost: 25, state: "open", cash: 100, inventory: { iron: 9 }, cost_basis: { iron: 153 }, list_price: { iron: 21 }, bid_price: { iron: 15 } },
    ],
  };
  const read = marketRead(state);
  assert.equal(read.summary.total, 1);
  assert.ok(read.board.iron.length === 1);
  assert.ok(read.merchants.smith);
  assert.ok(read.risk.smith);
});

test("marketRead tolerates empty or malformed state without throwing", () => {
  assert.doesNotThrow(() => marketRead({}));
  assert.doesNotThrow(() => marketRead({ merchants: [] }));
  const read = marketRead({ merchants: [{}] });
  assert.equal(read.summary.total, 1);
});
