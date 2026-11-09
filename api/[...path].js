// Vercel serverless entry point.
//
// Reuses the exact same request handler as the long-running Node server
// (web/handler.js), so validation, rate limiting, security headers and the
// read-only/play split behave identically. Read-only is the default: with no
// environment variables set it serves the UI and reads live testnet state,
// loading no keys. See vercel.json for routing.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler } from "../web/handler.js";
import { createReadOnlyTown, createPlayTown, TESTNET_ENDPOINTS } from "../web/town-client.js";
import { parseAllowlist } from "../web/guard.js";

let cached;

async function buildHandler() {
  const mode = process.env.LEDGERTOWN_MODE === "play" ? "play" : "read-only";
  const endpoints = (
    process.env.LEDGERTOWN_RPC ? process.env.LEDGERTOWN_RPC.split(",") : TESTNET_ENDPOINTS
  )
    .map((s) => s.trim())
    .filter(Boolean);
  const town =
    mode === "play"
      ? await createPlayTown({
          accountId: process.env.LEDGERTOWN_DEMO_ACCOUNT,
          secretKey: process.env.LEDGERTOWN_DEMO_KEY,
          endpoints,
        })
      : await createReadOnlyTown({ endpoints });
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
  return createHandler({
    town,
    config: { mode, originAllowlist: parseAllowlist(process.env.LEDGERTOWN_ALLOW_ORIGIN), webRoot },
    log: (m) => console.error(m),
  });
}

// Vercel reuses the warm instance, so build the town once and share it.
export default async function handler(req, res) {
  if (!cached) cached = buildHandler();
  const h = await cached;
  return h(req, res);
}
