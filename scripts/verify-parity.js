// Live parity check (Gate G): prove the DEPLOYED contract reproduces the
// reference engine, not just the in-wasm unit tests.
//
//   node scripts/verify-parity.js
//
// Resets the town, advances 30 days with no player intervention, then compares
// the on-chain state of every merchant on every day against
// contract/testdata/golden_baseline.json (120 rows: cash / inventory / list
// price / life state). Exits non-zero on the first mismatch.
//
// NOTE: this rewrites on-chain state. Re-run `node driver/demo.js` afterwards
// to restore the lifecycle story for a demo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectTown, getState, tick } from "../driver/town.js";
import { call, loadIdentities } from "../driver/near.js";
import { CONTRACT_ID } from "../driver/town.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(
  fs.readFileSync(path.join(root, "contract/testdata/golden_baseline.json"), "utf8")
);
// golden[key] = {cash, inv, list, state}
const key = (day, merchant) => `${day}|${merchant}`;
const expected = new Map(golden.map((r) => [key(r.day, r.merchant), r]));

const near = await connectTown();
const ids = loadIdentities();

console.log(`Resetting ${CONTRACT_ID} ...`);
await call(near, ids.owner.accountId, CONTRACT_ID, "reset", {});

let checked = 0;
let mismatches = 0;
for (let day = 1; day <= 30; day++) {
  await tick(near, "owner");
  const s = await getState(near);
  if (s.day !== day) {
    console.error(`  day drift: expected ${day}, chain reports ${s.day}`);
    mismatches++;
    break;
  }
  for (const m of s.merchants) {
    const exp = expected.get(key(day, m.id));
    if (!exp) continue;
    const got = {
      cash: m.cash,
      inv: m.inventory?.[m.specialty] ?? 0,
      list: m.list_price?.[m.specialty] ?? null,
      state: m.state,
    };
    checked++;
    const bad =
      got.cash !== exp.cash ||
      got.inv !== exp.inv ||
      got.list !== exp.list ||
      got.state !== exp.state;
    if (bad) {
      mismatches++;
      console.error(`  MISMATCH day ${day} ${m.id}: got ${JSON.stringify(got)} expected ${JSON.stringify({ cash: exp.cash, inv: exp.inv, list: exp.list, state: exp.state })}`);
    }
  }
  if (day % 5 === 0) console.log(`  day ${day}: ${checked} rows checked, ${mismatches} mismatches`);
}

const verdict = mismatches === 0 ? "PASS" : "FAIL";
console.log(`\nLive parity: ${verdict} — ${checked} rows compared, ${mismatches} mismatches.`);
process.exit(mismatches === 0 ? 0 : 1);
