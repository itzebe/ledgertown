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

/** Per-shop trade headroom, derived from real state and the contract's own
 *  spend rules. Returns the numbers a trade preview needs: the stock a shop can
 *  actually sell you, and the goods it can actually pay for. */
export function tradeHeadroom(m) {
  const fixed = m.fixed_cost ?? 0;
  const reserve = RESERVE_MULT * fixed;
  const cash = m.cash ?? 0;
  // sell_to: `spendable = (cash - 2*fixed).max(0)`; affordable = spendable / bid
  const spendable = Math.max(0, cash - reserve);
  const buyBid = (good) => {
    const bid = m.bid_price?.[good];
    if (typeof bid !== "number" || bid <= 0) return { bid: null, affordable: 0 };
    return { bid, affordable: Math.floor(spendable / bid) };
  };
  const sellUnits = (good) => {
    // The contract's room is `STOCK_MAX - inv` (floored at 0) — how many units
    // the shop can still take before it is full.
    const inv = m.inventory?.[good] ?? 0;
    return Math.max(0, STOCK_MAX - inv);
  };
  return { reserve, spendable, buyBid, sellUnits };
}

/** A pre-trade quote: exactly what the contract would do, computed from the
 *  same state the contract reads. Never a promise — the trade preview shows it
 *  as "if it lands", and the real outcome comes from the chain. */
export function quote(state, action, args = {}) {
  const player = state?.player || {};
  const merchants = state?.merchants || [];
  const cash = player.cash ?? 0;
  const inv = player.inventory || {};

  if (action === "gather") {
    const good = String(args.good ?? "");
    const units = Math.max(0, Math.trunc(Number(args.units) || 0));
    if (!BY_GOOD[good]) return { ok: false, error: `unknown good "${good}"` };
    return {
      ok: true, kind: "gather", good, units, free: true,
      note: "Gathering is free and adds the units to your cargo.",
    };
  }

  if (action === "buy" || action === "sell") {
    const good = String(args.good ?? "");
    const units = Math.max(0, Math.trunc(Number(args.units) || 0));
    const m = merchants.find((x) => x.id === args.merchant);
    if (!m) return { ok: false, error: "unknown merchant" };
    if (!BY_GOOD[good]) return { ok: false, error: `unknown good "${good}"` };
    if (m.state !== "open") return { ok: false, error: `${m.name} is closed — it is not trading` };

    const price = m.list_price?.[good];
    const bid = m.bid_price?.[good];

    if (action === "buy") {
      if (typeof price !== "number") return { ok: false, error: `${m.name} does not quote ${good}` };
      const available = m.inventory?.[good] ?? 0;
      const executable = Math.min(units, available);
      const total = executable * price;
      const affordable = Math.floor(cash / price);
      const willBuy = Math.min(executable, affordable);
      return {
        ok: true, kind: "buy", merchant: m.id, name: m.name, good, units, price,
        available, executable, willBuy, total, cost: willBuy * price,
        cashAfter: cash - willBuy * price,
        inventoryAfter: (inv[good] ?? 0) + willBuy,
        limitedBy: willBuy < units ? (willBuy < executable ? "credits" : "stock") : null,
      };
    }

    // sell: the contract's own three limits — your stock, the shop's room, and
    // the shop's spendable cash at the current bid.
    if (typeof bid !== "number") return { ok: false, error: `${m.name} does not quote ${good}` };
    const have = inv[good] ?? 0;
    const h = tradeHeadroom(m);
    const room = h.sellUnits(good);
    const { affordable } = h.buyBid(good);
    const willSell = Math.min(units, have, room, affordable);
    // Name the constraint that actually binds: the smallest of the three limits.
    const binding = [
      { k: "cargo", v: have },
      { k: "shop stock room", v: room },
      { k: "shop cash", v: affordable },
    ].reduce((a, b) => (b.v < a.v ? b : a));
    return {
      ok: true, kind: "sell", merchant: m.id, name: m.name, good, units, bid,
      have, room, affordable, willSell, proceeds: willSell * bid,
      cashAfter: cash + willSell * bid,
      inventoryAfter: have - willSell,
      limitedBy: willSell < units ? binding.k : null,
    };
  }

  if (action === "invest") {
    const amount = Math.max(0, Math.trunc(Number(args.amount) || 0));
    const m = merchants.find((x) => x.id === args.merchant);
    if (!m) return { ok: false, error: "unknown merchant" };
    if (m.state !== "closed") return { ok: false, error: `${m.name} is open — investment is for closed shops` };
    const threshold = RESERVE_MULT * (m.fixed_cost ?? 0);
    const funded = (m.cash ?? 0) + amount;
    const shortfall = Math.max(0, threshold - funded);
    return {
      ok: true, kind: "invest", merchant: m.id, name: m.name, amount, threshold,
      shopCash: m.cash ?? 0, funded, reopens: funded >= threshold, shortfall,
      cashAfter: cash - amount,
    };
  }

  return { ok: false, error: `no quote for "${action}"` };
}

/** What actually changed, from the contract's own record. The caller passes the
 *  state before the action, the state after, and the newest event the contract
 *  emitted (from `get_events`). Everything here is read, never assumed: a field
 *  is only reported when a real value supports it. */
export function receipt(before, after, event) {
  const out = { event: event || null, changes: [] };
  if (!after) return out;

  const b = before?.player || {};
  const a = after.player || {};
  if (b.cash != null && a.cash != null && b.cash !== a.cash) {
    out.changes.push({ label: "credits", from: b.cash, to: a.cash, delta: a.cash - b.cash });
  }
  const binv = b.inventory || {};
  const ainv = a.inventory || {};
  for (const good of Object.keys({ ...binv, ...ainv })) {
    const from = binv[good] ?? 0;
    const to = ainv[good] ?? 0;
    if (from !== to) out.changes.push({ label: good, from, to, delta: to - from });
  }
  if (b.deposited_yocto != null && a.deposited_yocto != null && b.deposited_yocto !== a.deposited_yocto) {
    out.changes.push({ label: "deposited", from: b.deposited_yocto, to: a.deposited_yocto, delta: a.deposited_yocto - b.deposited_yocto });
  }

  const mid = event?.merchant;
  const bm = (before?.merchants || []).find((x) => x.id === mid);
  const am = (after.merchants || []).find((x) => x.id === mid);
  if (bm && am) {
    const mc = { id: am.id, name: am.name, stateFrom: bm.state, stateTo: am.state, cashFrom: bm.cash, cashTo: am.cash };
    const good = am.specialty;
    mc.invFrom = bm.inventory?.[good] ?? 0;
    mc.invTo = am.inventory?.[good] ?? 0;
    mc.changed = mc.stateFrom !== mc.stateTo || mc.cashFrom !== mc.cashTo || mc.invFrom !== mc.invTo;
    out.merchant = mc;
  }
  return out;
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
