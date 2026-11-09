// Unit tests for the pure public-server guards. No network, no chain.
// Run: npm run test:agent
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateAction,
  validateAdvance,
  explainDecision,
  RateLimiter,
  SingleFlight,
  originAllowed,
  parseAllowlist,
  toInt,
  PUBLIC_ACTIONS,
} from "../web/guard.js";

test("deposit and owner methods are never public actions", () => {
  for (const a of ["deposit", "reset", "add_shock", "owner_withdraw", "set_lifeline_enabled", "seed_merchant"]) {
    const v = validateAction(a, {});
    assert.equal(v.ok, false, `${a} must be rejected`);
  }
  assert.deepEqual(PUBLIC_ACTIONS, ["tick", "gather", "buy", "sell", "invest"]);
});

test("gather validates good and units bounds", () => {
  assert.equal(validateAction("gather", { good: "iron", units: 5 }).ok, true);
  assert.equal(validateAction("gather", { good: "gold", units: 5 }).ok, false);
  assert.equal(validateAction("gather", { good: "iron", units: 0 }).ok, false);
  assert.equal(validateAction("gather", { good: "iron", units: 51 }).ok, false);
  assert.equal(validateAction("gather", { good: "iron", units: -1 }).ok, false);
});

test("buy/sell require a safe merchant id and integer units", () => {
  assert.equal(validateAction("buy", { merchant: "smith", good: "iron", units: 1 }).ok, true);
  assert.equal(validateAction("buy", { merchant: "../evil", good: "iron", units: 1 }).ok, false);
  assert.equal(validateAction("sell", { merchant: "smith", good: "iron", units: "3" }).ok, true);
  assert.equal(validateAction("sell", { merchant: "smith", good: "iron", units: 1.5 }).ok, false);
});

test("invest bounds the amount", () => {
  assert.equal(validateAction("invest", { merchant: "smith", amount: 200 }).ok, true);
  assert.equal(validateAction("invest", { merchant: "smith", amount: 0 }).ok, false);
  assert.equal(validateAction("invest", { merchant: "smith", amount: 100001 }).ok, false);
});

test("fast-forward accepts only 1..7 whole days", () => {
  assert.equal(validateAdvance({ days: 7 }).ok, true);
  assert.equal(validateAdvance({ days: 1 }).ok, true);
  assert.equal(validateAdvance({ days: 0 }).ok, false);
  assert.equal(validateAdvance({ days: 8 }).ok, false);
  assert.equal(validateAdvance({ days: 2.5 }).ok, false);
  assert.equal(validateAdvance({ days: "1e2" }).ok, false);
});

test("toInt is strict", () => {
  assert.equal(toInt("7"), 7);
  assert.equal(toInt(7), 7);
  assert.equal(toInt("1e3"), null);
  assert.equal(toInt("1.0"), null);
  assert.equal(toInt(""), null);
  assert.equal(toInt("abc"), null);
});

test("explainDecision never invents reasoning", () => {
  const none = explainDecision("");
  assert.equal(none.status, "none");
  assert.match(none.plain, /default daily rules/);

  const acc = explainDecision("ACCEPTED set_markup 2000bp -> 2000bp");
  assert.equal(acc.status, "accepted");
  assert.match(acc.plain, /accepted/);
  assert.match(acc.plain, /→ 2000bp/);

  const rej = explainDecision("REJECTED restock_extra 5: unaffordable (room 12, affordable 0)");
  assert.equal(rej.status, "rejected");
  assert.match(rej.plain, /rejected/);

  const unknown = explainDecision("something the contract wrote");
  assert.equal(unknown.status, "recorded");
  assert.match(unknown.plain, /something the contract wrote/);
});

test("rate limiter allows up to the limit then blocks", () => {
  let t = 0;
  const rl = new RateLimiter({ limit: 3, windowMs: 1000, now: () => t });
  assert.equal(rl.check("a").ok, true);
  assert.equal(rl.check("a").ok, true);
  assert.equal(rl.check("a").ok, true);
  const blocked = rl.check("a");
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterMs > 0);
  // different key unaffected
  assert.equal(rl.check("b").ok, true);
  // window rolls over
  t = 1000;
  assert.equal(rl.check("a").ok, true);
});

test("single-flight rejects a concurrent second run", async () => {
  const sf = new SingleFlight();
  let release;
  const gate = new Promise((r) => (release = r));
  const first = sf.run(async () => {
    await gate;
    return "one";
  });
  const second = await sf.run(async () => "two");
  assert.equal(second.ok, false);
  release();
  assert.deepEqual(await first, { ok: true, value: "one" });
});

test("origin allowlist logic", () => {
  assert.equal(originAllowed(undefined, []), true); // no Origin header
  assert.equal(originAllowed("https://a.example", ["https://a.example"]), true);
  assert.equal(originAllowed("https://evil.example", ["https://a.example"]), false);
  assert.equal(originAllowed("https://x.example", ["*"]), true);
  assert.deepEqual(parseAllowlist("https://a, https://b ,"), ["https://a", "https://b"]);
});
