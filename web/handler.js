// HTTP request handling for the public Ledgertown server.
//
// Kept separate from process bootstrap (`server.js`) so the routing, validation,
// rate limiting and security behaviour can be unit-tested offline against a
// fake town client — no network, no keys, no chain (see tests/handler.test.js).
import fs from "node:fs";
import path from "node:path";
import {
  validateAction,
  validateAdvance,
  explainDecision,
  originAllowed,
  isValidAccount,
  RateLimiter,
  SingleFlight,
} from "./guard.js";

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; " +
    "frame-ancestors 'none'; object-src 'none'",
};

const MAX_BODY_BYTES = 4 * 1024; // public actions are tiny; reject anything larger

/** Build an HTTP handler. All side-effecting collaborators are injected so the
 *  handler has no hidden global state and can be tested deterministically.
 *
 *  town   — { getState(), tick(), gather(), buy(), sell(), invest(), contract }
 *  config — { mode: "read-only"|"play", originAllowlist: string[], webRoot }
 */
export function createHandler({
  town,
  config,
  actionLimiter = new RateLimiter({ limit: 20, windowMs: 60_000 }),
  advanceLimiter = new RateLimiter({ limit: 6, windowMs: 60_000 }),
  playerLimiter = new RateLimiter({ limit: 60, windowMs: 60_000 }),
  singleFlight = new SingleFlight(),
  stateTtlMs = 2000,
  recentTxs = [],
  now = () => Date.now(),
  log = () => {},
}) {
  const readOnly = config.mode !== "play";

  // A short cache of the town read. `/api/state` is polled by every open tab;
  // without this, a burst of visitors exhausts the free public RPC's rate
  // limit. The value is the SAME real state, at most `stateTtlMs` old — never
  // fabricated, never a substitute for a live read on an action. Set
  // `stateTtlMs = 0` to disable (tests do).
  let stateCache = null; // { at, value }
  async function readStateCached() {
    const t = now();
    if (stateTtlMs > 0 && stateCache && t - stateCache.at < stateTtlMs) return stateCache.value;
    const value = await town.getState();
    stateCache = { at: t, value };
    return value;
  }

  function headers(extra = {}) {
    return { ...SECURITY_HEADERS, ...extra };
  }

  function send(res, code, body, extraHeaders = {}) {
    const data = JSON.stringify(body);
    res.writeHead(code, headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(data),
      ...extraHeaders,
    }));
    res.end(data);
  }

  function applyCors(req, res) {
    const origin = req.headers?.origin;
    if (origin && originAllowed(origin, config.originAllowlist)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
  }

  async function readJsonBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        const err = new Error("request body too large");
        err.statusCode = 413;
        throw err;
      }
      chunks.push(c);
    }
    if (!chunks.length) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      const err = new Error("invalid JSON body");
      err.statusCode = 400;
      throw err;
    }
  }

  function clientKey(req) {
    const fwd = String(req.headers?.["x-forwarded-for"] ?? "").split(",")[0].trim();
    return fwd || req.socket?.remoteAddress || "unknown";
  }

  function remember(label, hash, merchant) {
    recentTxs.unshift({ label, hash, merchant: merchant || null, at: now() });
    if (recentTxs.length > 25) recentTxs.pop();
  }

  function publicState(state) {
    const townTuple = state.town || [];
    // `get_town` returns (day, merchantCash, openCount, playerPurseCount).
    // A town with the per-account upgrade reports a purse count; the original
    // single-purse contract reports the one shared purse's cash. We surface the
    // raw tuple and let the UI label it honestly either way.
    return {
      contract: town.contract,
      mode: config.mode,
      // "per-account" once the upgrade is live; "single" on the original
      // contract, which still holds ONE shared purse. The UI labels ownership
      // honestly from this and never implies per-visitor custody either way.
      model: state.model || "single",
      sharedPlayer: (state.model || "single") !== "per-account",
      canAct: !readOnly,
      day: state.day,
      town: townTuple,
      merchants: (state.merchants || []).map((m) => ({
        ...m,
        decision: explainDecision(m.last_decision),
      })),
      events: state.events,
      recentTxs,
    };
  }

  async function handleAction(req, res, name) {
    const body = await readJsonBody(req);
    const v = validateAction(name, body);
    if (!v.ok) return send(res, 400, { ok: false, error: v.error });

    if (readOnly) {
      return send(res, 503, {
        ok: false,
        error:
          "This deployment is read-only. Playing requires server-side signing keys " +
          "that are not configured here.",
      });
    }

    const rl = actionLimiter.check(clientKey(req));
    if (!rl.ok) {
      return send(
        res,
        429,
        { ok: false, error: "rate limit reached; please wait a moment" },
        { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) }
      );
    }

    const result = await singleFlight.run(async () => {
      const out = await town[v.action](v.args);
      remember(v.action, out.hash, v.args.merchant);
      const state = await town.getState();
      return { hash: out.hash, day: state.day };
    });
    if (!result.ok) return send(res, 409, { ok: false, error: result.error });
    return send(res, 200, { ok: true, ...result.value });
  }

  async function handleAdvance(req, res) {
    const body = await readJsonBody(req);
    const v = validateAdvance(body);
    if (!v.ok) return send(res, 400, { ok: false, error: v.error });

    if (readOnly) {
      return send(res, 503, {
        ok: false,
        error:
          "This deployment is read-only. Advancing the town requires server-side " +
          "signing keys that are not configured here.",
      });
    }

    const rl = advanceLimiter.check(clientKey(req));
    if (!rl.ok) {
      return send(
        res,
        429,
        { ok: false, error: "rate limit reached; please wait a moment" },
        { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) }
      );
    }

    const result = await singleFlight.run(async () => {
      const hashes = [];
      const failed = [];
      // Each day is a REAL, separately signed contract transaction. If one
      // fails (rate limit, RPC hiccup) we stop and report exactly how many
      // days actually advanced — never claim more than succeeded.
      for (let i = 0; i < v.days; i++) {
        try {
          const out = await town.tick({});
          hashes.push(out.hash);
          remember("tick", out.hash);
        } catch (e) {
          failed.push({ at: i + 1, error: cleanError(e) });
          break;
        }
      }
      const state = await town.getState();
      return { requested: v.days, completed: hashes.length, hashes, failed, day: state.day };
    });
    if (!result.ok) return send(res, 409, { ok: false, error: result.error });
    const value = result.value;
    // A partial advance is reported as a non-2xx so a client cannot mistake it
    // for a clean run, but the body still carries the honest detail.
    const code = value.failed.length ? 207 : 200;
    return send(res, code, { ok: value.failed.length === 0, ...value });
  }

  async function serveStatic(req, res, pathname) {
    let rel = pathname === "/" ? "/index.html" : pathname;
    // Reject traversal: normalise, then require the result to stay under webRoot.
    const full = path.join(config.webRoot, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
    if (!full.startsWith(config.webRoot + path.sep)) {
      return send(res, 403, { ok: false, error: "forbidden" });
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return send(res, 404, { ok: false, error: "not found" });
    }
    const ext = path.extname(full);
    const type =
      ext === ".html" ? "text/html; charset=utf-8"
      : ext === ".css" ? "text/css; charset=utf-8"
      : ext === ".js" ? "text/javascript; charset=utf-8"
      : ext === ".json" ? "application/json; charset=utf-8"
      : ext === ".svg" ? "image/svg+xml"
      : ext === ".png" ? "image/png"
      : "text/plain; charset=utf-8";
    const data = fs.readFileSync(full);
    res.writeHead(200, headers({ "Content-Type": type, "Cache-Control": "no-cache" }));
    res.end(data);
  }

  return async function handle(req, res) {
    applyCors(req, res);
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return send(res, 400, { ok: false, error: "bad request" });
    }
    const { pathname } = url;

    try {
      if (req.method === "OPTIONS") {
        return send(res, 204, {});
      }
      if (req.method === "GET" && (pathname === "/healthz" || pathname === "/api/health")) {
        return send(res, 200, {
          ok: true,
          status: "healthy",
          mode: config.mode,
          contract: town.contract,
        });
      }
      if (req.method === "GET" && pathname === "/api/state") {
        const state = await readStateCached();
        return send(res, 200, { ok: true, ...publicState(state) });
      }
      if (req.method === "GET" && pathname === "/api/player") {
        // Public, key-free read of ONE account's purse (the connected wallet's
        // own). Read-only by nature: it is a contract view, never a write.
        const account = url.searchParams.get("account") || "";
        if (!isValidAccount(account)) {
          return send(res, 400, { ok: false, error: "invalid account id" });
        }
        const rl = playerLimiter.check(clientKey(req));
        if (!rl.ok) {
          return send(
            res,
            429,
            { ok: false, error: "rate limit reached; please wait a moment" },
            { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) }
          );
        }
        if (typeof town.getPlayer !== "function") {
          return send(res, 501, { ok: false, error: "player reads are not available here" });
        }
        const player = await town.getPlayer(account);
        return send(res, 200, { ok: true, account, player: player ?? null });
      }
      if (req.method === "POST" && pathname === "/api/advance") {
        return await handleAdvance(req, res);
      }
      if (req.method === "POST" && pathname.startsWith("/api/action/")) {
        return await handleAction(req, res, pathname.slice("/api/action/".length));
      }
      if (req.method === "GET") {
        return await serveStatic(req, res, pathname);
      }
      return send(res, 405, { ok: false, error: "method not allowed" });
    } catch (e) {
      // Validation errors carry their own 4xx status. Everything else that
      // escapes here is an upstream failure (RPC unreachable, rate-limited,
      // timed out) — report 502 so a client never reads a transient outage as
      // a bad request, and never as success.
      const explicit = e?.statusCode;
      const code = explicit && explicit >= 400 && explicit < 500 ? explicit : 502;
      log(`error: ${e?.stack || e}`);
      return send(res, code, { ok: false, error: cleanError(e) });
    }
  };
}

/** Reduce an error to a short, safe, human-readable reason. Never leaks stack
 *  traces or key material; strips the RPC's nested JSON wrapper. */
export function cleanError(e) {
  const raw = String(e?.message || e);
  const m = raw.match(/"ExecutionError":"([^"]+)"/);
  let msg = m ? m[1] : raw;
  msg = msg.replace(/^Smart contract panicked:\s*/, "");
  return msg.slice(0, 200);
}
