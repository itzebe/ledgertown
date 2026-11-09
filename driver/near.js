// Shared NEAR testnet connection + contract client for Ledgertown.
import { connect, KeyPair, keyStores, utils, transactions, providers } from "near-api-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const KEYS_FILE = path.join(root, "keys", "identities.json");
export const WASM = path.join(
  root,
  "contract",
  "target",
  "wasm32-unknown-unknown",
  "release",
  "ledgertown.wasm"
);
export const CONTRACT_ID = process.env.LEDGERTOWN_CONTRACT || "town.ledgertown.testnet";
/** Free public *testnet* RPCs, tried in order. Override the first with
 *  `LEDGERTOWN_RPC`; each has its own rate limit, so failover keeps the demo
 *  and the UI responsive without any paid plan.
 *
 *  These MUST be testnet endpoints. `free.rpc.fastnear.com` was previously used
 *  here but now serves MAINNET; sending a testnet-signed transaction to it fails,
 *  and a mixed-endpoint failover pool is unsafe. `connectTown` additionally
 *  verifies the resolved endpoint reports `chain_id: testnet` and refuses to run
 *  otherwise. */
export const RPC_ENDPOINTS = [
  process.env.LEDGERTOWN_RPC,
  "https://rpc.testnet.fastnear.com",
  "https://near-testnet.drpc.org",
  "https://rpc.testnet.near.org",
].filter(Boolean);
export const RPC = RPC_ENDPOINTS[0];

export function loadIdentities() {
  if (!fs.existsSync(KEYS_FILE)) {
    throw new Error(`missing ${KEYS_FILE}; run: node driver/keys.js`);
  }
  return JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
}

/** A keystore holding every Ledgertown identity. */
export function makeKeyStore() {
  const ids = loadIdentities();
  const ks = new keyStores.InMemoryKeyStore();
  for (const v of Object.values(ids)) {
    ks.setKey("testnet", v.accountId, KeyPair.fromString(v.secretKey));
  }
  // the contract account shares the owner's key
  ks.setKey("testnet", CONTRACT_ID, KeyPair.fromString(ids.owner.secretKey));
  return ks;
}

export async function connectTown() {
  const keyStore = makeKeyStore();
  const near = await connect({
    networkId: "testnet",
    nodeUrl: RPC,
    keyStore,
    headers: {},
  });
  if (RPC_ENDPOINTS.length > 1) {
    near.connection.provider = new providers.FailoverRpcProvider(
      RPC_ENDPOINTS.map((url) => new providers.JsonRpcProvider({ url }))
    );
  }
  await assertTestnet(near);
  return near;
}

/** Pure: is this a testnet chain id? Exported so the guard is unit-testable
 *  offline (no network), matching the `executionFailure` pattern. */
export function isTestnetChain(chainId) {
  return chainId === "testnet";
}

/** Pure: throw a clear, actionable error if `chainId` is not testnet. */
export function assertTestnetChain(chainId) {
  if (!isTestnetChain(chainId)) {
    throw new Error(
      `refusing to run: RPC endpoint reports chain_id "${chainId}", expected "testnet". ` +
        `Set LEDGERTOWN_RPC to a testnet endpoint (e.g. https://rpc.testnet.fastnear.com).`
    );
  }
  return chainId;
}

/** Fail fast if the resolved RPC is not testnet.
 *
 *  Public RPC hostnames have silently switched networks before
 *  (`free.rpc.fastnear.com` now serves mainnet). A testnet-signed transaction
 *  sent to a mainnet endpoint is rejected, and worse, a mainnet endpoint in a
 *  failover pool could serve reads from the wrong chain. Refuse to run rather
 *  than mislead. `networkId` in the connect() config does not guarantee this. */
export async function assertTestnet(near) {
  const status = await near.connection.provider.status();
  return assertTestnetChain(status?.chain_id ?? status?.chainId);
}

export function nearToYocto(near) {
  return utils.format.parseNearAmount(String(near));
}

/** Retry an async op through transient RPC rate limits (HTTP 429). */
export async function withRetry(fn, label = "op", tries = 8) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const transient = /429|Rate limit|Too Many|timeout|ECONNRESET|502|503|504/i.test(msg);
      if (!transient) throw e;
      const wait = Math.min(1000 * 2 ** i, 20000) + Math.floor(Math.random() * 500);
      process.stderr.write(`  [retry ${i + 1}/${tries}] ${label}: backing off ${wait}ms\n`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/** Generic view helper. Reads at `final` finality by default so a read never
 *  observes a block whose chunks are not all applied (optimistic reads can
 *  return stale/mixed state right after a write). */
export async function view(near, contractId, method, args = {}, finality = "final") {
  return withRetry(async () => {
    const provider = near.connection.provider;
    return provider
      .query({
        request_type: "call_function",
        account_id: contractId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
        finality,
      })
      .then((r) => JSON.parse(Buffer.from(r.result).toString("utf8")));
  }, `view:${method}`);
}

/** Extract a human-readable reason from a failed-execution status. */
function failureMessage(failure) {
  try {
    const kind = failure.ActionError?.kind ?? failure.ActionError;
    const fc = kind?.FunctionCallError;
    const s = fc?.ExecutionError ?? fc?.CompilationError ?? JSON.stringify(failure);
    return String(s).replace(/^Smart contract panicked:\s*/, "");
  } catch {
    return JSON.stringify(failure);
  }
}

/** A failed-execution outcome is not a success: return its reason, else null.
 *  Pure, so the "never report a fake success" rule is unit-tested offline. */
export function executionFailure(outcome) {
  const failure = outcome?.status?.Failure;
  return failure ? failureMessage(failure) : null;
}

/** Call a change method as `accountId` and return the outcome once FINAL.
 *
 *  The transaction is signed ONCE and then broadcast with retry. Retrying the
 *  broadcast is safe because the *identical* signed transaction is resent: the
 *  chain deduplicates it by hash, so a non-idempotent method like `tick` runs at
 *  most once even if a 429 hides the first response. We then wait for FINAL
 *  finality so a subsequent `final`-finality read is guaranteed to observe it.
 *
 *  A transaction that was included but whose execution failed (a contract rule
 *  violation) is surfaced as a thrown Error, never as a success. */
export async function call(near, accountId, contractId, method, args = {}, depositYocto = "0") {
  const account = await near.account(accountId);
  const action = transactions.functionCall(
    method,
    Buffer.from(JSON.stringify(args)),
    BigInt("300000000000000"),
    BigInt(depositYocto)
  );
  // Signing fetches the access key and a recent block over RPC; retry that
  // freely (it changes no state). The signed bytes are then fixed, so the
  // broadcast below can only ever submit this one transaction.
  const [txHashBytes, signedTx] = await withRetry(
    () => account.signTransaction(contractId, [action]),
    `sign:${method}`
  );
  const hash = utils.serialize.base_encode(txHashBytes);

  const outcome = await withRetry(
    () => near.connection.provider.sendTransactionUntil(signedTx, "EXECUTED_OPTIMISTIC"),
    `call:${method}`
  );

  const failure = executionFailure(outcome);
  if (failure) throw new Error(failure);

  try {
    await withRetry(
      () => near.connection.provider.txStatus(hash, accountId, "FINAL"),
      `status:${method}`
    );
  } catch {
    // Finality could not be confirmed (e.g. rate-limited). The transaction is
    // executed; a later read will observe it. Never re-broadcast here.
  }
  return outcome;
}

export function txHash(outcome) {
  return outcome?.transaction_outcome?.id ?? outcome?.transaction?.hash ?? "?";
}

/** Real NEAR transfer between two of our testnet accounts. */
export async function transfer(near, fromId, toId, nearAmount) {
  return withRetry(async () => {
    const account = await near.account(fromId);
    return account.sendMoney(toId, nearToYocto(nearAmount));
  }, `transfer:${fromId}->${toId}`);
}

export async function balanceNear(near, id) {
  const account = await near.account(id);
  const b = await account.getAccountBalance();
  return Number(b.total) / 1e24;
}

/** Create a throwaway testnet account from the free faucet and use it to send
 *  `amountNear` to `target`. Free testnet NEAR only; no purchase required. */
export async function faucetFund(near, target, amountNear) {
  const kp = KeyPair.fromRandom("ed25519");
  const id = `lgt-funder-${Date.now()}.testnet`;
  const res = await fetch("https://helper.testnet.near.org/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`faucet ${res.status}: ${await res.text()}`);
  await new Promise((r) => setTimeout(r, 3500));
  await near.connection.signer.keyStore.setKey("testnet", id, kp);
  const a = await near.account(id);
  return a.sendMoney(target, nearToYocto(amountNear));
}

/** Ensure `accountId` holds at least `minNear`; top up from the faucet if not. */
export async function ensureFunded(near, accountId, minNear, topUpTo = minNear * 2) {
  const bal = await balanceNear(near, accountId);
  if (bal >= minNear) return { funded: false, balance: bal };
  const top = (topUpTo - bal).toFixed(3);
  const t = await faucetFund(near, accountId, top);
  return { funded: true, top, hash: t?.transaction_outcome?.id };
}
