// Upgrade the LIVE Ledgertown contract to the per-account build.
//
//   node driver/upgrade.js
//
// Owner-only. Deploys the freshly built wasm over the existing contract account
// and calls `migrate()`, which converts the single shared purse into a
// per-account `players` map while preserving every merchant, event, shock and
// the shared purse's cash/inventory (handed to the owner's own purse). Run
// `node scripts/verify-migration.js` first — it decodes the live state with the
// old layout and prints EXACT MATCH when the migration is safe.
import fs from "node:fs";
import { connectTown, loadIdentities, WASM, CONTRACT_ID } from "./near.js";

async function main() {
  const ids = loadIdentities();
  const near = await connectTown();
  const contract = await near.account(CONTRACT_ID);

  console.log(`deploying ${WASM} over ${CONTRACT_ID}...`);
  await contract.deployContract(fs.readFileSync(WASM));
  console.log("  deployed");

  console.log("calling migrate() (owner-only)...");
  const out = await contract.functionCall({
    contractId: CONTRACT_ID,
    methodName: "migrate",
    args: {},
    attachedDeposit: "0",
    gas: "300000000000000",
  });
  console.log("  migrated:", out?.status ?? out);

  const model = await contract.viewFunction({ contractId: CONTRACT_ID, methodName: "player_model", args: {} });
  console.log(`player_model -> ${model}`);
  if (model !== "per-account") throw new Error(`unexpected player model: ${model}`);
  console.log("done: per-account play is now live. Public site play buttons will activate.");
}

main().catch((e) => {
  console.error("upgrade failed:", e.message);
  process.exit(1);
});
