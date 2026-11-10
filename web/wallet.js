// Wallet connection for Ledgertown — non-custodial by construction.
//
// The player's NEAR key never touches this site. We build the actions in the
// browser and hand them to a wallet extension (NEAR Wallet Selector's injected
// provider, e.g. Freighter). The extension shows the user exactly what they are
// approving and signs with a key this page can never read.
//
// near-api-js (462 kB) is imported ONLY when a wallet is actually used, so a
// read-only visitor never downloads it. The import is static per-module, so the
// browser fetches it on first connect; tests import this file in Node, where the
// same import resolves to the same committed bundle.
import { transactions } from "./vendor/near-api-js.min.js";

export const TESTNET = "testnet";
export const GAS = 300_000_000_000_000n; // 300 Tgas

/** The only methods a player wallet will ever be asked to sign. `deposit`
 *  attaches NEAR; owner-only methods (`reset`, `add_shock`, `owner_withdraw`,
 *  `set_lifeline_enabled`, `seed_merchant`) are never in this list, so the UI
 *  cannot even offer them. `tick` is public on-chain (the shared market clock). */
export const PLAYER_METHODS = [
  "player_init",
  "player_gather",
  "player_buy_from",
  "player_sell_to",
  "player_invest",
  "tick",
];

/** Build a near-api-js FunctionCall action for one player method. Pure.
 *  Args are encoded with TextEncoder — `Buffer` is NOT defined in the browser
 *  (the near-api-js bundle polyfills it only for itself, not for this module),
 *  so the play path must not depend on it. */
export function buildAction(method, args = {}) {
  if (!PLAYER_METHODS.includes(method)) {
    throw new Error(`method ${method} is not a player action`);
  }
  return transactions.functionCall(
    method,
    new TextEncoder().encode(JSON.stringify(args)),
    GAS,
    0n // player actions never attach a deposit
  );
}

/** Extract a transaction hash from whatever shape the extension returns. */
export function hashFromResult(res) {
  if (!res) return null;
  if (typeof res === "string") return res;
  return (
    res.transactionHash ||
    res.transactionOutcome?.id ||
    res.transaction_outcome?.id ||
    res.hash ||
    null
  );
}

/** A wallet backed by an injected provider (window.freighter or equivalent).
 *  The provider is passed in so tests can supply a fake with the same shape. */
export function createInjectedWallet(provider) {
  if (!provider) throw new Error("no NEAR wallet extension found in this browser");
  return {
    async isSignedIn() {
      return provider.isConnected();
    },
    async getAccountId() {
      return provider.getAccountId();
    },
    async signAndSendTransaction({ receiverId, actions }) {
      return provider.signAndSendTransaction({ receiverId, actions });
    },
    async disconnect() {
      return provider.disconnect();
    },
  };
}

/** Find an injected provider in the page. Returns null when none is present,
 *  which the UI surfaces honestly rather than pretending to be connected. */
export function detectInjectedWallet(win = globalThis) {
  return win?.freighter || win?.near?.wallet || null;
}

/**
 * Wallet state machine driving the interface.
 * status: browse | connecting | connected | pending | error
 */
export function createWalletController({ wallet, contractId, onChange = () => {} }) {
  let accountId = null;
  let status = "browse";
  let lastError = null;

  const emit = () => onChange({ accountId, status, error: lastError });

  return {
    get accountId() { return accountId; },
    get status() { return status; },

    async connect() {
      status = "connecting"; lastError = null; emit();
      try {
        if (!(await wallet.isSignedIn())) {
          throw new Error(
            "No wallet session. Open your NEAR wallet extension, connect it, then try again."
          );
        }
        const id = await wallet.getAccountId();
        if (!id) throw new Error("wallet returned no account id");
        accountId = id;
        status = "connected"; emit();
        return id;
      } catch (e) {
        accountId = null; status = "browse"; lastError = String(e?.message || e); emit();
        throw e;
      }
    },

    disconnect() {
      accountId = null; status = "browse"; lastError = null; emit();
    },

    /** Sign and send one player action. Resolves with { hash }. Rejects with a
     *  real reason (rejection, RPC failure, timeout) — never a fake success. */
    async act(method, args = {}) {
      if (!accountId) throw new Error("connect a wallet first");
      const action = buildAction(method, args); // throws for non-player methods
      status = "pending"; lastError = null; emit();
      try {
        const res = await wallet.signAndSendTransaction({
          receiverId: contractId,
          actions: [action],
        });
        status = "connected"; emit();
        return { hash: hashFromResult(res) };
      } catch (e) {
        status = "error"; lastError = String(e?.message || e); emit();
        throw e;
      }
    },
  };
}
