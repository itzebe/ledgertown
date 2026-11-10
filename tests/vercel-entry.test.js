// Tests for the Vercel serverless entry point. No network, no keys, no chain.
// Run: npm test
//
// These prove the two properties the deployment depends on:
//  1. the entry reuses the SAME handler as web/server.js (web/handler.js), so
//     routing, validation and the read-only split behave identically; and
//  2. a transient cold-start failure does not wedge the warm instance — a
//     rejected build is retried on the next request instead of being cached.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHandler, memoizeOnce } from "../api/[...path].js";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web");

function fakeTown() {
  const calls = [];
  return {
    calls,
    town: {
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
      gather: async () => ({ hash: "H" }),
      buy: async () => ({ hash: "H" }),
      sell: async () => ({ hash: "H" }),
      invest: async () => ({ hash: "H" }),
    },
  };
}

function makeReq(method, url, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    url,
    headers: {},
    socket: { remoteAddress: "10.0.0.1" },
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}
function makeRes() {
  return {
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
}

test("the Vercel entry serves the shared handler's routes (health + state)", async () => {
  const { town } = fakeTown();
  const handler = await buildHandler({ town, config: { mode: "read-only", originAllowlist: [], webRoot } });

  const health = makeRes();
  await handler(makeReq("GET", "/healthz"), health);
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().mode, "read-only");

  const state = makeRes();
  await handler(makeReq("GET", "/api/state"), state);
  assert.equal(state.statusCode, 200);
  assert.equal(state.json().day, 51);
  assert.equal(state.json().sharedPlayer, true);
});

test("read-only entry refuses public actions (503) and owner methods (400)", async () => {
  const { town, calls } = fakeTown();
  const handler = await buildHandler({ town, config: { mode: "read-only", originAllowlist: [], webRoot } });

  const act = makeRes();
  await handler(makeReq("POST", "/api/action/gather", { good: "iron", units: 1 }), act);
  assert.equal(act.statusCode, 503);

  for (const name of ["deposit", "reset", "owner_withdraw", "seed_merchant"]) {
    const r = makeRes();
    await handler(makeReq("POST", `/api/action/${name}`, {}), r);
    assert.equal(r.statusCode, 400, `${name} must 400`);
  }
  assert.deepEqual(calls, [], "read-only must never sign");
});

test("memoizeOnce caches a successful build (factory runs once)", async () => {
  let n = 0;
  const get = memoizeOnce(async () => {
    n += 1;
    return { id: n };
  });
  const a = await get();
  const b = await get();
  assert.equal(n, 1);
  assert.equal(a, b);
});

test("memoizeOnce retries after a rejected build instead of caching the failure", async () => {
  let n = 0;
  const get = memoizeOnce(async () => {
    n += 1;
    if (n === 1) throw new Error("cold start: RPC briefly unreachable");
    return { id: n };
  });
  await assert.rejects(() => get(), /briefly unreachable/);
  const second = await get();
  assert.equal(n, 2, "a rejected build must be retried, not cached");
  assert.deepEqual(second, { id: 2 });
});
