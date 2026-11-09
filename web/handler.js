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
  singleFlight = new SingleFlight(),
  recentTxs = [],
  now = () => Date.now(),
  log = () => {},
}) {
  const readOnly = config.mode !== "play";

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
    return {
      contract: town.contract,
      mode: config.mode,
      // The contract stores ONE shared Player, not per-visitor state. The UI
      // must say so honestly; this flag is what drives that label.
      sharedPlayer: true,
      canAct: !readOnly,
      day: state.day,
      town: state.town,
      player: state.player,
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
        const state = await town.getState();
        return send(res, 200, { ok: true, ...publicState(state) });
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
      const code = e?.statusCode || 400;
      if (code >= 500) log(`error: ${e?.stack || e}`);
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
