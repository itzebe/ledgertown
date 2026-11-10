// Build the browser wallet bundle (web/vendor/near-api-js.min.js).
//
// near-api-js ships CommonJS with Node built-ins; the browser needs a bundle.
// We build an ESM bundle so both the page (module script) and the Node test
// suite can import the exact same file, and we keep the strict CSP working
// (script-src 'self'): the bundle contains no eval / new Function, and we
// polyfill only `Buffer` and `process`, which near-api-js reads at module load.
//
//   node scripts/build-wallet.mjs
//
// The output is committed so a clean clone needs no build step to run.
import esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "web", "wallet-bundle-entry.js");
const poly = path.join(root, "web", "wallet-bundle-polyfills.js");
const out = path.join(root, "web", "vendor", "near-api-js.min.js");

fs.mkdirSync(path.dirname(out), { recursive: true });

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  outfile: out,
  platform: "browser",
  target: ["es2020"],
  minify: true,
  logLevel: "warning",
  inject: [poly],
  define: { global: "globalThis" },
});

const bytes = fs.statSync(out).size;
console.log(`built ${path.relative(root, out)} (${(bytes / 1024).toFixed(0)} kB)`);
