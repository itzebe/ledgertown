// Ledgertown public play server.
//
// Defaults to READ-ONLY: it serves the UI and reads real NEAR testnet contract
// state through RPC views, requiring no keys whatsoever. Bounded, non-owner
// play actions can be enabled explicitly by supplying a dedicated demo account
// key via environment variables.
//
//   node web/server.js                 -> read-only, http://127.0.0.1:3000
//   HOST=0.0.0.0 PORT=10000 node web/server.js
//
// Environment:
//   PORT                     bind port (default 3000; the host may set this)
//   HOST                     bind address (default 127.0.0.1)
//   LEDGERTOWN_RPC           override the RPC pool (comma-separated)
//   LEDGERTOWN_CONTRACT      contract account (default town.ledgertown.testnet)
//   LEDGERTOWN_MODE          "read-only" (default) or "play"
//   LEDGERTOWN_DEMO_ACCOUNT  demo signer account id (play mode only)
//   LEDGERTOWN_DEMO_KEY      demo signer secret key (play mode only)
//   LEDGERTOWN_ALLOW_ORIGIN  CORS allowlist (comma-separated)
//
// This server NEVER loads keys/identities.json and NEVER exposes owner methods
// or the deposit action.
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler } from "./handler.js";
import { createReadOnlyTown, createPlayTown, TESTNET_ENDPOINTS } from "./town-client.js";
import { parseAllowlist } from "./guard.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(root, "web");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const MODE = process.env.LEDGERTOWN_MODE === "play" ? "play" : "read-only";
const ENDPOINTS = (process.env.LEDGERTOWN_RPC
  ? process.env.LEDGERTOWN_RPC.split(",")
  : TESTNET_ENDPOINTS
).map((s) => s.trim()).filter(Boolean);
const ORIGIN_ALLOWLIST = parseAllowlist(process.env.LEDGERTOWN_ALLOW_ORIGIN);

async function buildTown() {
  if (MODE === "play") {
    return createPlayTown({
      accountId: process.env.LEDGERTOWN_DEMO_ACCOUNT,
      secretKey: process.env.LEDGERTOWN_DEMO_KEY,
      endpoints: ENDPOINTS,
    });
  }
  return createReadOnlyTown({ endpoints: ENDPOINTS });
}

const town = await buildTown();
const server = http.createServer(
  createHandler({
    town,
    config: { mode: MODE, originAllowlist: ORIGIN_ALLOWLIST, webRoot },
    log: (m) => console.error(m),
  })
);

server.listen(PORT, HOST, () => {
  console.log(`Ledgertown server -> http://${HOST}:${PORT}  (mode: ${MODE})`);
  console.log(`contract: ${town.contract}`);
  if (MODE !== "play") {
    console.log("read-only: no signing keys loaded; play actions are disabled.");
  }
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
