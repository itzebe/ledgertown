// Tests for the non-custodial wallet layer, driven against a FAKE injected
// wallet. No extension, no chain, no keys. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLAYER_METHODS,
  buildAction,
  hashFromResult,
  createInjectedWallet,
  createWalletController,
  detectInjectedWallet,
} from "../web/wallet.js";

/** A fake Freighter-shaped provider. Records what it was asked to sign. */
function fakeProvider({ connected = true, accountId = "alice.testnet", result = "HASH123", fail = null } = {}) {
  const seen = [];
  return {
    seen,
    async isConnected() { return connected; },
    async getAccountId() { return accountId; },
    async signAndSendTransaction(args) {
      seen.push(args);
      if (fail) throw new Error(fail);
      return result;
    },
    async disconnect() { return true; },
  };
}

test("owner-only and deposit methods are not player actions", () => {
  for (const bad of ["deposit", "reset", "add_shock", "owner_withdraw", "set_lifeline_enabled", "seed_merchant"]) {
    assert.ok(!PLAYER_METHODS.includes(bad), `${bad} must never be signable`);
    assert.throws(() => buildAction(bad, {}), /not a player action/);
  }
});

test("buildAction encodes args and attaches no deposit", () => {
  const a = buildAction("player_gather", { good: "iron", units: "5" });
  assert.equal(a.functionCall.methodName, "player_gather");
  assert.equal(a.functionCall.deposit.toString(), "0");
  // Args decode with TextDecoder — the play path must not depend on Buffer,
  // which the browser does not define.
  const decoded = JSON.parse(new TextDecoder().decode(a.functionCall.args));
  assert.deepEqual(decoded, { good: "iron", units: "5" });
});

test("hashFromResult tolerates the shapes extensions return", () => {
  assert.equal(hashFromResult("ABC"), "ABC");
  assert.equal(hashFromResult({ transactionHash: "T" }), "T");
  assert.equal(hashFromResult({ transaction_outcome: { id: "O" } }), "O");
  assert.equal(hashFromResult({ hash: "H" }), "H");
  assert.equal(hashFromResult(null), null);
});

test("connect fails honestly when the wallet is not signed in", async () => {
  const wallet = createInjectedWallet(fakeProvider({ connected: false }));
  const ctl = createWalletController({ wallet, contractId: "town.ledgertown.testnet" });
  await assert.rejects(() => ctl.connect(), /No wallet session/);
  assert.equal(ctl.accountId, null);
});

test("connect succeeds and exposes the account id", async () => {
  const wallet = createInjectedWallet(fakeProvider({ accountId: "bob.testnet" }));
  const ctl = createWalletController({ wallet, contractId: "town.ledgertown.testnet" });
  const id = await ctl.connect();
  assert.equal(id, "bob.testnet");
  assert.equal(ctl.status, "connected");
});

test("act sends exactly one action to the right contract and returns a hash", async () => {
  const provider = fakeProvider({ result: "TXHASH" });
  const wallet = createInjectedWallet(provider);
  const ctl = createWalletController({ wallet, contractId: "town.ledgertown.testnet" });
  await ctl.connect();
  const { hash } = await ctl.act("player_gather", { good: "grain", units: "5" });
  assert.equal(hash, "TXHASH");
  assert.equal(provider.seen.length, 1);
  assert.equal(provider.seen[0].receiverId, "town.ledgertown.testnet");
  assert.equal(provider.seen[0].actions.length, 1);
  assert.equal(provider.seen[0].actions[0].functionCall.methodName, "player_gather");
});

test("act refuses a non-player method before touching the wallet", async () => {
  const provider = fakeProvider();
  const ctl = createWalletController({ wallet: createInjectedWallet(provider), contractId: "c" });
  await ctl.connect();
  await assert.rejects(() => ctl.act("owner_withdraw", { amount: "1" }), /not a player action/);
  assert.equal(provider.seen.length, 0, "the wallet must never be asked to sign it");
});

test("a rejected signature surfaces the real reason, never a fake success", async () => {
  const provider = fakeProvider({ fail: "User rejected the request" });
  const ctl = createWalletController({ wallet: createInjectedWallet(provider), contractId: "c" });
  await ctl.connect();
  await assert.rejects(() => ctl.act("player_gather", { good: "grain", units: "5" }), /User rejected/);
  assert.equal(ctl.status, "error");
});

test("act before connecting is refused", async () => {
  const ctl = createWalletController({ wallet: createInjectedWallet(fakeProvider()), contractId: "c" });
  await assert.rejects(() => ctl.act("player_gather", { good: "grain", units: "5" }), /connect a wallet first/);
});

test("detectInjectedWallet finds a provider or reports none", () => {
  assert.equal(detectInjectedWallet({}), null);
  const p = { isConnected: () => true };
  assert.equal(detectInjectedWallet({ freighter: p }), p);
  assert.equal(detectInjectedWallet({ near: { wallet: p } }), p);
});

test("buildAction does not depend on the Node Buffer global (browser has none)", () => {
  const saved = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined;
    const a = buildAction("player_gather", { good: "grain", units: "1" });
    assert.ok(a.functionCall.args.length > 0, "args were encoded without Buffer");
    const decoded = JSON.parse(new TextDecoder().decode(a.functionCall.args));
    assert.deepEqual(decoded, { good: "grain", units: "1" });
  } finally {
    globalThis.Buffer = saved;
  }
});
