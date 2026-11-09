// Generate the Ledgertown identity set and persist it locally.
//
// These are REAL NEAR testnet ed25519 keypairs. The secret keys live only in
// keys/identities.json, which is git-ignored and never committed.
//
//   node driver/keys.js
import { KeyPair } from "near-api-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "keys");
const file = path.join(dir, "identities.json");

// Town owner/deployer + the four founding merchants + the player.
const IDS = {
  owner: "ledgertown.testnet",
  player: "player.ledgertown.testnet",
  miller: "miller.ledgertown.testnet",
  smith: "smith.ledgertown.testnet",
  weaver: "weaver.ledgertown.testnet",
  brewer: "brewer.ledgertown.testnet",
};

fs.mkdirSync(dir, { recursive: true });
const existing = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8"))
  : {};

for (const [role, accountId] of Object.entries(IDS)) {
  if (existing[role]) continue;
  const kp = KeyPair.fromRandom("ed25519");
  existing[role] = {
    accountId,
    publicKey: kp.getPublicKey().toString(),
    secretKey: kp.toString(),
  };
}
fs.writeFileSync(file, JSON.stringify(existing, null, 2));
fs.chmodSync(file, 0o600);

console.log("wrote", file);
for (const [role, v] of Object.entries(existing)) {
  console.log(`  ${role.padEnd(7)} ${v.accountId.padEnd(28)} ${v.publicKey}`);
}
