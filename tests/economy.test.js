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

// ---------------------------------------------------------------------------
// Trade quotes — the pre-trade preview. Each figure must match the contract's
// own rule, computed from the same state the contract reads.
// ---------------------------------------------------------------------------
import { quote, receipt, tradeHeadroom } from "../web/economy.js";

// A snapshot shaped exactly like /api/state (real live values for day 51).
const LIVE = {
  player: { cash: 5569, inventory: { grain: 5, iron: 109 }, deposited_yocto: 5e24 },
  merchants: [
    {
      id: "smith", name: "Smith", specialty: "iron", fixed_cost: 25, state: "open", cash: 744,
      inventory: { iron: 9 }, cost_basis: { iron: 153 },
      list_price: { grain: 19, iron: 21, cloth: 53, ale: 24 },
      bid_price: { grain: 11, iron: 15, cloth: 31, ale: 14 },
    },
    {
      id: "brewer", name: "Brewer", specialty: "ale", fixed_cost: 25, state: "open", cash: 816,
      inventory: { ale: 11 }, cost_basis: { ale: 132 },
      list_price: { grain: 19, iron: 34, cloth: 53, ale: 15 },
      bid_price: { grain: 11, iron: 20, cloth: 31, ale: 11 },
    },
    {
      id: "dead", name: "Dead", specialty: "iron", fixed_cost: 25, state: "closed", cash: 12,
      inventory: {}, cost_basis: {}, list_price: {}, bid_price: {},
    },
  ],
};

test("tradeHeadroom mirrors the contract's reserve and room rules", () => {
  const h = tradeHeadroom(LIVE.merchants[0]); // smith: cash 744, iron bid 15
  assert.equal(h.reserve, 50);          // 2 * fixed_cost
  assert.equal(h.spendable, 694);       // cash - reserve
  assert.equal(h.buyBid("iron").affordable, 46); // floor(694 / 15)
  // room = STOCK_MAX - inv = 400 - 9 = 391 (how many more the shop can take)
  assert.equal(h.sellUnits("iron"), 391);
});

test("quote for a buy matches price × units and flags affordability", () => {
  const q = quote(LIVE, "buy", { merchant: "smith", good: "iron", units: 3 });
  assert.equal(q.ok, true);
  assert.equal(q.price, 21);
  assert.equal(q.available, 9);
  assert.equal(q.willBuy, 3);
  assert.equal(q.cost, 63);
  assert.equal(q.cashAfter, 5569 - 63);
  assert.equal(q.inventoryAfter, 109 + 3);
  assert.equal(q.limitedBy, null);
});

test("quote for a buy is limited by stock, never exceeding what the shop holds", () => {
  const q = quote(LIVE, "buy", { merchant: "smith", good: "iron", units: 50 });
  assert.equal(q.executable, 9);   // only 9 in stock
  assert.equal(q.willBuy, 9);
  assert.equal(q.limitedBy, "stock");
  assert.equal(q.cost, 9 * 21);
});

test("quote for a buy is limited by credits when the purse is short", () => {
  const poor = { player: { cash: 40, inventory: {} }, merchants: LIVE.merchants };
  const q = quote(poor, "buy", { merchant: "smith", good: "iron", units: 5 });
  assert.equal(q.price, 21);
  assert.equal(q.willBuy, 1);       // floor(40 / 21) = 1
  assert.equal(q.limitedBy, "credits");
});

test("quote for a sell applies the contract's three limits", () => {
  const q = quote(LIVE, "sell", { merchant: "smith", good: "iron", units: 100 });
  assert.equal(q.bid, 15);
  assert.equal(q.have, 109);
  assert.equal(q.room, 391);        // shop stock room (STOCK_MAX - inv)
  assert.equal(q.affordable, 46);   // shop spendable 694 / 15
  assert.equal(q.willSell, 46);     // min(100, 109, 391, 46)
  assert.equal(q.proceeds, 690);
  assert.equal(q.limitedBy, "shop cash");
});

test("quote for a sell is limited by the shop's spendable cash", () => {
  const thin = { player: { cash: 0, inventory: { iron: 100 } },
    merchants: [{ ...LIVE.merchants[0], cash: 80 }] }; // spendable 30, bid 15 -> 2
  const q = quote(thin, "sell", { merchant: "smith", good: "iron", units: 50 });
  assert.equal(q.affordable, 2);
  assert.equal(q.willSell, 2);
  assert.equal(q.limitedBy, "shop cash");
});

test("quote refuses a closed shop for trading and an open shop for investment", () => {
  assert.match(quote(LIVE, "buy", { merchant: "dead", good: "iron", units: 1 }).error, /closed/);
  assert.match(quote(LIVE, "invest", { merchant: "smith", amount: 200 }).error, /open/);
});

test("quote for an investment reports the real revival threshold", () => {
  const q = quote(LIVE, "invest", { merchant: "dead", amount: 200 });
  assert.equal(q.ok, true);
  assert.equal(q.threshold, 50);
  assert.equal(q.shopCash, 12);
  assert.equal(q.funded, 212);
  assert.equal(q.reopens, true);
  assert.equal(q.shortfall, 0);

  const small = quote(LIVE, "invest", { merchant: "dead", amount: 10 });
  assert.equal(small.funded, 22);
  assert.equal(small.reopens, false);
  assert.equal(small.shortfall, 28);
});

test("quote for gather is free and adds to cargo", () => {
  const q = quote(LIVE, "gather", { good: "iron", units: 5 });
  assert.equal(q.ok, true);
  assert.equal(q.free, true);
  assert.equal(q.units, 5);
});

test("receipt reports only the changes the chain actually recorded", () => {
  const before = { player: { cash: 5569, inventory: { iron: 109 } },
    merchants: [{ id: "smith", name: "Smith", state: "open", cash: 744, specialty: "iron", inventory: { iron: 9 } }] };
  const after = { player: { cash: 5694, inventory: { iron: 100 } },
    merchants: [{ id: "smith", name: "Smith", state: "open", cash: 619, specialty: "iron", inventory: { iron: 18 } }] };
  const event = { kind: "PLAYER_SELL", merchant: "smith", value: 135 };
  const r = receipt(before, after, event);
  const byLabel = Object.fromEntries(r.changes.map((c) => [c.label, c]));
  assert.equal(byLabel.credits.delta, 125);
  assert.equal(byLabel.iron.delta, -9);
  assert.equal(r.event, event);
  assert.equal(r.merchant.id, "smith");
  assert.equal(r.merchant.cashFrom, 744);
  assert.equal(r.merchant.cashTo, 619);
  assert.equal(r.merchant.changed, true);
});

test("receipt reports a merchant state change (closure/revival)", () => {
  const before = { player: { cash: 5569, inventory: {} },
    merchants: [{ id: "smith", name: "Smith", state: "closed", cash: 12, specialty: "iron", inventory: {} }] };
  const after = { player: { cash: 5369, inventory: {} },
    merchants: [{ id: "smith", name: "Smith", state: "open", cash: 212, specialty: "iron", inventory: {} }] };
  const r = receipt(before, after, { kind: "REOPENED", merchant: "smith", value: 212 });
  assert.equal(r.merchant.stateFrom, "closed");
  assert.equal(r.merchant.stateTo, "open");
  assert.equal(r.merchant.changed, true);
});

test("receipt tolerates a null event and missing state without throwing", () => {
  assert.doesNotThrow(() => receipt(null, null, null));
  const r = receipt({ player: { cash: 1 } }, { player: { cash: 1 } }, null);
  assert.deepEqual(r.changes, []);
  assert.equal(r.event, null);
});
