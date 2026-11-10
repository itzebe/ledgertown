// Unit tests for the pure game logic. No network, no chain.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  netWorth,
  cargoValue,
  tradeSignal,
  tradeSignals,
  challenges,
  purseSummary,
} from "../web/game.js";

const shop = (id, over = {}) => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  state: "open",
  cash: 800,
  fixed_cost: 120,
  specialty: "iron",
  list_price: { iron: 30 },
  bid_price: { iron: 12 },
  inventory: { iron: 10 },
  ...over,
});

test("cargo and net worth use fixed reference prices, not live quotes", () => {
  const p = { cash: 100, inventory: { grain: 5, iron: 2 } };
  // grain ref 12, iron ref 21 -> 5*12 + 2*21 = 102
  assert.equal(cargoValue(p), 102);
  assert.equal(netWorth(p), 202);
  assert.deepEqual(purseSummary(p), { net: 202, cash: 100, cargo: 102, hasPurse: true });
});

test("an empty purse has zero net worth and reports hasPurse false", () => {
  assert.equal(netWorth(null), 0);
  assert.deepEqual(purseSummary(null), { net: 0, cash: 0, cargo: 0, hasPurse: false });
});

test("trade signal finds the cheapest seller and the highest bidder", () => {
  const merchants = [
    shop("brewer", { list_price: { iron: 30 }, bid_price: { iron: 12 } }),
    shop("smith", { list_price: { iron: 24 }, bid_price: { iron: 18 } }),
    shop("weaver", { state: "closed", list_price: { iron: 1 }, bid_price: { iron: 99 } }),
  ];
  const s = tradeSignal(merchants, "iron");
  assert.equal(s.buy.id, "smith", "closed shops are ignored");
  assert.equal(s.buy.price, 24);
  assert.equal(s.sell.id, "smith");
  assert.equal(s.sell.price, 18);
  assert.equal(s.spread, -6);
  assert.equal(s.arbitrage, false, "a negative spread is not an arbitrage");
});

test("trade signal flags a real arbitrage when a bid exceeds another's list", () => {
  const merchants = [
    shop("brewer", { list_price: { iron: 20 }, bid_price: { iron: 10 } }),
    shop("smith", { list_price: { iron: 40 }, bid_price: { iron: 35 } }),
  ];
  const s = tradeSignal(merchants, "iron");
  assert.equal(s.buy.price, 20);
  assert.equal(s.sell.price, 35);
  assert.equal(s.spread, 15);
  assert.equal(s.arbitrage, true);
});

test("trade signals are sorted best spread first", () => {
  const merchants = [
    shop("a", { list_price: { iron: 10, grain: 30, cloth: 50, ale: 40 }, bid_price: { iron: 12, grain: 31, cloth: 10, ale: 10 } }),
  ];
  const sig = tradeSignals(merchants);
  for (let i = 1; i < sig.length; i++) {
    assert.ok((sig[i - 1].spread ?? -Infinity) >= (sig[i].spread ?? -Infinity), "descending spread");
  }
});

test("challenges propose an arbitrage when one exists", () => {
  const state = {
    merchants: [
      shop("brewer", { list_price: { iron: 20 }, bid_price: { iron: 10 } }),
      shop("smith", { list_price: { iron: 40 }, bid_price: { iron: 35 } }),
    ],
  };
  const c = challenges(state, { cash: 500, inventory: {} });
  const arb = c.find((x) => x.id === "arbitrage");
  assert.ok(arb, "an arbitrage challenge is offered");
  assert.equal(arb.good, "iron");
  assert.equal(arb.from, "brewer");
  assert.equal(arb.to, "smith");
  assert.match(arb.detail, /15\/unit/);
});

test("challenges propose reviving a closed shop with the exact shortfall", () => {
  const state = {
    merchants: [
      shop("smith", { state: "closed", cash: 100, fixed_cost: 120, list_price: {}, bid_price: {} }),
    ],
  };
  const c = challenges(state, { cash: 500, inventory: {} });
  const r = c.find((x) => x.id === "rescue");
  assert.ok(r);
  assert.equal(r.merchant, "smith");
  assert.equal(r.need, 140, "reserve is 2x fixed cost = 240, minus cash 100");
});

test("challenges propose supplying a shop that is below its reserve", () => {
  const state = {
    merchants: [shop("smith", { cash: 100, fixed_cost: 120, list_price: {}, bid_price: {} })],
  };
  const c = challenges(state, { cash: 500, inventory: {} });
  const s = c.find((x) => x.id === "supply");
  assert.ok(s);
  assert.equal(s.merchant, "smith");
  assert.equal(s.good, "iron");
});

test("challenges never exceed three and always start a broke player with gathering", () => {
  const state = {
    merchants: [
      shop("brewer", { list_price: { iron: 20 }, bid_price: { iron: 10 } }),
      shop("smith", { list_price: { iron: 40 }, bid_price: { iron: 35 } }),
      shop("miller", { state: "closed", cash: 0, fixed_cost: 120, list_price: {}, bid_price: {} }),
    ],
  };
  const c = challenges(state, { cash: 0, inventory: {} });
  assert.ok(c.length <= 3);
  assert.ok(c.some((x) => x.id === "gather"), "a broke player is told gathering is free");
});
