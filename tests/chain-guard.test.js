// Unit tests for the testnet chain guard. No network, no chain.
// Run: npm run test:agent
//
// Regression guard: a public RPC hostname silently switched from testnet to
// mainnet (`free.rpc.fastnear.com`). Sending testnet transactions to a mainnet
// endpoint must be refused, not silently attempted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isTestnetChain, assertTestnetChain } from "../driver/near.js";

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
