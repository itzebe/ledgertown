// Unit tests for the public town client's pure testnet guard. No network.
// Run: npm run test:agent
import { test } from "node:test";
import assert from "node:assert/strict";
import { nonTestnetEndpoints, TESTNET_ENDPOINTS } from "../web/town-client.js";

test("the default public RPC pool is all testnet hostnames", () => {
  // Guards against reintroducing a host that now serves mainnet
  // (free.rpc.fastnear.com). Every default endpoint must be a *.testnet.* host.
  for (const url of TESTNET_ENDPOINTS) {
    assert.match(url, /testnet/, `${url} must be a testnet endpoint`);
  }
});

test("flags any reachable non-testnet endpoint in the pool", () => {
  const bad = nonTestnetEndpoints([
    { url: "https://rpc.testnet.fastnear.com", chainId: "testnet" },
    { url: "https://free.rpc.fastnear.com", chainId: "mainnet" },
  ]);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].chainId, "mainnet");
});

test("ignores unreachable endpoints (failover's job) and accepts all-testnet", () => {
  assert.deepEqual(nonTestnetEndpoints([{ url: "https://a", chainId: "testnet" }]), []);
  assert.deepEqual(
    nonTestnetEndpoints([
      { url: "https://a", chainId: "testnet" },
      { url: "https://b", error: "ECONNREFUSED" },
    ]),
    []
  );
});
