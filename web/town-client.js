// Town clients for the public server.
//
// Two modes, deliberately separated:
//
//   createReadOnlyTown()  — RPC views only. Needs NO keys at all, so public
//                           browsing works even when signing is unavailable.
//   createPlayTown()      — adds bounded, non-owner actions signed by ONE
//                           dedicated demo account whose key comes from the
//                           environment. `deposit` is never exposed; owner-only
//                           methods are never reachable.
//
// Neither mode ever reads keys/identities.json — the operator's owner and
// merchant keys must not exist in a public deployment.
import { providers, KeyPair, keyStores, connect, utils, transactions } from "near-api-js";
import { CONTRACT_ID } from "../driver/near.js";
import { withRetry, executionFailure, txHash } from "../driver/near.js";

export const TESTNET_ENDPOINTS = [
  "https://rpc.testnet.fastnear.com",
  "https://near-testnet.drpc.org",
  "https://rpc.testnet.near.org",
];

/** Pure: return reachable endpoints that answered a non-testnet chain.
 *  Mirrors driver/near.js so the public server enforces testnet-only too. */
export function nonTestnetEndpoints(probes) {
  return probes.filter((p) => !p.error && p.chainId !== "testnet");
}

/** Probe every endpoint and throw if any reachable one is not testnet.
 *  Fail-closed: a probe that errors is ignored (failover's job), but a probe
 *  that answers the wrong chain aborts startup. */
export async function assertAllTestnet(urls) {
  const probes = await Promise.all(
    urls.map(async (url) => {
      try {
        const status = await new providers.JsonRpcProvider({ url }).status();
        return { url, chainId: status?.chain_id ?? status?.chainId };
      } catch (e) {
        return { url, error: String(e?.message || e) };
      }
    })
  );
  const bad = nonTestnetEndpoints(probes);
  if (bad.length) {
    throw new Error(
      "refusing to start: RPC endpoint(s) report a non-testnet chain: " +
        bad.map((b) => `${b.url} -> ${b.chainId}`).join(", ")
    );
  }
  return probes;
}

function buildProvider(urls) {
  const pool = urls.map((url) => new providers.JsonRpcProvider({ url }));
  return pool.length > 1 ? new providers.FailoverRpcProvider(pool) : pool[0];
}

async function view(provider, method, args = {}) {
  return withRetry(
    () =>
      provider
        .query({
          request_type: "call_function",
          account_id: CONTRACT_ID,
          method_name: method,
          args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
          finality: "final",
        })
        .then((r) => JSON.parse(Buffer.from(r.result).toString("utf8"))),
    `view:${method}`
  );
}

async function readState(provider) {
  const [merchants, town, player, day, events] = await Promise.all([
    view(provider, "list_merchants"),
    view(provider, "get_town"),
    view(provider, "get_player"),
    view(provider, "get_day"),
    view(provider, "get_events", { from_id: 0 }),
  ]);
  return { merchants, town, player, day, events };
}

/** Public, key-free read access. `endpoints` defaults to the public testnet pool. */
export async function createReadOnlyTown({
  endpoints = TESTNET_ENDPOINTS,
  verifyChain = true,
} = {}) {
  if (verifyChain) await assertAllTestnet(endpoints);
  const provider = buildProvider(endpoints);
  return {
    contract: CONTRACT_ID,
    mode: "read-only",
    getState: () => readState(provider),
  };
}

/** Play access. Requires `accountId` + `secretKey` from the environment; the
 *  key is used ONLY for the bounded public actions below. */
export async function createPlayTown({
  accountId,
  secretKey,
  endpoints = TESTNET_ENDPOINTS,
  verifyChain = true,
} = {}) {
  if (!accountId || !secretKey) {
    throw new Error("play mode requires LEDGERTOWN_DEMO_ACCOUNT and LEDGERTOWN_DEMO_KEY");
  }
  if (verifyChain) await assertAllTestnet(endpoints);
  const keyStore = new keyStores.InMemoryKeyStore();
  keyStore.setKey("testnet", accountId, KeyPair.fromString(secretKey));
  const near = await connect({
    networkId: "testnet",
    nodeUrl: endpoints[0],
    keyStore,
    headers: {},
  });
  near.connection.provider = buildProvider(endpoints);

  async function call(method, args = {}) {
    const account = await near.account(accountId);
    const action = transactions.functionCall(
      method,
      Buffer.from(JSON.stringify(args)),
      BigInt("300000000000000"),
      BigInt(0) // no attached deposit: deposit() is never called from here
    );
    const [hashBytes, signedTx] = await withRetry(
      () => account.signTransaction(CONTRACT_ID, [action]),
      `sign:${method}`
    );
    const hash = utils.serialize.base_encode(hashBytes);
    const outcome = await withRetry(
      () => near.connection.provider.sendTransactionUntil(signedTx, "EXECUTED_OPTIMISTIC"),
      `call:${method}`
    );
    const failure = executionFailure(outcome);
    if (failure) throw new Error(failure);
    try {
      await withRetry(() => near.connection.provider.txStatus(hash, accountId, "FINAL"), `status:${method}`);
    } catch {
      /* executed; a later read observes it */
    }
    return { hash: hash || txHash(outcome) };
  }

  return {
    contract: CONTRACT_ID,
    mode: "play",
    accountId,
    getState: () => readState(near.connection.provider),
    // The ONLY actions the public server can sign. No deposit, no owner methods.
    tick: () => call("tick", {}),
    gather: ({ good, units }) => call("player_gather", { good, units: String(units) }),
    buy: ({ merchant, good, units }) =>
      call("player_buy_from", { merchant_id: merchant, good, units: String(units) }),
    sell: ({ merchant, good, units }) =>
      call("player_sell_to", { merchant_id: merchant, good, units: String(units) }),
    invest: ({ merchant, amount }) =>
      call("player_invest", { merchant_id: merchant, amount: String(amount) }),
  };
}
