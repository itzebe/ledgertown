// HTTP-level tests for the public handler, driven against a FAKE town client.
// No network, no keys, no chain. Run: npm run test:agent
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler, cleanError, SECURITY_HEADERS } from "../web/handler.js";
import { RateLimiter, SingleFlight } from "../web/guard.js";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web");

function fakeTown(overrides = {}) {
  const calls = [];
  const base = {
    contract: "town.ledgertown.testnet",
    getState: async () => ({
      day: 51,
      town: [51, 3000, 4, 5569],
      player: { cash: 5569, inventory: {}, deposited_yocto: 0 },
      merchants: [{ id: "smith", state: "open", last_decision: "" }],
      events: [],
    }),
    tick: async () => {
      calls.push("tick");
      return { hash: "H_TICK" };
    },
    gather: async (a) => {
      calls.push(["gather", a]);
      return { hash: "H_GATHER" };
    },
    buy: async (a) => {
      calls.push(["buy", a]);
      return { hash: "H_BUY" };
    },
    sell: async (a) => {
      calls.push(["sell", a]);
      return { hash: "H_SELL" };
    },
    invest: async (a) => {
      calls.push(["invest", a]);
      return { hash: "H_INVEST" };
    },
  };
  return { town: { ...base, ...overrides }, calls };
}

// Minimal req/res doubles.
function makeReq(method, url, body, headers = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    url,
    headers,
    socket: { remoteAddress: "10.0.0.1" },
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}
function makeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: "",
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    writeHead(code, h = {}) {
      this.statusCode = code;
      for (const [k, v] of Object.entries(h)) this.headers[k.toLowerCase()] = v;
    },
    end(data) {
      this.body = data ?? "";
    },
    json() {
      return JSON.parse(this.body);
    },
  };
  return res;
}

function build(townOverrides, configOverrides = {}, extra = {}) {
  const { town, calls } = fakeTown(townOverrides);
  const handler = createHandler({
    town,
    config: { mode: "play", originAllowlist: [], webRoot, ...configOverrides },
    ...extra,
  });
  return { handler, calls };
}

async function call(handler, method, url, body, headers) {
  const res = makeRes();
  await handler(makeReq(method, url, body, headers), res);
  return res;
}

test("GET /api/state returns real-shaped state and no secrets", async () => {
  const { handler } = build();
  const res = await call(handler, "GET", "/api/state");
  assert.equal(res.statusCode, 200);
  const j = res.json();
  assert.equal(j.ok, true);
  assert.equal(j.day, 51);
  assert.equal(j.sharedPlayer, true);
  assert.equal(j.canAct, true);
  // no key material anywhere in the payload
  assert.doesNotMatch(res.body, /secretKey|privateKey|ed25519:|identities\.json/);
});

test("read-only mode refuses every action with 503 and never signs", async () => {
  const { handler, calls } = build({}, { mode: "read-only" });
  for (const [name, body] of [
    ["gather", { good: "iron", units: 1 }],
    ["buy", { merchant: "smith", good: "iron", units: 1 }],
    ["invest", { merchant: "smith", amount: 200 }],
  ]) {
    const res = await call(handler, "POST", `/api/action/${name}`, body);
    assert.equal(res.statusCode, 503, `${name} must be refused read-only`);
  }
  const adv = await call(handler, "POST", "/api/advance", { days: 7 });
  assert.equal(adv.statusCode, 503);
  assert.deepEqual(calls, [], "no signing calls may happen read-only");
});

test("read-only mode still serves state and health", async () => {
  const { handler } = build({}, { mode: "read-only" });
  const s = await call(handler, "GET", "/api/state");
  assert.equal(s.statusCode, 200);
  assert.equal(s.json().canAct, false);
  const h = await call(handler, "GET", "/healthz");
  assert.equal(h.statusCode, 200);
  assert.equal(h.json().mode, "read-only");
});

test("deposit and owner methods are unreachable over HTTP", async () => {
  const { handler, calls } = build();
  for (const name of ["deposit", "reset", "add_shock", "owner_withdraw", "set_lifeline_enabled"]) {
    const res = await call(handler, "POST", `/api/action/${name}`, {});
    assert.equal(res.statusCode, 400, `${name} must 400`);
  }
  assert.deepEqual(calls, []);
});

test("invalid action input is rejected with 400", async () => {
  const { handler, calls } = build();
  const res = await call(handler, "POST", "/api/action/gather", { good: "iron", units: 999 });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /1\.\.50/);
  assert.deepEqual(calls, []);
});

test("oversized body is rejected with 413", async () => {
  const { handler } = build();
  const big = { good: "iron", units: 1, pad: "x".repeat(5000) };
  const res = await call(handler, "POST", "/api/action/gather", big);
  assert.equal(res.statusCode, 413);
});

test("invalid JSON is rejected with 400", async () => {
  const { handler } = build();
  const res = makeRes();
  const req = {
    method: "POST",
    url: "/api/action/gather",
    headers: {},
    socket: { remoteAddress: "1.2.3.4" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from("{not json");
    },
  };
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test("rate limiting returns 429 after the limit", async () => {
  const limiter = new RateLimiter({ limit: 2, windowMs: 60_000 });
  const { handler } = build({}, {}, { actionLimiter: limiter, advanceLimiter: limiter });
  const a = await call(handler, "POST", "/api/action/gather", { good: "iron", units: 1 });
  const b = await call(handler, "POST", "/api/action/gather", { good: "iron", units: 1 });
  const c = await call(handler, "POST", "/api/action/gather", { good: "iron", units: 1 });
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(c.statusCode, 429);
  assert.ok(Number(c.headers["retry-after"]) > 0);
});

test("fast-forward runs the requested number of real ticks", async () => {
  const { handler, calls } = build();
  const res = await call(handler, "POST", "/api/advance", { days: 7 });
  assert.equal(res.statusCode, 200);
  const j = res.json();
  assert.equal(j.completed, 7);
  assert.equal(j.requested, 7);
  assert.equal(j.hashes.length, 7);
  assert.equal(calls.filter((c) => c === "tick").length, 7);
});

test("fast-forward reports honest partial failure, never a fake 7", async () => {
  let n = 0;
  const { handler, calls } = build({
    tick: async () => {
      calls.push("tick");
      if (++n === 3) throw new Error("429 Too Many Requests");
      return { hash: `H${n}` };
    },
  });
  const res = await call(handler, "POST", "/api/advance", { days: 7 });
  assert.equal(res.statusCode, 207);
  const j = res.json();
  assert.equal(j.ok, false);
  assert.equal(j.completed, 2, "only two ticks succeeded");
  assert.equal(j.requested, 7);
  assert.equal(j.failed.length, 1);
  assert.equal(j.hashes.length, 2);
});

test("fast-forward refuses a concurrent duplicate", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const singleFlight = new SingleFlight();
  const { handler } = build(
    {
      tick: async () => {
        await gate;
        return { hash: "H" };
      },
    },
    {},
    { singleFlight }
  );
  const first = call(handler, "POST", "/api/advance", { days: 3 });
  // let the first request enter the critical section
  await new Promise((r) => setTimeout(r, 10));
  const second = await call(handler, "POST", "/api/advance", { days: 3 });
  assert.equal(second.statusCode, 409);
  release();
  await first;
});

test("unknown routes 404 and wrong methods 405", async () => {
  const { handler } = build();
  const nf = await call(handler, "GET", "/api/nope");
  assert.equal(nf.statusCode, 404);
  const bad = await call(handler, "PUT", "/api/state");
  assert.equal(bad.statusCode, 405);
});

test("security headers are present on responses", async () => {
  const { handler } = build();
  const res = await call(handler, "GET", "/healthz");
  for (const k of Object.keys(SECURITY_HEADERS)) {
    assert.ok(res.headers[k.toLowerCase()], `missing ${k}`);
  }
});

test("CORS: only allowlisted origins are reflected", async () => {
  const { handler } = build({}, { originAllowlist: ["https://ok.example"] });
  const ok = await call(handler, "GET", "/healthz", undefined, { origin: "https://ok.example" });
  assert.equal(ok.headers["access-control-allow-origin"], "https://ok.example");
  const no = await call(handler, "GET", "/healthz", undefined, { origin: "https://evil.example" });
  assert.equal(no.headers["access-control-allow-origin"], undefined);
});

test("cleanError strips the RPC JSON wrapper", () => {
  const e = new Error('{"ExecutionError":"Smart contract panicked: gather 1..=50 per call"}');
  assert.equal(cleanError(e), "gather 1..=50 per call");
});

test("static .json assets are served as application/json (provenance panel)", async () => {
  const { handler } = build();
  const res = await call(handler, "GET", "/provenance.json");
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  const body = JSON.parse(res.body);
  // Every hash the UI links must be a real 44-char NEAR transaction hash — the
  // provenance panel must never render a placeholder.
  for (const t of body.txs) assert.match(t.hash, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  assert.ok(body.eventTx.CLOSED && body.eventTx.REOPENED);
});


// -- per-account player reads (/api/player) --------------------------------

test("/api/state reports the contract's player model honestly", async () => {
  const single = build({});
  const s1 = await call(single.handler, "GET", "/api/state");
  assert.equal(s1.json().model, "single");
  assert.equal(s1.json().sharedPlayer, true);

  const per = build({ getState: async () => ({ day: 9, town: [9, 100, 4, 3], model: "per-account", merchants: [], events: [] }) });
  const s2 = await call(per.handler, "GET", "/api/state");
  assert.equal(s2.json().model, "per-account");
  assert.equal(s2.json().sharedPlayer, false);
});

test("/api/player returns one account's purse and never any secret", async () => {
  const { handler } = build({
    getPlayer: async (acct) =>
      acct === "alice.testnet" ? { cash: 120, inventory: { grain: 5 }, deposited_yocto: 0 } : null,
  });
  const ok = await call(handler, "GET", "/api/player?account=alice.testnet");
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().player.cash, 120);
  assert.equal(ok.json().account, "alice.testnet");
  assert.doesNotMatch(ok.body, /secretKey|privateKey|ed25519:|identities\.json/);

  const none = await call(handler, "GET", "/api/player?account=nobody.testnet");
  assert.equal(none.statusCode, 200);
  assert.equal(none.json().player, null);
});

test("/api/player rejects a malformed account id", async () => {
  const { handler } = build();
  for (const bad of ["", "A", "has space", "UPPER.testnet", "a".repeat(70), "x!!"]) {
    const res = await call(handler, "GET", `/api/player?account=${encodeURIComponent(bad)}`);
    assert.equal(res.statusCode, 400, `${bad} must be rejected`);
  }
});

test("/api/player says 501 when the town client cannot read players", async () => {
  const { town } = fakeTown();
  delete town.getPlayer;
  const handler = createHandler({ town, config: { mode: "read-only", originAllowlist: [], webRoot } });
  const res = await call(handler, "GET", "/api/player?account=alice.testnet");
  assert.equal(res.statusCode, 501);
});

// -- resilience: state cache and upstream error classification --------------

test("/api/state is cached for a short TTL so a burst of tabs cannot exhaust the RPC", async () => {
  let calls = 0;
  let clock = 1000;
  const { handler } = build(
    { getState: async () => { calls++; return { day: 51, town: [51, 1, 4, 1], merchants: [], events: [] }; } },
    {},
    { stateTtlMs: 2000, now: () => clock }
  );
  await call(handler, "GET", "/api/state");
  await call(handler, "GET", "/api/state");
  assert.equal(calls, 1, "two reads inside the TTL share one upstream call");
  clock += 2500;
  await call(handler, "GET", "/api/state");
  assert.equal(calls, 2, "the read refreshes once the TTL expires");
});

test("the cache can be disabled for deterministic tests", async () => {
  let calls = 0;
  const { handler } = build(
    { getState: async () => { calls++; return { day: 1, town: [1, 0, 0, 0], merchants: [], events: [] }; } },
    {},
    { stateTtlMs: 0 }
  );
  await call(handler, "GET", "/api/state");
  await call(handler, "GET", "/api/state");
  assert.equal(calls, 2);
});

test("an upstream RPC failure is reported as 502, not a misleading 400 or a fake 200", async () => {
  const { handler } = build({ getState: async () => { throw new Error("429 Too Many Requests"); } });
  const res = await call(handler, "GET", "/api/state");
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().ok, false);
});

test("validation errors keep their 4xx status (not turned into 502)", async () => {
  const { handler } = build();
  const res = await call(handler, "POST", "/api/action/gather", { good: "iron", units: 0 });
  assert.equal(res.statusCode, 400);
});
