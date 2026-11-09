// Deploy the Ledgertown contract to NEAR testnet and seed the four merchants.
//
//   node driver/deploy.js
//
// Creates the contract account as a subaccount of the owner, deploys the wasm,
// initialises state, and seeds each merchant with its REAL testnet subaccount
// as its operating identity.
import fs from "node:fs";
import { KeyPair, utils } from "near-api-js";
import { connectTown, loadIdentities, WASM, CONTRACT_ID, RPC } from "./near.js";

async function exists(near, id) {
  try {
    await (await near.account(id)).state();
    return true;
  } catch {
    return false;
  }
}

const MERCHANTS = [
  ["miller", "Miller", "grain"],
  ["smith", "Smith", "iron"],
  ["weaver", "Weaver", "cloth"],
  ["brewer", "Brewer", "ale"],
];

async function main() {
  const ids = loadIdentities();
  const near = await connectTown();
  const owner = await near.account(ids.owner.accountId);

  if (!(await exists(near, CONTRACT_ID))) {
    console.log(`creating contract account ${CONTRACT_ID}...`);
    await owner.createAccount(
      CONTRACT_ID,
      KeyPair.fromString(ids.owner.secretKey).getPublicKey(),
      utils.format.parseNearAmount("3")
    );
    await new Promise((r) => setTimeout(r, 2000));
  }

  const contract = await near.account(CONTRACT_ID);
  console.log(`deploying ${WASM}...`);
  await contract.deployContract(fs.readFileSync(WASM));
  console.log("  deployed");

  // init
  try {
    await contract.functionCall({
      contractId: CONTRACT_ID,
      methodName: "new",
      args: { owner: ids.owner.accountId },
      attachedDeposit: "0",
      gas: "300000000000000",
    });
    console.log("  initialised");
  } catch (e) {
    console.log("  init skipped (already initialised):", String(e.message).slice(0, 80));
  }

  // seed merchants
  for (const [role, name, good] of MERCHANTS) {
    const acct = ids[role].accountId;
    try {
      const r = await owner.functionCall({
        contractId: CONTRACT_ID,
        methodName: "seed_merchant",
        args: {
          id: role,
          name,
          account: acct,
          specialty: good,
          start_cash: "300",
          start_inv: "20",
        },
        attachedDeposit: "0",
        gas: "300000000000000",
      });
      console.log(`  seeded ${role} -> ${acct}  tx ${r.transaction_outcome.id}`);
    } catch (e) {
      console.log(`  seed ${role} skipped:`, String(e.message).slice(0, 90));
    }
  }

  // report real on-chain state
  const { view } = await import("./near.js");
  const merchants = await view(near, CONTRACT_ID, "list_merchants");
  console.log("\nOn-chain merchants:");
  for (const m of merchants) {
    console.log(`  ${m.id.padEnd(7)} ${m.account.padEnd(28)} cash=${m.cash} inv=${JSON.stringify(m.inventory)} state=${m.state}`);
  }
  console.log(`\ncontract: ${CONTRACT_ID}\nRPC: ${RPC}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
