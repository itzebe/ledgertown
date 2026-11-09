// Ledgertown town client — one place that talks to the deployed contract.
//
// Every function issues a REAL signed NEAR testnet transaction (or a real RPC
// view). Nothing is simulated or mocked: `state()` reads chain state and the
// action helpers return the on-chain transaction hash.
import { call, view, connectTown, CONTRACT_ID, nearToYocto, txHash } from "./near.js";
import { loadIdentities } from "./near.js";

export { CONTRACT_ID, connectTown };

export async function getState(near) {
  const [merchants, town, player, day, events] = await Promise.all([
    view(near, CONTRACT_ID, "list_merchants"),
    view(near, CONTRACT_ID, "get_town"),
    view(near, CONTRACT_ID, "get_player"),
    view(near, CONTRACT_ID, "get_day"),
    view(near, CONTRACT_ID, "get_events", { from_id: 0 }),
  ]);
  return { merchants, town, player, day, events };
}

/** Advance the town by one day. Any identity may call; the engine is deterministic. */
export async function tick(near, as = "owner") {
  const ids = loadIdentities();
  const outcome = await call(near, ids[as].accountId, CONTRACT_ID, "tick", {});
  return { hash: txHash(outcome), outcome };
}

export async function tickMany(near, n, as = "owner") {
  const hashes = [];
  for (let i = 0; i < n; i++) hashes.push((await tick(near, as)).hash);
  return hashes;
}

export async function deposit(near, nearAmount, as = "player") {
  const ids = loadIdentities();
  const outcome = await call(
    near,
    ids[as].accountId,
    CONTRACT_ID,
    "player_deposit",
    {},
    nearToYocto(nearAmount)
  );
  return { hash: txHash(outcome), outcome };
}

export async function gather(near, good, units, as = "player") {
  const ids = loadIdentities();
  const outcome = await call(near, ids[as].accountId, CONTRACT_ID, "player_gather", {
    good,
    units: String(units),
  });
  return { hash: txHash(outcome), outcome };
}

export async function buy(near, merchantId, good, units, as = "player") {
  const ids = loadIdentities();
  const outcome = await call(near, ids[as].accountId, CONTRACT_ID, "player_buy_from", {
    merchant_id: merchantId,
    good,
    units: String(units),
  });
  return { hash: txHash(outcome), outcome };
}

export async function sell(near, merchantId, good, units, as = "player") {
  const ids = loadIdentities();
  const outcome = await call(near, ids[as].accountId, CONTRACT_ID, "player_sell_to", {
    merchant_id: merchantId,
    good,
    units: String(units),
  });
  return { hash: txHash(outcome), outcome };
}

export async function invest(near, merchantId, amount, as = "player") {
  const ids = loadIdentities();
  const outcome = await call(near, ids[as].accountId, CONTRACT_ID, "player_invest", {
    merchant_id: merchantId,
    amount: String(amount),
  });
  return { hash: txHash(outcome), outcome };
}

/** Owner-only: install a market shock (used by the demo). */
export async function addShock(near, kind, good, num, den, start, end) {
  const ids = loadIdentities();
  const outcome = await call(near, ids.owner.accountId, CONTRACT_ID, "add_shock", {
    kind,
    good,
    num: Number(num),
    den: Number(den),
    start: Number(start),
    end: Number(end),
  });
  return { hash: txHash(outcome), outcome };
}

/** Owner-only: withdraw unallocated NEAR held by the contract (testnet funds). */
export async function ownerWithdraw(near, nearAmount) {
  const ids = loadIdentities();
  const outcome = await call(
    near,
    ids.owner.accountId,
    CONTRACT_ID,
    "owner_withdraw",
    { amount: nearToYocto(nearAmount) }
  );
  return { hash: txHash(outcome), outcome };
}

export async function setLifeline(near, enabled) {
  const ids = loadIdentities();
  const outcome = await call(near, ids.owner.accountId, CONTRACT_ID, "set_lifeline_enabled", {
    enabled,
  });
  return { hash: txHash(outcome), outcome };
}

/** A merchant's own agent acts for its own shop. */
export async function decide(near, merchantId, kind, arg) {
  const ids = loadIdentities();
  const outcome = await call(near, ids[merchantId].accountId, CONTRACT_ID, "merchant_decide", {
    merchant_id: merchantId,
    kind,
    arg: Number(arg),
  });
  return { hash: txHash(outcome), outcome };
}
