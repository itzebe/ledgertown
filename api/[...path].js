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

function endpointsFromEnv() {
  return (process.env.LEDGERTOWN_RPC ? process.env.LEDGERTOWN_RPC.split(",") : TESTNET_ENDPOINTS)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Build the request handler. `town`/`config` may be injected so the entry can
 *  be exercised without a network or keys (see tests/vercel-entry.test.js). */
export async function buildHandler({ town, config } = {}) {
  const mode = process.env.LEDGERTOWN_MODE === "play" ? "play" : "read-only";
  if (!town) {
    town =
      mode === "play"
        ? await createPlayTown({
            accountId: process.env.LEDGERTOWN_DEMO_ACCOUNT,
            secretKey: process.env.LEDGERTOWN_DEMO_KEY,
            endpoints: endpointsFromEnv(),
          })
        : await createReadOnlyTown({ endpoints: endpointsFromEnv() });
  }
  return createHandler({
    town,
    config: config ?? {
      mode,
      originAllowlist: parseAllowlist(process.env.LEDGERTOWN_ALLOW_ORIGIN),
      webRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web"),
    },
    log: (m) => console.error(m),
  });
}

/** Cache the result of an async factory for the warm instance. A rejected build
 *  is NOT cached: the next request retries, so a transient failure at cold start
 *  (e.g. RPC briefly unreachable) does not wedge the instance until Vercel
 *  recycles it. */
export function memoizeOnce(factory) {
  let cached;
  return async function get() {
    if (cached === undefined) {
      cached = Promise.resolve()
        .then(factory)
        .catch((e) => {
          cached = undefined;
          throw e;
        });
    }
    return cached;
  };
}

// Vercel reuses the warm instance, so build the handler once and share it.
const getHandler = memoizeOnce(() => buildHandler());

export default async function handler(req, res) {
  const h = await getHandler();
  return h(req, res);
}
