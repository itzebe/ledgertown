// Pure economic derivations for the Ledgertown interface.
//
// Everything here is a *reading* of real contract state — it computes signals a
// human can see (who is cheapest, how close a shop is to insolvency, how scarce a
// good is) from the same numbers the contract already stores. It never invents a
// balance, a price or a decision; it only divides and compares what is on-chain.
//
// Kept dependency-free and I/O-free so it can be unit-tested offline
// (tests/economy.test.js) and shared by the long-running server and the Vercel
// entry point.

/** Goods table, mirroring `GOODS` in contract/src/lib.rs and §4.1 of
 *  feasibility/RULES.md: [name, reference price, restock unit cost, base daily
 *  demand]. These are fixed constants of the economic rules, not live values. */
export const GOODS = [
  { good: "grain", ref: 12, cost: 10, dbase: 16 },
  { good: "iron", ref: 21, cost: 17, dbase: 9 },
  { good: "cloth", ref: 33, cost: 27, dbase: 6 },
  { good: "ale", ref: 15, cost: 12, dbase: 11 },
];

export const GOOD_NAMES = GOODS.map((g) => g.good);

/** Hard stock ceiling the contract enforces (`STOCK_MAX`). */
export const STOCK_MAX = 400;

/** A merchant reserves `2 * fixed_cost` before it will buy stock (contract rule). */
export const RESERVE_MULT = 2;

const BY_GOOD = Object.fromEntries(GOODS.map((g) => [g.good, g]));

/** Target stock the contract restocks toward: twice base daily demand. */
export function stockTarget(good) {
  const g = BY_GOOD[good];
  return g ? 2 * g.dbase : 0;
}

function safeDiv(n, d) {
  return d > 0 ? n / d : null;
}

/** Derive a single merchant's trading position from its real on-chain fields.
 *  Returns numbers only — no labels that could drift from the contract's rules. */
export function merchantRead(m) {
  const good = m.specialty;
  const target = stockTarget(good);
  const reserve = RESERVE_MULT * (m.fixed_cost ?? 0);
  const inv = m.inventory?.[good] ?? 0;
  const basis = m.cost_basis?.[good] ?? 0;
  const avgCost = inv > 0 ? Math.round(basis / inv) : (BY_GOOD[good]?.ref ?? 0);
  const list = m.list_price?.[good] ?? null;
  const bid = m.bid_price?.[good] ?? null;
  const margin = list != null ? list - avgCost : null;
  const marginPct = margin != null && avgCost > 0 ? Math.round((margin / avgCost) * 100) : null;
  const cashRatio = safeDiv(m.cash, reserve);
  const stockRatio = target > 0 ? inv / target : null;

  let health;
  if (m.state === "closed") health = "closed";
  else if (m.cash < 0) health = "insolvent";
  else if (m.cash < (m.fixed_cost ?? 0)) health = "distressed";
  else if (m.cash < reserve) health = "thin";
  else health = "healthy";

  return {
    good, target, reserve, inv, avgCost, list, bid, margin, marginPct,
    cashRatio, stockRatio, health,
  };
}

/** Comparative price board: for each good, every open shop that quotes it,
 *  ordered cheapest-first, with the leader (and the dearest) marked. This is
 *  what makes price competition legible. */
export function priceBoard(merchants = []) {
  const board = {};
  for (const { good } of GOODS) {
    const quotes = [];
    for (const m of merchants) {
      if (m.state !== "open") continue;
      const price = m.list_price?.[good];
      const bid = m.bid_price?.[good];
      if (typeof price !== "number") continue;
      quotes.push({ id: m.id, name: m.name, price, bid: typeof bid === "number" ? bid : null });
    }
    quotes.sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
    const cheapest = quotes.length ? quotes[0].price : null;
    const dearest = quotes.length ? quotes[quotes.length - 1].price : null;
    board[good] = quotes.map((q) => ({
      ...q,
      cheapest: cheapest != null && q.price === cheapest,
      dearest: dearest != null && dearest !== cheapest && q.price === dearest,
    }));
  }
  return board;
}

/** Scarcity read: total open-shop stock of each good versus base daily demand,
 *  expressed as "days of cover". Below one day is scarce; a large surplus is
 *  oversupplied. Derived from summed real inventory. */
export function scarcity(merchants = []) {
  const out = {};
  for (const { good, dbase } of GOODS) {
    let stock = 0;
    let shops = 0;
    for (const m of merchants) {
      if (m.state !== "open") continue;
      const inv = m.inventory?.[good] ?? 0;
      if (inv > 0) shops += 1;
      stock += inv;
    }
    const daysOfCover = dbase > 0 ? stock / dbase : null;
    let verdict;
    if (stock === 0) verdict = "none";
    else if (daysOfCover < 1) verdict = "scarce";
    else if (daysOfCover < 2) verdict = "tight";
    else if (daysOfCover > 8) verdict = "glut";
    else verdict = "stocked";
    out[good] = { stock, shops, dbase, daysOfCover, verdict };
  }
  return out;
}

/** Town-level summary derived from real state. */
export function townSummary(state = {}) {
  const merchants = state.merchants || [];
  const open = merchants.filter((m) => m.state === "open").length;
  const closed = merchants.filter((m) => m.state === "closed").length;
  const cash = merchants.reduce((s, m) => s + (m.cash ?? 0), 0);
  return { open, closed, total: merchants.length, cash };
}

/** A one-line, honest read of where this shop stands and what would change it.
 *  Every clause is derived from the contract's own numbers and rules — the
 *  closure condition (cash below fixed cost for days with no sales), the
 *  reserve rule (2x fixed cost) and the revival threshold (cash >= 2x fixed
 *  cost). It states the real mechanic, never a fabricated goal. */
export function riskNote(m, r) {
  if (m.state === "closed") {
    const need = Math.max(0, r.reserve - (m.cash ?? 0));
    return {
      level: "closed",
      text: `Closed on day ${m.closed_on ?? "?"}. Funded to ${r.reserve} it reopens — ` +
        `${need > 0 ? `${need} more credits needed` : "already at the threshold"}.`,
    };
  }
  if ((m.cash ?? 0) < 0) {
    return { level: "critical", text: `Cash is negative — the contract closes a shop in this state.` };
  }
  if ((m.cash ?? 0) < (m.fixed_cost ?? 0)) {
    return {
      level: "critical",
      text: `Cannot cover tomorrow's fixed cost of ${m.fixed_cost} — ` +
        `it closes after ${3 - (m.bankrupt_days ?? 0)} more days with no sales.`,
    };
  }
  if ((m.cash ?? 0) < r.reserve) {
    return {
      level: "warn",
      text: `Below the ${r.reserve}-credit reserve, so it will not buy stock — ` +
        `selling it goods lifts its cash back over the line.`,
    };
  }
  return { level: "ok", text: `Covering fixed costs with room to restock.` };
}

/** Assemble the full derived read attached to /api/state. */
export function marketRead(state = {}) {
  const merchants = state.merchants || [];
  const reads = {};
  const risk = {};
  for (const m of merchants) {
    const r = merchantRead(m);
    reads[m.id] = r;
    risk[m.id] = riskNote(m, r);
  }
  return {
    summary: townSummary(state),
    board: priceBoard(merchants),
    scarcity: scarcity(merchants),
    merchants: reads,
    risk,
  };
}
