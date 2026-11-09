// Constrained AI merchant agent (Gate E).
//
// Each merchant runs a small, transparent economic policy. The agent READS the
// real on-chain state of its own shop and proposes a decision, then submits it
// through `merchant_decide` — which the contract validates against real cash,
// inventory and the reserve rule. The agent never invents balances: it only
// proposes, and the chain decides.
//
//   node driver/agent.js            # run one round for all four merchants
//   node driver/agent.js --rounds 5
import { connectTown, getState, decide, tick } from "./town.js";

const TARGET_MARKUP_BP = 2200;
const STEP_BP = 200;
const MIN_MARKUP_BP = 500;
const MAX_MARKUP_BP = 6000;

// RULES.md: target stock = 2 * base demand for the good.
const DBASE = { grain: 16, iron: 9, cloth: 6, ale: 11 };

/**
 * Pure decision function: given this merchant's real state and the current
 * market, return {kind, arg, reason}. This is the entire "AI" — deterministic,
 * inspectable, and constrained by construction.
 */
export function decideForMe(me, rivals, goods) {
  const good = me.specialty;
  const target = 2 * DBASE[good];
  const inv = me.inventory?.[good] ?? 0;
  const reserve = 2 * me.fixed_cost;
  const unitCost = goods[good].cost;
  const affordable = Math.max(0, Math.floor((me.cash - reserve) / unitCost));
  const openRivals = rivals.filter((r) => r.id !== me.id && r.state === "open");
  const myPrice = me.list_price?.[good] ?? 0;
  const rivalPrices = openRivals
    .map((r) => r.list_price?.[good])
    .filter((p) => typeof p === "number" && p > 0);
  const cheapestRival = rivalPrices.length ? Math.min(...rivalPrices) : null;

  // 1. Insolvency pressure: if we cannot cover the reserve, just hold.
  if (me.cash < reserve) {
    return { kind: "hold", arg: 0, reason: `cash ${me.cash} below reserve ${reserve}` };
  }

  // 2. Stock-out: restock up to what cash genuinely allows.
  if (inv < target) {
    const want = Math.min(target - inv, affordable);
    if (want > 0) {
      return {
        kind: "restock_extra",
        arg: want,
        reason: `stock ${inv}<${target}, cash ${me.cash} affords ${affordable}`,
      };
    }
    return { kind: "hold", arg: 0, reason: `stock ${inv}<${target} but cash affords 0` };
  }

  // 3. Competition: undercut the cheapest rival; else relax toward target.
  if (cheapestRival !== null && myPrice > cheapestRival) {
    const next = Math.max(MIN_MARKUP_BP, me.markup_bp - STEP_BP);
    return {
      kind: "set_markup",
      arg: next,
      reason: `price ${myPrice} > cheapest rival ${cheapestRival}; undercut`,
    };
  }
  if (me.markup_bp > TARGET_MARKUP_BP) {
    return {
      kind: "set_markup",
      arg: TARGET_MARKUP_BP,
      reason: `already cheapest; relax markup ${me.markup_bp}->${TARGET_MARKUP_BP}`,
    };
  }
  // 4. Excess stock and no rival pressure: trim price to clear it.
  if (inv > target && me.markup_bp > MIN_MARKUP_BP) {
    return {
      kind: "set_markup",
      arg: Math.max(MIN_MARKUP_BP, me.markup_bp - STEP_BP),
      reason: `overstock ${inv}>${target}; trim markup`,
    };
  }
  return { kind: "hold", arg: 0, reason: "position is healthy" };
}

async function runRound(near) {
  const state = await getState(near);
  const goods = {
    grain: { cost: 10 },
    iron: { cost: 17 },
    cloth: { cost: 27 },
    ale: { cost: 12 },
  };
  const results = [];
  for (const me of state.merchants) {
    const d = decideForMe(me, state.merchants, goods);
    let tx = null;
    let error = null;
    try {
      tx = (await decide(near, me.id, d.kind, d.arg)).hash;
    } catch (e) {
      error = String(e.message).slice(0, 120);
    }
    results.push({ id: me.id, ...d, tx, error });
  }
  return results;
}

async function main() {
  const rounds = Number(process.argv[process.argv.indexOf("--rounds") + 1]) || 1;
  const near = await connectTown();
  for (let r = 0; r < rounds; r++) {
    console.log(`\n=== agent round ${r + 1} ===`);
    const res = await runRound(near);
    for (const x of res) {
      const status = x.error ? `ERR ${x.error}` : `tx ${x.tx}`;
      console.log(`  ${x.id.padEnd(7)} ${x.kind.padEnd(14)} arg=${String(x.arg).padEnd(6)} (${x.reason})  ${status}`);
    }
    if (r < rounds - 1) await tick(near, "owner");
  }
  // show what the contract recorded
  const state = await getState(near);
  console.log("\nOn-chain decisions:");
  for (const m of state.merchants) {
    console.log(`  ${m.id.padEnd(7)} markup=${m.markup_bp}bp  last="${m.last_decision}"`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
