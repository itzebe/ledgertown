// Pure game logic for Ledgertown.
//
// A *reading* of real contract state that turns the market into things a player
// can act on: what your purse is worth, where a good is cheap to buy and dear to
// sell, and what the town's own numbers say you should try next. Every figure is
// derived from on-chain fields; nothing here invents a price, a goal or a reward.
//
// Dependency-free and I/O-free so it can be unit-tested offline (tests/game.test.js)
// and shared by the browser and any server-side rendering.
import { GOODS, merchantRead } from "./economy.js";

const BY_GOOD = Object.fromEntries(GOODS.map((g) => [g.good, g]));

/** Value one unit of a good at its fixed reference price. Used only to put a
 *  number on cargo; it is the same constant the contract's rules use, not a
 *  live quote. */
export function unitValue(good) {
  return BY_GOOD[good]?.ref ?? 0;
}

/** Mark-to-reference value of a purse's cargo. */
export function cargoValue(player) {
  const inv = player?.inventory || {};
  let total = 0;
  for (const [good, units] of Object.entries(inv)) total += unitValue(good) * (units || 0);
  return total;
}

/** Net worth = credits + cargo valued at reference prices. The player's single
 *  progress number; both terms come straight from the contract. */
export function netWorth(player) {
  return (player?.cash ?? 0) + cargoValue(player);
}

/**
 * Where to buy and where to sell one good, from the real open-shop quotes.
 * `buy`  = cheapest list price (what you pay to buy from a shop)
 * `sell` = highest bid price   (what a shop pays you for the good)
 * A positive `spread` means buying at `buy.from` and selling at `sell.to`
 * clears a profit of `spread` per unit before you even gather anything.
 */
export function tradeSignal(merchants, good) {
  let buy = null;
  let sell = null;
  for (const m of merchants) {
    if (m.state !== "open") continue;
    const list = m.list_price?.[good];
    const bid = m.bid_price?.[good];
    if (typeof list === "number" && (buy === null || list < buy.price)) {
      buy = { id: m.id, name: m.name, price: list };
    }
    if (typeof bid === "number" && (sell === null || bid > sell.price)) {
      sell = { id: m.id, name: m.name, price: bid };
    }
  }
  const spread = buy && sell ? sell.price - buy.price : null;
  return { good, buy, sell, spread, arbitrage: spread != null && spread > 0 };
}

/** Trade signals for every good, best spread first. */
export function tradeSignals(merchants = []) {
  return GOODS.map(({ good }) => tradeSignal(merchants, good))
    .sort((a, b) => (b.spread ?? -Infinity) - (a.spread ?? -Infinity));
}

/**
 * Dynamic challenges derived from the live town. Each is checkable against real
 * state and states the exact numbers the player is working with. We surface at
 * most three, most actionable first.
 */
export function challenges(state, player) {
  const merchants = state?.merchants || [];
  const out = [];

  // 1. Arbitrage: a good a shop sells below what another shop pays for it.
  const signals = tradeSignals(merchants).filter((s) => s.arbitrage);
  if (signals.length) {
    const s = signals[0];
    out.push({
      id: "arbitrage",
      title: `Move ${s.good}`,
      detail:
        `${s.buy.name} sells ${s.good} at ${s.buy.price}; ${s.sell.name} pays ${s.sell.price}. ` +
        `Buy at ${s.buy.name} and sell to ${s.sell.name} for ${s.spread}/unit.`,
      good: s.good,
      from: s.buy.id,
      to: s.sell.id,
    });
  }

  // 2. Rescue: a shop that cannot restock (below reserve) or has closed.
  const closed = merchants.find((m) => m.state === "closed");
  const thin = merchants
    .map((m) => ({ m, r: merchantRead(m) }))
    .filter((x) => x.m.state === "open" && (x.m.cash ?? 0) < x.r.reserve)
    .sort((a, b) => a.m.cash - b.m.cash)[0];
  if (closed) {
    const r = merchantRead(closed);
    const need = Math.max(0, r.reserve - (closed.cash ?? 0));
    out.push({
      id: "rescue",
      title: `Revive ${closed.name}`,
      detail: `${closed.name} is closed. Invest ${need || r.reserve} credits to fund it back over the ${r.reserve} line and it reopens on-chain.`,
      merchant: closed.id,
      need,
    });
  } else if (thin) {
    out.push({
      id: "supply",
      title: `Supply ${thin.m.name}`,
      detail: `${thin.m.name} holds ${thin.m.cash} credits — below its ${thin.r.reserve} reserve, so it will not restock. Sell it ${thin.m.specialty} to lift it back over the line.`,
      merchant: thin.m.id,
      good: thin.m.specialty,
    });
  }

  // 3. Gather: a free, always-available opening move for an empty purse.
  if (!player || (player.cash ?? 0) === 0) {
    const g = GOODS.map((x) => x.good);
    out.push({
      id: "gather",
      title: "Gather to start",
      detail: `Gathering is free. Gather ${g[0]} (or any good), then sell it to a shop for credits.`,
      good: g[0],
    });
  }

  return out.slice(0, 3);
}

/** A one-line honest read of a purse for the header. */
export function purseSummary(player) {
  if (!player) return { net: 0, cash: 0, cargo: 0, hasPurse: false };
  return {
    net: netWorth(player),
    cash: player.cash ?? 0,
    cargo: cargoValue(player),
    hasPurse: true,
  };
}
