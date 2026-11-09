// Provision the REAL NEAR testnet identity set for Ledgertown.
//
//   node driver/accounts.js
//
// - The town owner account is created through the public testnet faucet.
// - The player and the four merchants are created as genuine subaccounts of
//   the owner (Gate C: verify real NEAR testnet subaccounts), each with its own
//   key and a small NEAR balance to sign its own transactions.
//
// Idempotent: existing accounts are left untouched. No funds are fabricated.
import { KeyPair, utils } from "near-api-js";
import { connectTown, loadIdentities, CONTRACT_ID, RPC } from "./near.js";

const FUND = {
  owner: null, // created by the faucet
  player: "2",
  miller: "0.5",
  smith: "0.5",
  weaver: "0.5",
  brewer: "0.5",
};

async function accountExists(near, id) {
  try {
    await (await near.account(id)).state();
    return true;
  } catch {
    return false;
  }
}

async function faucetCreate(accountId, publicKey) {
  const res = await fetch("https://helper.testnet.near.org/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`faucet failed for ${accountId}: ${res.status} ${body}`);
  return body;
}

async function main() {
  const ids = loadIdentities();
  const near = await connectTown();

  // 1. owner via faucet
  if (!(await accountExists(near, ids.owner.accountId))) {
    console.log(`creating owner ${ids.owner.accountId} via faucet...`);
    await faucetCreate(ids.owner.accountId, ids.owner.publicKey);
    await new Promise((r) => setTimeout(r, 2500));
  } else {
    console.log(`owner ${ids.owner.accountId} exists`);
  }

  const owner = await near.account(ids.owner.accountId);

  // 2. subaccounts (player + merchants)
  for (const [role, v] of Object.entries(ids)) {
    if (role === "owner") continue;
    if (await accountExists(near, v.accountId)) {
      console.log(`subaccount ${v.accountId} exists`);
      continue;
    }
    const amount = utils.format.parseNearAmount(FUND[role] || "0.5");
    console.log(`creating subaccount ${v.accountId} (${FUND[role] || "0.5"} NEAR)...`);
    await owner.createAccount(v.accountId, KeyPair.fromString(v.secretKey).getPublicKey(), amount);
    await new Promise((r) => setTimeout(r, 1200));
  }

  // 3. report balances (real, from chain)
  console.log("\nBalances (testnet):");
  for (const [role, v] of Object.entries(ids)) {
    const a = await near.account(v.accountId);
    const b = await a.getAccountBalance();
    console.log(`  ${role.padEnd(7)} ${v.accountId.padEnd(28)} ${utils.format.formatNearAmount(b.total)} NEAR`);
  }
  console.log(`\ncontract id: ${CONTRACT_ID}\nRPC: ${RPC}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
