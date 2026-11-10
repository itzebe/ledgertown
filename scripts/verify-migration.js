// Read-only proof that the migration layout is correct.
//
// The per-account upgrade changes `Contract` (one shared `Player` -> a
// `players` map). NEAR state is Borsh-serialised and positional, so before
// deploying the upgrade we must be sure `OldContract` in contract/src/lib.rs
// describes the *deployed* bytes exactly. This script fetches the live state
// (a public read; no keys, no writes) and decodes it with that layout.
//
//   node scripts/verify-migration.js
//
// A clean "EXACT MATCH" means `migrate()` will read the real state correctly.
// It never sends a transaction and never mutates the town.
import { providers } from "near-api-js";
import { CONTRACT_ID } from "../driver/near.js";

const RPC = process.env.LEDGERTOWN_RPC?.split(",")[0] || "https://rpc.testnet.fastnear.com";

/** JSON replacer so 128-bit integers print as decimal strings. */
const bigintStr = (k, v) => (typeof v === "bigint" ? v.toString() : v);

/** Minimal Borsh reader matching the deployed `OldContract` layout. */
class Reader {
  constructor(buf) {
    this.b = buf;
    this.o = 0;
  }
  u8() { return this.b[this.o++]; }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  u64() { const v = this.b.readBigUInt64LE(this.o); this.o += 8; return v; }
  i128() { const lo = this.b.readBigUInt64LE(this.o); const hi = this.b.readBigInt64LE(this.o + 8); this.o += 16; return (hi << 64n) | lo; }
  u128() { const lo = this.b.readBigUInt64LE(this.o); const hi = this.b.readBigUInt64LE(this.o + 8); this.o += 16; return (hi << 64n) | lo; }
  str() { const n = this.u32(); const v = this.b.toString("utf8", this.o, this.o + n); this.o += n; return v; }
  bool() { return this.u8() === 1; }
  optU64() { return this.u8() ? this.u64() : null; }
  i128map() { const n = this.u32(); const m = {}; for (let i = 0; i < n; i++) m[this.str()] = this.i128(); return m; }
}

export function decodeOldState(buf) {
  const r = new Reader(buf);
  const owner = r.str();
  const day = r.u64();
  const nMerchants = r.u32();
  const merchants = [];
  for (let i = 0; i < nMerchants; i++) {
    merchants.push({
      key: r.str(),
      id: r.str(), name: r.str(), account: r.str(), specialty: r.str(),
      fixed_cost: r.i128(), cash: r.i128(),
      inventory: r.i128map(), cost_basis: r.i128map(),
      markup_bp: r.i128(), decision_day: r.u64(),
      list_price: r.i128map(), bid_price: r.i128map(),
      lifeline_used: r.bool(), bankrupt_days: r.u32(),
      state: r.str(), closed_on: r.optU64(), reopened_count: r.u32(),
      last_decision: r.str(),
    });
  }
  const player = { cash: r.i128(), inventory: r.i128map(), deposited_yocto: r.u128() };
  const nEvents = r.u32();
  const events = [];
  for (let i = 0; i < nEvents; i++) {
    events.push({ id: r.u64(), day: r.u64(), merchant: r.str(), kind: r.str(), value: r.i128(), note: r.str() });
  }
  const nShocks = r.u32();
  const shocks = [];
  for (let i = 0; i < nShocks; i++) {
    shocks.push({ kind: r.str(), good: r.str(), num: r.i128(), den: r.i128(), start: r.u64(), end: r.u64() });
  }
  const next_event_id = r.u64();
  const lifeline_enabled = r.bool();
  const total_credits_minted = r.i128();
  const total_fixed_paid = r.i128();
  const total_revenue = r.i128();
  return {
    consumed: r.o, total: buf.length,
    state: { owner, day, merchants, player, events, shocks, next_event_id, lifeline_enabled, total_credits_minted, total_fixed_paid, total_revenue },
  };
}

async function main() {
  const provider = new providers.JsonRpcProvider({ url: RPC });
  const res = await provider.query({
    request_type: "view_state",
    account_id: CONTRACT_ID,
    prefix_base64: "",
    finality: "final",
  });
  const entry = res.values.find((v) => Buffer.from(v.key, "base64").toString("utf8") === "STATE");
  if (!entry) throw new Error("no STATE key on contract");
  const buf = Buffer.from(entry.value, "base64");
  const { consumed, total, state } = decodeOldState(buf);
  console.log(`contract          : ${CONTRACT_ID}`);
  console.log(`state bytes       : ${total}`);
  console.log(`bytes decoded     : ${consumed}`);
  console.log(`verdict           : ${consumed === total ? "EXACT MATCH" : "MISMATCH"}`);
  console.log(`day               : ${state.day}`);
  console.log(`merchants         : ${state.merchants.length}`);
  console.log(`events            : ${state.events.length}`);
  console.log(`shocks            : ${state.shocks.length}`);
  console.log(`owner             : ${state.owner}`);
  console.log(`shared purse      : cash=${state.player.cash} inv=${JSON.stringify(state.player.inventory, bigintStr)} deposited_yocto=${state.player.deposited_yocto}`);
  for (const m of state.merchants) {
    console.log(`  ${m.id.padEnd(7)} ${m.state.padEnd(6)} cash=${m.cash} inv=${JSON.stringify(m.inventory, bigintStr)} reopened=${m.reopened_count}`);
  }
  if (consumed !== total) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error("verify-migration failed:", e.message); process.exit(1); });
}
