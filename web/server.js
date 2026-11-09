// Ledgertown local play server.
//
// Serves a small UI and proxies the player's actions to the REAL deployed
// NEAR testnet contract. Every number the UI shows comes from an RPC view of
// `town.ledgertown.testnet`; every button issues a real signed transaction.
//
//   node web/server.js      -> http://localhost:3000
//
// The player's testnet key is read from keys/identities.json (git-ignored).
// This server is a LOCAL demo harness; it is not a production signing service.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectTown,
  getState,
  tick,
  deposit,
  gather,
  buy,
  sell,
  invest,
  CONTRACT_ID,
} from "../driver/town.js";
import { loadIdentities } from "../driver/near.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT || 3000;
// The POST endpoints sign with local testnet keys, so the play server has no
// authentication. Bind to loopback by default; set HOST=0.0.0.0 only when you
// deliberately want to expose it (e.g. a container that proxies it).
const HOST = process.env.HOST || "127.0.0.1";
const near = await connectTown();

// A short in-memory trail of the player's own transactions, so the UI can link
// each action straight to the explorer. Purely presentational.
const recentTxs = [];
function remember(label, hash, merchant) {
  recentTxs.unshift({ label, hash, merchant: merchant || null, at: Date.now() });
  if (recentTxs.length > 25) recentTxs.pop();
}

// The town auto-advances this often (ms) if nobody clicks. 0 disables.
const AUTO_TICK_MS = Number(process.env.AUTO_TICK_MS || 0);
if (AUTO_TICK_MS > 0) {
  setInterval(async () => {
    try {
      await tick(near, "owner");
    } catch {
      /* rate-limited; skip this beat */
    }
  }, AUTO_TICK_MS);
}

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const routes = {
  "GET /api/state": async () => {
    const s = await getState(near);
    const ids = loadIdentities();
    return {
      contract: CONTRACT_ID,
      day: s.day,
      town: s.town,
      player: s.player,
      merchants: s.merchants,
      events: s.events,
      accounts: Object.fromEntries(
        Object.entries(ids).map(([k, v]) => [k, v.accountId])
      ),
      recentTxs,
    };
  },
  "POST /api/tick": async () => {
    const r = await tick(near, "owner");
    return { hash: r.hash };
  },
  "POST /api/deposit": async (body) => {
    const r = await deposit(near, String(body.near || "1"), "player");
    return { hash: r.hash };
  },
  "POST /api/gather": async (body) => {
    const r = await gather(near, body.good, Number(body.units), "player");
    return { hash: r.hash };
  },
  "POST /api/buy": async (body) => {
    const r = await buy(near, body.merchant, body.good, Number(body.units), "player");
    return { hash: r.hash };
  },
  "POST /api/sell": async (body) => {
    const r = await sell(near, body.merchant, body.good, Number(body.units), "player");
    return { hash: r.hash };
  },
  "POST /api/invest": async (body) => {
    const r = await invest(near, body.merchant, Number(body.amount), "player");
    return { hash: r.hash };
  },
};

function cleanError(e) {
  const raw = String(e?.message || e);
  // RPC wraps the reason in nested JSON; pull out the human-readable part.
  const m = raw.match(/"ExecutionError":"([^"]+)"/);
  let msg = m ? m[1] : raw;
  msg = msg.replace(/^Smart contract panicked:\s*/, "");
  return msg.slice(0, 200);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const key = `${req.method} ${url.pathname}`;
  try {
    if (routes[key]) {
      const body = req.method === "POST" ? await readBody(req) : {};
      const out = await routes[key](body);
      if (out.hash) remember(url.pathname.replace("/api/", ""), out.hash, body.merchant);
      return json(res, 200, { ok: true, ...out });
    }
    // static
    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    const full = path.join(root, "web", path.normalize(file).replace(/^(\.\.[/\\])+/, ""));
    if (!full.startsWith(path.join(root, "web"))) return json(res, 403, { ok: false, error: "forbidden" });
    if (!fs.existsSync(full)) return json(res, 404, { ok: false, error: "not found" });
    const ext = path.extname(full);
    const type = ext === ".html" ? "text/html" : ext === ".css" ? "text/css" : ext === ".js" ? "text/javascript" : "text/plain";
    res.writeHead(200, { "Content-Type": type });
    res.end(fs.readFileSync(full));
  } catch (e) {
    // Contract rule violations surface here as real, explainable refusals.
    json(res, 400, { ok: false, error: cleanError(e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Ledgertown play server -> http://${HOST}:${PORT}`);
  console.log(`contract: ${CONTRACT_ID}`);
});
