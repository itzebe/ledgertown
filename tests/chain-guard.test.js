// Unit tests for the testnet chain guard. No network, no chain.
// Run: npm run test:agent
//
// Regression guard: a public RPC hostname silently switched from testnet to
// mainnet (`free.rpc.fastnear.com`). Sending testnet transactions to a mainnet
// endpoint must be refused, not silently attempted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isTestnetChain, assertTestnetChain, nonTestnetEndpoints } from "../driver/near.js";

test("accepts testnet", () => {
  assert.equal(isTestnetChain("testnet"), true);
  assert.equal(assertTestnetChain("testnet"), "testnet");
});

test("rejects mainnet and unknown chains", () => {
  assert.equal(isTestnetChain("mainnet"), false);
  assert.equal(isTestnetChain(undefined), false);
  assert.equal(isTestnetChain(""), false);
});

test("throws a clear, actionable error for a non-testnet chain", () => {
  assert.throws(() => assertTestnetChain("mainnet"), /expected "testnet"/);
  assert.throws(() => assertTestnetChain(undefined), /refusing to run/);
});

test("flags a mainnet endpoint anywhere in the failover pool", () => {
  // The reported incident: a host that used to be testnet now answers mainnet.
  // Validating only the first responder would miss it; the pool check must not.
  const pool = [
    { url: "https://rpc.testnet.fastnear.com", chainId: "testnet" },
    { url: "https://free.rpc.fastnear.com", chainId: "mainnet" },
  ];
  const bad = nonTestnetEndpoints(pool);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].url, "https://free.rpc.fastnear.com");
});

test("ignores unreachable endpoints and accepts an all-testnet pool", () => {
  assert.deepEqual(nonTestnetEndpoints([{ url: "https://a", chainId: "testnet" }]), []);
  // An unreachable member is failover's job, not a network-identity failure.
  assert.deepEqual(
    nonTestnetEndpoints([
      { url: "https://a", chainId: "testnet" },
      { url: "https://b", error: "ECONNREFUSED" },
    ]),
    []
  );
});
