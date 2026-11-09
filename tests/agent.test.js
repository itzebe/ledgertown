// Unit tests for the pure merchant decision function. No network, no chain.
// Run: npm run test:agent
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideForMe } from "../driver/agent.js";

const GOODS = {
  grain: { cost: 10 },
  iron: { cost: 17 },
  cloth: { cost: 27 },
  ale: { cost: 12 },
};

function me(over = {}) {
  return {
    id: "smith",
    specialty: "iron",
    fixed_cost: 25,
    cash: 600,
    markup_bp: 2200,
    inventory: { iron: 9 }, // base demand 9 -> target 18
    list_price: { iron: 21 },
    ...over,
  };
}
const rival = (over = {}) => ({
  id: "weaver",
  state: "open",
  list_price: { iron: 15 },
  ...over,
});

test("restocks when below target and cash allows", () => {
  const d = decideForMe(me(), [rival()], GOODS);
  assert.equal(d.kind, "restock_extra");
  assert.ok(d.arg > 0 && d.arg <= 18 - 9, `arg ${d.arg} out of range`);
});

test("holds when cash is below the reserve", () => {
  const d = decideForMe(me({ cash: 30 }), [rival()], GOODS);
  assert.equal(d.kind, "hold");
});

test("holds when stock is short but nothing is affordable", () => {
  // reserve = 50; cash 60 leaves 10 -> floor(10/17) = 0 units affordable.
  const d = decideForMe(me({ cash: 60 }), [rival()], GOODS);
  assert.equal(d.kind, "hold");
});

test("undercuts a cheaper rival when fully stocked", () => {
  const d = decideForMe(me({ inventory: { iron: 18 } }), [rival()], GOODS);
  assert.equal(d.kind, "set_markup");
  assert.equal(d.arg, 2000); // 2200 - 200 step
});

test("relaxes markup toward target when already cheapest", () => {
  const d = decideForMe(
    me({ inventory: { iron: 18 }, markup_bp: 3000 }),
    [rival({ list_price: { iron: 99 } })],
    GOODS
  );
  assert.equal(d.kind, "set_markup");
  assert.equal(d.arg, 2200);
});

test("clamps an undercut to the markup floor, never below", () => {
  const d = decideForMe(
    me({ inventory: { iron: 18 }, markup_bp: 500 }),
    [rival()],
    GOODS
  );
  assert.equal(d.kind, "set_markup");
  assert.equal(d.arg, 500); // clamped at MIN_MARKUP_BP
});

test("is deterministic: identical input yields identical output", () => {
  const a = decideForMe(me(), [rival()], GOODS);
  const b = decideForMe(me(), [rival()], GOODS);
  assert.deepEqual(a, b);
});

test("ignores closed rivals when judging competitiveness", () => {
  const closed = rival({ state: "closed" });
  const d = decideForMe(
    me({ inventory: { iron: 18 }, markup_bp: 3000 }),
    [closed],
    GOODS
  );
  // no open rival to undercut -> relax toward target
  assert.equal(d.arg, 2200);
});
