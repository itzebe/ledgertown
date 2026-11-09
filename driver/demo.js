// Ledgertown lifecycle demo (Gate F) — runs on REAL NEAR testnet.
//
//   node driver/demo.js
//
// Reproduces the validated scenario `09_demo_flood` end to end on-chain:
//   healthy trading -> player floods iron -> iron demand collapses ->
//   the smith goes insolvent and CLOSES -> the player invests -> the smith
//   REOPENS -> it trades its way back to health.
//
// Every step is a real signed transaction; the run log records each tx hash
// and the on-chain event trail. Nothing is scripted or mocked.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectTown,
  getState,
  tick,
  deposit,
  gather,
  sell,
  invest,
  addShock,
  setLifeline,
  ownerWithdraw,
  CONTRACT_ID,
} from "./town.js";
import { call, txHash, loadIdentities, transfer, balanceNear, ensureFunded } from "./near.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const log = { contract: CONTRACT_ID, steps: [], txs: [], snapshots: [] };

function rec(label, hash, detail = {}) {
  log.steps.push({ label, hash, ...detail });
  if (hash) log.txs.push({ label, hash });
  const extra = detail.note ? `  ${detail.note}` : "";
  console.log(`  ${label.padEnd(34)} ${hash || ""}${extra}`);
}

async function ownerReset(near) {
  const ids = loadIdentities();
  const out = await call(near, ids.owner.accountId, CONTRACT_ID, "reset", {});
  return txHash(out);
}

function summarize(state) {
  return state.merchants.map((m) => ({
    id: m.id,
    cash: m.cash,
    inv: m.inventory?.[m.specialty] ?? 0,
    list: m.list_price?.[m.specialty] ?? null,
    bid: m.bid_price?.[m.specialty] ?? null,
    state: m.state,
    markup_bp: m.markup_bp,
    reopened: m.reopened,
    last: m.last_decision,
  }));
}

async function snap(near, label) {
  const s = await getState(near);
  const row = { label, day: s.day, player_cash: s.player.cash, merchants: summarize(s) };
  log.snapshots.push(row);
  console.log(`  [${label}] day=${s.day} player=${s.player.cash}`);
  for (const m of row.merchants) {
    console.log(
      `     ${m.id.padEnd(7)} cash=${String(m.cash).padStart(5)} inv=${String(m.inv).padStart(3)} ` +
        `list=${String(m.list).padStart(3)} bid=${String(m.bid).padStart(3)} ${m.state}` +
        (m.reopened ? ` (reopened ${m.reopened})` : "")
    );
  }
  return row;
}

async function main() {
  const near = await connectTown();
  console.log("=== LEDGERTOWN LIFECYCLE DEMO (NEAR testnet) ===\n");

  // Keep the owner funded so the demo is repeatable; the owner pays gas and
  // funds the player's first deposit. Prefer the free faucet; if it is rate
  // limited, withdraw unallocated testnet NEAR back from the contract.
  {
    const ids = loadIdentities();
    const bal = await balanceNear(near, ids.owner.accountId);
    if (bal < 8) {
      try {
        const f = await ensureFunded(near, ids.owner.accountId, 8, 20);
        if (f.funded) console.log(`  owner topped up ${f.top} NEAR from faucet (tx ${f.hash})\n`);
      } catch (e) {
        const amount = (20 - bal).toFixed(3);
        const { hash } = await ownerWithdraw(near, amount);
        console.log(`  faucet unavailable (${String(e.message).slice(0, 40)}); withdrew ${amount} NEAR from contract (tx ${hash})\n`);
      }
    }
  }

  // --- Phase 0: reset to a known start, disable the automatic lifeline ----
  console.log("Phase 0 — reset + disable lifeline");
  rec("reset", await ownerReset(near));
  rec("set_lifeline(false)", (await setLifeline(near, false)).hash);
  await snap(near, "start");

  // --- Phase 1: the player deposits NEAR for credits ---------------------
  console.log("\nPhase 1 — player deposits NEAR (real transfer -> credits)");
  {
    const ids = loadIdentities();
    const bal = await balanceNear(near, ids.player.accountId);
    if (bal < 6) {
      const top = (8 - bal).toFixed(3);
      rec(`fund player ${top} NEAR from owner`, txHash(await transfer(near, ids.owner.accountId, ids.player.accountId, top)));
    }
  }
  rec("player_deposit(5 NEAR)", (await deposit(near, "5", "player")).hash);
  await snap(near, "after-deposit");

  // --- Phase 2: healthy trading (baseline engine) ------------------------
  console.log("\nPhase 2 — 15 days of healthy trading");
  for (let d = 0; d < 15; d++) {
    const r = await tick(near, "owner");
    if (d === 0 || d === 14) rec(`tick (day ${d + 1})`, r.hash);
  }
  await snap(near, "healthy");

  // --- Phase 3: the flood — the player dumps iron on the smith -----------
  console.log("\nPhase 3 — the player floods the smith with iron (days 16-24)");
  rec(
    "add_shock iron demand x0.15 (18-28)",
    (await addShock(near, "demand", "iron", 15, 100, 18, 28)).hash
  );
  let refused = 0;
  for (let d = 16; d <= 24; d++) {
    await gather(near, "iron", 25, "player");
    let soldHash = null;
    try {
      soldHash = (await sell(near, "smith", "iron", 25, "player")).hash;
    } catch (e) {
      // The smith refuses once its cash falls below its 2x fixed-cost reserve —
      // an intended economic constraint, not a failure of the demo.
      refused += 1;
    }
    const t = await tick(near, "owner");
    if (d === 16 || d === 20 || d === 22 || d === 24) {
      rec(`day ${d}: gather${soldHash ? "+sell" : " (smith refused)"}+tick`, t.hash, {
        note: soldHash ? `sell ${soldHash.slice(0, 8)}` : `refusals so far: ${refused}`,
      });
    }
    const st = await getState(near);
    const smith = st.merchants.find((m) => m.id === "smith");
    if (smith.state === "closed") {
      console.log(`  >>> smith CLOSED on day ${st.day} (cash ${smith.cash}) after ${refused} refusals`);
      break;
    }
  }
  await snap(near, "after-flood");

  // --- Phase 3b: let the demand shock lapse (market recovers) ------------
  console.log("\nPhase 3b — tick past the shock window (market recovers)");
  {
    let day = (await getState(near)).day;
    while (day < 31) {
      const r = await tick(near, "owner");
      day = (await getState(near)).day;
      if (day === 31) rec("tick to day 31 (shock over)", r.hash);
    }
  }
  await snap(near, "shock-over");

  // --- Phase 4: insolvency confirmed -------------------------------------
  console.log("\nPhase 4 — confirm insolvency");
  {
    const st = await getState(near);
    const smith = st.merchants.find((m) => m.id === "smith");
    const closedEvt = st.events.find((e) => e.kind === "CLOSED" && e.merchant === "smith");
    console.log(
      `  smith state=${smith.state}` + (closedEvt ? ` (CLOSED day ${closedEvt.day}, cash ${closedEvt.value})` : "")
    );
    rec("observe", null, { note: `smith=${smith.state}` });
  }

  // --- Phase 5: the player invests to revive the smith -------------------
  console.log("\nPhase 5 — the player invests to reopen the smith");
  {
    const st = await getState(near);
    const smith = st.merchants.find((m) => m.id === "smith");
    if (st.player.cash < 220) {
      rec("player_deposit(3 NEAR) top-up", (await deposit(near, "3", "player")).hash);
    }
    if (smith.state === "closed") {
      rec("player_invest(smith,200)", (await invest(near, "smith", 200, "player")).hash);
    } else {
      console.log("  smith not closed; skipping investment");
    }
  }
  await snap(near, "after-invest");

  // --- Phase 6: recovery -------------------------------------------------
  console.log("\nPhase 6 — 20 days of recovery");
  for (let d = 0; d < 20; d++) {
    const r = await tick(near, "owner");
    if (d === 0 || d === 19) {
      const day = (await getState(near)).day;
      rec(`recovery tick (day ${day})`, r.hash);
    }
  }
  const final = await snap(near, "final");

  // --- event trail -------------------------------------------------------
  const st = await getState(near);
  console.log("\n=== ON-CHAIN EVENT TRAIL ===");
  for (const e of st.events) {
    console.log(`  day ${String(e.day).padStart(2)}  ${e.merchant.padEnd(7)} ${e.kind.padEnd(16)} ${e.value}  ${e.note}`);
  }

  const smith = final.merchants.find((m) => m.id === "smith");
  const reopened = st.events.some((e) => e.kind === "REOPENED" && e.merchant === "smith");
  const closed = st.events.some((e) => e.kind === "CLOSED" && e.merchant === "smith");
  const verdict = closed && reopened && smith.state === "open" ? "PASS" : "INCOMPLETE";
  console.log(`\nLifecycle verdict: ${verdict} (closed=${closed} reopened=${reopened} final=${smith.state})`);

  log.verdict = verdict;
  log.final = final;
  log.events = st.events;
  fs.writeFileSync(path.join(root, "demo-log.json"), JSON.stringify(log, null, 2));
  console.log(`\nwrote demo-log.json (${log.txs.length} transactions recorded)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
