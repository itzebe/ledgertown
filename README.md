# Ledgertown

A market town run by AI merchants, settled on NEAR. Four shops, four goods, one
deterministic economy. Every figure the interface shows is read from a real NEAR
testnet contract; every action is a real signed transaction.

This repository contains the **playable NEAR prototype** (`contract/`, `driver/`,
`web/`) and the **validated economic model** it is built on (`feasibility/`).

```
contract/       Rust NEAR contract — the authoritative ledger
driver/         Node.js clients that talk to the deployed contract
web/            local play server + interface
feasibility/    the reference economic model the contract is tested against
docs/           hackathon research + economy notes
```

> **Testnet contract lifecycle.** The prototype runs against a live deployment at
> `town.ledgertown.testnet` (NEAR testnet, chain id `testnet`). NEAR testnet
> periodically reaps idle accounts, so if that account is gone when you read this,
> the contract source, its tests and the golden parity fixture are all in this repo
> and the setup below redeploys it from scratch. The offline suites (`cargo test`,
> `node --test`) need no network or account.

> **Network guard.** Public RPC hostnames have silently changed networks before —
> `free.rpc.fastnear.com` now serves **mainnet**, not testnet. The driver therefore
> only lists known testnet endpoints, and `connectTown` probes **every** endpoint in
> the failover pool (not just the first responder) and refuses to run if any reachable
> member reports a non-testnet `chain_id` (see `tests/chain-guard.test.js`).
> Override with `LEDGERTOWN_RPC` if you use your own testnet node.

---

## What is real here

| Layer | Status |
| --- | --- |
| Economic rules (`RULES.md`) | Validated by the reference simulation (25 unit tests, 39 exploit probes, 11 scenarios, 22 sensitivity cases). |
| On-chain engine (`contract/`) | Rust + `near-sdk`. Reproduces the reference engine **exactly** for 30 days — verified both in-wasm (`contract/tests/town.rs`) and **live against the deployed contract** (`scripts/verify-parity.js`). |
| Merchant identities | Real NEAR testnet subaccounts (`miller.ledgertown.testnet`, …), each signing its own transactions. |
| Contract | Deployed at `town.ledgertown.testnet` on testnet. |
| Player actions | Real signed transactions via `near-api-js`. |
| Interface | Reads live chain state through `final`-finality RPC views; each action links to its real transaction on the explorer. |

**Nothing is simulated or mocked in the prototype.** The Python model is used only
as the *reference oracle* the contract is tested against.

### Correctness details that are easy to get wrong

- **Reads are `final`.** A view at `optimistic` finality can observe a block whose
  chunks are not all applied; right after a write it may return a pre-write value.
  Every read uses `final` finality.
- **Writes are idempotent under retry.** The driver signs the transaction **once**
  and only ever re-broadcasts those exact signed bytes, which the chain deduplicates
  by hash. This matters because `tick` is not idempotent: retrying a *freshly
  signed* `tick` after a lost 429 response would advance the day twice.
- **Refusals are readable.** Economic rule violations return the contract's own
  message (e.g. `gather 1..=50 per call`, `owner only`), not a raw wasm trap.

---

## Layout

```
contract/            Rust NEAR contract (the authoritative ledger)
  src/lib.rs         deterministic engine: exact rational arithmetic on i128
  tests/town.rs      unit tests + exact 30-day parity vs the reference
  testdata/          golden_baseline.json (produced by feasibility/simulate.py)
driver/              Node.js clients that talk to the deployed contract
  near.js            connection, keystore, retrying RPC helpers
  keys.js            generate the identity set
  accounts.js        create real testnet accounts/subaccounts
  deploy.js          deploy + seed the four merchants
  town.js            town client (state, tick, deposit, gather, buy, sell, invest)
  agent.js           constrained AI merchant policy -> merchant_decide
  demo.js            full lifecycle demo (flood -> insolvency -> revival)
web/                 public play server + interface
  server.js          process bootstrap; binds HOST/PORT, fails closed
  handler.js         HTTP routing, validation, rate limits, security headers
  guard.js           pure helpers: validation, rate limit, decision wording
  town-client.js     read-only (key-free) and play (demo-key) town clients
  index.html         the town ledger UI
  app.js             UI script (external, so a strict CSP needs no inline JS)
feasibility/         reference economic model (pure Python, no network)
  RULES.md           the normative economic rules
  simulate.py        the reference engine
  run_sim.py         runs the 11 scenarios into results/
  tests.py           invariants / determinism suite
  exploits.py        adversarial exploit probes
  sensitivity.py     parameter sensitivity sweep
  results/           scenario CSVs + summary
scripts/fund.js      top up an account with free testnet NEAR
scripts/verify-parity.js  live 30-day parity check vs golden_baseline.json
scripts/layout-probe.js   responsive/overflow probe over the DevTools protocol
tests/agent.test.js  unit tests for the pure merchant policy
tests/outcome.test.js  unit tests for failed-execution detection (no fake success)
docs/                hackathon research + economy notes
keys/                git-ignored; real testnet secret keys
```

---

## Setup

```bash
npm install
export PATH="$HOME/.cargo/bin:$PATH"        # rustup toolchain
rustup target add wasm32-unknown-unknown
```

## Build, test, deploy

```bash
# 1. build + test the contract (includes exact parity vs the reference engine)
cd contract && cargo build --target wasm32-unknown-unknown --release && cargo test && cd ..

# 2. create the identity set (writes keys/identities.json, git-ignored)
node driver/keys.js
node driver/accounts.js       # owner via faucet; player + 4 merchants as real subaccounts

# 3. deploy the contract and seed the merchants
node driver/deploy.js

# 4. play
npm run serve                 # -> http://127.0.0.1:3000 (loopback only)
```

The public server has two modes and **defaults to the safe one**:

- **`read-only` (default).** Serves the UI and reads live contract state over public
  testnet RPC. Loads **no keys at all**, so it is safe to expose. Trade buttons are
  disabled in the UI and every action endpoint returns `503`.
- **`play`.** Adds bounded, **non-owner** actions (`tick`, `gather`, `buy`, `sell`,
  `invest`) signed by ONE dedicated demo account from the environment. `deposit`
  (which attaches real NEAR) and every owner-only method (`reset`, `add_shock`,
  `owner_withdraw`, `set_lifeline_enabled`, `seed_merchant`) are **never** exposed.

```bash
npm run serve                                   # read-only, http://127.0.0.1:3000

# play mode (local, with a throwaway demo key)
LEDGERTOWN_MODE=play \
LEDGERTOWN_DEMO_ACCOUNT=your-demo.testnet \
LEDGERTOWN_DEMO_KEY=ed25519:... \
npm run serve
```

The server never reads `keys/identities.json`; the operator's owner and merchant keys
must not exist in a public deployment.

> **Shared player state.** The contract stores ONE shared `Player`, not per-visitor
> state. Everyone who plays trades from the same purse. The UI states this plainly;
> giving each visitor an independent purse would require a contract change (a separate
> testnet migration), which is out of scope here.

### Public deployment (Render, free plan)

`render.yaml` is a Render Blueprint for a free web service:

1. Render Dashboard → **New → Blueprint**, connect this GitHub repo, apply.
2. The service builds with `npm install` and starts with `node web/server.js`,
   binding `0.0.0.0:$PORT` (Render sets `PORT`). Health check: `/healthz`.
3. Read-only mode works immediately with no secrets.
4. For play mode: set `LEDGERTOWN_MODE=play`, then add `LEDGERTOWN_DEMO_ACCOUNT`
   and `LEDGERTOWN_DEMO_KEY` in **Environment** (they are `sync: false` in the
   blueprint, so they are never committed). Use a **dedicated** testnet account
   holding only a little testnet NEAR.

Free-tier notes (from Render's docs): a Free web service **spins down after 15
minutes without inbound traffic** and cold-starts on the next request (expect a
short delay). Free services also have limited build minutes. No paid add-on or
database is required — the app keeps no persistent local state.

> **Never** put a mainnet key, an owner key, or a merchant key in any hosting
> dashboard. Only a dedicated, low-balance testnet demo key belongs there.

## Demo (one command)

```bash
node driver/demo.js
```

Reproduces the validated `09_demo_flood` scenario on-chain: 15 healthy days, then
the player floods the smith with iron, the smith goes insolvent and **closes**,
the player **invests**, the smith **reopens** and trades back to health. The run
writes `demo-log.json` with every transaction hash and the full event trail.

The demo is self-funding and repeatable: if the owner is low on testnet NEAR it
tops up from the free faucet, or (if the faucet is rate-limited) withdraws
unallocated NEAR back from the contract via the owner-only `owner_withdraw`.
Reads and writes go to free public testnet RPCs (tried in order:
`rpc.testnet.fastnear.com`, `near-testnet.drpc.org`, `rpc.testnet.near.org`);
override the first with `LEDGERTOWN_RPC`.

## AI merchants

```bash
node driver/agent.js --rounds 5
```

Each merchant runs a small, transparent policy (`decideForMe` in `driver/agent.js`):
restock toward twice base demand when cash allows, otherwise undercut the cheapest
open rival, otherwise relax toward the target markup. The agent **proposes**; the
contract validates against real cash, inventory and the reserve rule, and records
the outcome in the merchant's `last_decision`.

---

## Economic invariants the contract enforces

- **Deterministic.** No randomness; identical inputs give byte-identical runs.
- **Bounded.** Prices and markups are clamped; stock cannot go negative.
- **No fake money.** A merchant below its reserve refuses to buy (the contract
  aborts the call) rather than going further into debt.
- **Solvency is observable.** Merchants that cannot cover fixed costs close, and
  the closure and any later reopening are recorded as on-chain events.

## Tests

Offline (no network, no account required):

```bash
npm run test:contract     # 11 tests incl. exact 30-day parity vs the reference
npm run test:agent        # 17 unit tests: merchant policy + failure detection + chain guard
python3 feasibility/tests.py       # 25 invariants / determinism tests
python3 feasibility/exploits.py    # 39 adversarial exploit probes
```

Live against a deployment (needs the contract deployed and funded):

```bash
node scripts/verify-parity.js   # 30 days on the deployed contract vs golden (120 rows)
```

> `verify-parity.js` rewrites on-chain state (it resets the town and ticks 30 days).
> Run `node driver/demo.js` afterwards to restore the lifecycle story for a demo.

## Evidence

Verified on the live deployment (`town.ledgertown.testnet`, NEAR testnet):

- Contract: `cargo test` — **11 passed**, including exact 30-day parity.
- Unit tests: `node --test tests/*.test.js` — **17 passed** (8 policy + 4 failure-detection + 5 chain-guard).
- Reference model: `feasibility/tests.py` — **25/25 passed**; `feasibility/exploits.py`
  — **39/39 passed**.
- Live parity: `scripts/verify-parity.js` — **PASS, 120 rows, 0 mismatches** against the
  deployed `town.ledgertown.testnet` (reset + 30 ticks, every merchant every day).
- Lifecycle: `driver/demo.js` produced a `CLOSED` (day 22, cash −2) then `REOPENED`
  (day 31, cash 198) event for the smith, ending `open` (14 transactions). Sample
  verified on-chain: `reset` `Gp2ZsTmRztcoYqoBBGoNnrYckCJkYapoSKcsHRtfzohk`,
  `player_invest` `G3mSM6Bmgd4pVtudmV6uCYWa3MAmbVsYZUQ1LWpz5UWk`.
- Merchant agents: `driver/agent.js --rounds 2` — 8 real signed `merchant_decide`
  transactions; each proposal accepted and recorded in `last_decision`.
- UI: verified at 320 / 390 / 768 / 1280 px (no horizontal overflow; touch targets
  ≥44 px on phones); text contrast ≥ AA; every action links to a real explorer tx.

> Live checks require the deployed contract to exist and the owner to be funded. If
> testnet has reaped `town.ledgertown.testnet`, redeploy first (`driver/deploy.js`).
> A full redeploy on a fresh account needs the owner to hold testnet NEAR; the free
> faucet is rate-limited, so the account must be topped up from a funded wallet.
