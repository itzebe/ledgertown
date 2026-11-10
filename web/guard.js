// Pure, dependency-free helpers for the public play server.
//
// Everything here is deterministic and I/O-free so it can be unit-tested
// offline (see tests/guard.test.js). The server composes these; it does not
// re-implement them.

export const GOODS = ["grain", "iron", "cloth", "ale"];

/** The only actions the public server will ever sign. `deposit` is absent on
 *  purpose: it attaches real NEAR, so a shared public key must never call it.
 *  Owner-only methods (`reset`, `add_shock`, `owner_withdraw`,
 *  `set_lifeline_enabled`, `seed_merchant`) are never exposed at all. */
export const PUBLIC_ACTIONS = ["tick", "gather", "buy", "sell", "invest"];

/** Max days a single fast-forward request may advance. The UI asks for 7. */
export const MAX_ADVANCE_DAYS = 7;
export const MAX_UNITS = 50; // contract caps gather at 1..=50 per call
export const MAX_INVEST = 100000;

/** Validate and normalise one public action. Returns
 *  `{ ok: true, action, args }` or `{ ok: false, error }`.
 *  Pure: no clock, no network, no mutation. */
export function validateAction(action, body = {}) {
  if (!PUBLIC_ACTIONS.includes(action)) {
    return { ok: false, error: `action "${action}" is not available publicly` };
  }
  if (action === "tick") return { ok: true, action, args: {} };

  if (action === "gather") {
    const good = String(body.good ?? "");
    if (!GOODS.includes(good)) return { ok: false, error: `unknown good "${good}"` };
    const units = toInt(body.units);
    if (units === null || units < 1 || units > MAX_UNITS) {
      return { ok: false, error: `units must be an integer 1..${MAX_UNITS}` };
    }
    return { ok: true, action, args: { good, units } };
  }

  if (action === "buy" || action === "sell") {
    const merchant = String(body.merchant ?? "");
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(merchant)) {
      return { ok: false, error: "invalid merchant id" };
    }
    const good = String(body.good ?? "");
    if (!GOODS.includes(good)) return { ok: false, error: `unknown good "${good}"` };
    const units = toInt(body.units);
    if (units === null || units < 1 || units > MAX_UNITS) {
      return { ok: false, error: `units must be an integer 1..${MAX_UNITS}` };
    }
    return { ok: true, action, args: { merchant, good, units } };
  }

  if (action === "invest") {
    const merchant = String(body.merchant ?? "");
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(merchant)) {
      return { ok: false, error: "invalid merchant id" };
    }
    const amount = toInt(body.amount);
    if (amount === null || amount < 1 || amount > MAX_INVEST) {
      return { ok: false, error: `amount must be an integer 1..${MAX_INVEST}` };
    }
    return { ok: true, action, args: { merchant, amount } };
  }

  return { ok: false, error: "unreachable" };
}

/** Parse a fast-forward request into a whole number of days in 1..MAX. */
export function validateAdvance(body = {}) {
  const days = toInt(body.days);
  if (days === null || days < 1 || days > MAX_ADVANCE_DAYS) {
    return { ok: false, error: `days must be an integer 1..${MAX_ADVANCE_DAYS}` };
  }
  return { ok: true, days };
}

/** Strict integer parse: rejects floats, exponents, "1e3", "1.5", NaN, "". */
export function toInt(v) {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  if (typeof v !== "string") return null;
  if (!/^-?\d+$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return Number.isSafeInteger(n) ? n : null;
}

/** A plausible NEAR account id: 2..64 chars, lowercase alphanumeric words
 *  separated by `-`/`_`/`.`, each word starting and ending alphanumeric.
 *  Used only to bound the `/api/player` lookup argument; the value is passed
 *  as a view argument (never a command), so this is a shape check, not a
 *  security boundary. */
export function isValidAccount(v) {
  if (typeof v !== "string") return false;
  if (v.length < 2 || v.length > 64) return false;
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(v);
}

/** Translate a contract `last_decision` string into plain language, WITHOUT
 *  inventing reasoning the chain did not record. The contract writes strings
 *  shaped like `ACCEPTED set_markup 2000bp -> 2000bp` or
 *  `REJECTED restock_extra 5: unaffordable (room 12, affordable 0)`. */
export function explainDecision(raw) {
  const text = String(raw ?? "").trim();
  if (!text) {
    return {
      status: "none",
      plain:
        "No agent decision recorded yet — this shop is running on the town's default daily rules.",
    };
  }
  const m = text.match(/^(ACCEPTED|REJECTED)\s+(\w+)\s*(.*)$/);
  if (!m) {
    return { status: "recorded", plain: `Contract recorded: ${text}` };
  }
  const [, verdict, kind, rest] = m;
  const detail = rest.replace(/->/g, "→").trim();
  const verb =
    kind === "set_markup"
      ? "change its markup"
      : kind === "restock_extra"
        ? "buy extra stock"
        : kind === "hold"
          ? "hold"
          : `run ${kind}`;
  if (verdict === "ACCEPTED") {
    return {
      status: "accepted",
      plain: `The contract accepted the agent's proposal to ${verb}${detail ? ` (${detail})` : ""}.`,
    };
  }
  return {
    status: "rejected",
    plain: `The contract rejected the agent's proposal to ${verb}${
      detail ? ` (${detail})` : ""
    } — the shop's real balances or state did not allow it.`,
  };
}

/** Fixed-window rate limiter. `now` is injectable so tests are deterministic. */
export class RateLimiter {
  constructor({ limit, windowMs, now = () => Date.now() }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map();
  }

  /** Record a hit for `key`. Returns `{ ok, remaining, retryAfterMs }`. */
  check(key) {
    const t = this.now();
    const bucket = this.hits.get(key);
    if (!bucket || t - bucket.start >= this.windowMs) {
      this.hits.set(key, { start: t, count: 1 });
      return { ok: true, remaining: this.limit - 1, retryAfterMs: 0 };
    }
    if (bucket.count >= this.limit) {
      return {
        ok: false,
        remaining: 0,
        retryAfterMs: this.windowMs - (t - bucket.start),
      };
    }
    bucket.count += 1;
    return { ok: true, remaining: this.limit - bucket.count, retryAfterMs: 0 };
  }

  /** Drop expired buckets so the map cannot grow without bound. */
  prune() {
    const t = this.now();
    for (const [k, b] of this.hits) {
      if (t - b.start >= this.windowMs) this.hits.delete(k);
    }
  }
}

/** A single-flight lock: only one critical section may run at a time.
 *  Used to prevent duplicate concurrent fast-forwards. */
export class SingleFlight {
  constructor() {
    this.busy = false;
  }
  async run(fn) {
    if (this.busy) return { ok: false, error: "another action is already in progress" };
    this.busy = true;
    try {
      return { ok: true, value: await fn() };
    } finally {
      this.busy = false;
    }
  }
}

/** Decide whether a request's Origin is allowed. Pure given the allowlist. */
export function originAllowed(origin, allowlist) {
  if (!origin) return true; // same-origin / curl / server-to-server: no Origin header
  if (allowlist.includes("*")) return true;
  return allowlist.includes(origin);
}

/** Parse a comma-separated allowlist env var into an array. */
export function parseAllowlist(raw) {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
