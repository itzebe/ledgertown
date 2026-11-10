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
api/                 Vercel serverless entry point (same handler as server.js)
vercel.json          Vercel config: static UI + /api function + security headers
web/                 public play server + interface
  server.js          process bootstrap; binds HOST/PORT, fails closed
  handler.js         HTTP routing, validation, rate limits, security headers
  guard.js           pure helpers: validation, rate limit, decision wording
  economy.js         pure derivations the UI reads (position, price board, scarcity)
  town-client.js     read-only (key-free) and play (demo-key) town clients
  index.html         the town ledger UI
  app.js             UI script (external, so a strict CSP needs no inline JS)
  provenance.json    verified testnet tx hashes behind today's town
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
tests/               node --test suites: guards, handler, town client, agent policy,
                     failure detection, chain guard, and the Vercel entry point
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

### Playing (non-custodial, in the browser)

Ledgertown is a game, and the hosted site is playable **without the server ever
holding a key**. When a visitor connects a NEAR testnet wallet (for example
Freighter), the browser builds each action and the **wallet extension signs it** —
the site never sees the key. The player's own purse is read back through
`/api/player?account=…` (a key-free contract view). There is no shared signer and no
`deposit` step: gathering is free and credits come from trading.

The only methods the browser will ever ask a wallet to sign are
`player_init`, `player_gather`, `player_buy_from`, `player_sell_to`, `player_invest`
and `tick`. `deposit` (which attaches NEAR) and every owner-only method (`reset`,
`add_shock`, `owner_withdraw`, `set_lifeline_enabled`, `seed_merchant`) are not in that
list, so the interface cannot even offer them (`web/wallet.js`, `tests/wallet.test.js`).

> **Player model.** Personal play needs the **per-account** contract build, where each
> account owns its own purse (`players: BTreeMap<AccountId, Player>`) instead of the one
> shared `Player`. The site detects this at runtime via the `player_model` view and
> **degrades honestly**: until the owner deploys the upgrade it says so in the play band
> and keeps the trade buttons disabled, while the market stays fully live and readable.
> The migration preserves all existing state — `scripts/verify-migration.js` decodes the
> live contract with the old layout and reports `EXACT MATCH` before you upgrade.

### Public deployment (Vercel, free Hobby plan)

The live public site is served by Vercel from this repository. The project is
connected to the `main` branch, so every merge to `main` produces a production
deployment; pull requests produce preview deployments.

- **Production URL:** `https://ledgertown.vercel.app/`
- **Entry point:** `api/[...path].js` reuses the *same* handler as `web/server.js`
  (`web/handler.js`), so routing, validation, the read-only/play split, rate
  limits and security headers are identical in both.
- `vercel.json` sets `outputDirectory: web` (the static UI), routes `/api/*` and
  `/healthz` to the function, and applies the security headers to static files.
  Because Vercel's generated route for a bracket catch-all matches only **one**
  path segment in a non-framework build, `vercel.json` also carries an explicit
  `"/api/:path*" → "/api/[...path]"` rewrite so nested routes such as
  `/api/action/gather` reach the function instead of 404ing.
- `.vercelignore` keeps `keys/`, `.env*`, local artefacts and the Rust target out
  of the upload.

To deploy it yourself: import the repo at vercel.com (framework preset: **Other**,
no build command needed — `vercel.json` supplies everything), or run `vercel`
(preview) / `vercel --prod` (production) from a checkout. Read-only mode works
immediately with **no environment variables and no secrets**.

Play mode on a public host is **off by default** and is deliberately *not*
enabled on the public site: it would require putting one funded shared signer in
front of anonymous visitors (see "Public play mode is off by design" below). Set
`LEDGERTOWN_MODE=play` plus `LEDGERTOWN_DEMO_ACCOUNT` and `LEDGERTOWN_DEMO_KEY`
in **Project → Settings → Environment Variables** only if you accept that
trade-off. Use a **dedicated** testnet account holding only a little testnet
NEAR — never a mainnet, owner, or merchant key.

#### The server stays read-only; play is signed by the player's wallet

The hosted server runs in **read-only mode** and holds **no keys**. It serves the UI,
reads live `town.ledgertown.testnet` state over public testnet RPC, and proxies the
key-free `/api/player` purse read. That is safe to expose to anyone.

Play does **not** require enabling a server signer. It is **non-custodial**: the player
connects their own NEAR testnet wallet, and the wallet extension signs each action in
the browser. There is no funded shared signer behind anonymous visitors, so the old
trade-off (one shared signer in front of the public) no longer applies.

- The server keeps `deposit` (which attaches NEAR) and every owner-only method
  (`reset`, `add_shock`, `owner_withdraw`, `set_lifeline_enabled`, `seed_merchant`)
  unrouted — they return `400`.
- The browser will only ever ask a wallet to sign the six player methods above, so
  owner methods are unreachable even with a connected wallet.
- The optional server-side `play` mode still exists for local demos with a throwaway
  demo key, but it is **not** how the public site plays.

Personal play needs the **per-account** contract build (see "Player model" above). Until
the owner deploys it, the play band says so plainly and the trade buttons stay disabled —
the market itself is fully live and readable either way.

To activate per-account play on the live contract, the owner runs (once, with their
owner key):

```bash
node scripts/verify-migration.js   # prints EXACT MATCH against live state
node driver/upgrade.js             # deploys the new wasm + calls migrate()
```

`driver/upgrade.js` is owner-only and idempotent-safe: it deploys the wasm and calls
`migrate()`, which hands the old shared purse to the owner's own account and leaves every
merchant, event and shock untouched. No keys are ever needed by the website.

> **Serverless caveat (stated honestly).** The in-memory rate limits and the
> single-flight lock in `web/handler.js` are **per instance**, not global: Vercel
> may run several warm instances, and a cold start resets them. They bound
> accidental flooding and duplicate fast-forwards on one instance; they are not a
> global guarantee. This is acceptable because the public site is read-only, and
> play actions are signed (and rate-limited) by the player's own wallet.

## How to read the interface

The interface is a *reading* of the on-chain economy, not a separate game. Every
figure is derived from the contract's own state (`web/economy.js`), and the
derivations are unit-tested (`tests/economy.test.js`).

- **The market** — one panel per shop, showing four instruments drawn against the
  contract's own thresholds: **cash** against the shop's `2 × fixed cost` reserve
  (the line at which it stops buying stock), **stock** against `2 × base demand`
  (the restock target), the **sell** price with its margin over average cost, and
  the **buy** price. A plain line states the shop's health.
- **Your seat in the town** — the play band. Connect a NEAR testnet wallet and the
  band shows your **net worth** (credits + cargo at reference prices) and three
  **challenges derived from the live town**: an **arbitrage** (a good one shop sells
  below what another pays), a **rescue** (revive a closed shop, or supply one below
  its reserve), and — when your purse is empty — a free **gather** to start. Each
  challenge has buttons that sign the right action with your wallet.
- **The agent's decision** — each shop shows the contract's recorded
  `last_decision` in plain words (**ACCEPTED** / **REJECTED**). The merchant only
  *proposes*; the contract has the last word.
- **The price board** — every open shop's quote for each good, cheapest marked.
  Competition is visible here: when a shop undercuts, its quote turns green.
- **Scarcity strip** — total open-shop stock of each good as days of cover against
  base demand, so a good running thin or piling up is obvious at a glance.
- **Town ledger** — the contract's real events. The **CLOSED** and **REOPENED**
  rows link to the exact transactions that produced them.
- **On-chain provenance** — the 14 verified testnet transactions that built
  today's town (reset → flood → shock → close → invest → reopen → day 51).

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
npm run test:contract     # 20 tests: per-account purses, isolation, migration, parity
npm run test:agent        # 90 unit tests: merchant policy, failure detection, chain
                          # guard, server guards, handler, town client, economy
                          # derivations, game logic, wallet layer, Vercel entry
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

- Contract: `cargo test` — **20 passed** (per-account purse isolation, owner-only
  migration, exact 30-day parity).
- Unit tests: `node --test tests/*.test.js` — **90 passed** (policy, failure
  detection, chain guard, server guards, handler incl. the `/api/player` endpoint,
  town client, the economy derivations the UI reads, the game logic, the
  non-custodial wallet layer, and the Vercel entry).
- Reference model: `feasibility/tests.py` — **25/25 passed**; `feasibility/exploits.py`
  — **39/39 passed**.
- Public deployment: `https://ledgertown.vercel.app/` — read-only, serves live
  `town.ledgertown.testnet` state with no keys; `/healthz` and `/api/state` answer
  over the public internet; nested routes (`/api/action/<name>`) reach the handler
  (owner-only and `deposit` → `400`, valid actions → `503` read-only, invalid input
  → `400`, oversized body → `413`); all security headers present; browser console
  clean. (Re-verified against the released deployment from the merged `main`.)
- Player model: `scripts/verify-migration.js` decodes the live `STATE` (2922 bytes)
  with the old layout and reports **EXACT MATCH**, so the per-account upgrade is
  proven safe against the real contract before the owner runs `driver/upgrade.js`.
- Non-custodial play: the wallet layer is unit-tested (`tests/wallet.test.js`) and
  driven end-to-end in a headless browser with an injected fake wallet — connect,
  then `player_init` / `tick` / `player_gather` / `player_buy_from` / `player_sell_to`
  each sign exactly one action for `town.ledgertown.testnet`, and no owner or
  `deposit` method is ever signable.
- Live parity: `scripts/verify-parity.js` — **PASS, 120 rows, 0 mismatches** against the
  deployed `town.ledgertown.testnet` (reset + 30 ticks, every merchant every day).
- Lifecycle: `driver/demo.js` produced a `CLOSED` (day 22, cash −2) then `REOPENED`
  (day 31, cash 198) event for the smith, ending `open` (14 transactions). Sample
  verified on-chain: `reset` `Gp2ZsTmRztcoYqoBBGoNnrYckCJkYapoSKcsHRtfzohk`,
  `player_invest` `G3mSM6Bmgd4pVtudmV6uCYWa3MAmbVsYZUQ1LWpz5UWk`.
- Merchant agents: `driver/agent.js --rounds 2` — 8 real signed `merchant_decide`
  transactions; each proposal accepted and recorded in `last_decision`.
- UI: verified at 320 / 390 / 768 / 1280 / 1440 px (no horizontal overflow; no
  browser-console errors; text contrast ≥ AA by measurement, compositing translucent
  backgrounds; touch targets ≥44 px on phones); every action and the CLOSED/REOPENED
  ledger rows link to a real explorer transaction. Reference screenshots of the
  released read-only UI are in `docs/screenshots/release-w{320,390,768,1280,1440}.png`.

> Live checks require the deployed contract to exist and the owner to be funded. If
> testnet has reaped `town.ledgertown.testnet`, redeploy first (`driver/deploy.js`).
> A full redeploy on a fresh account needs the owner to hold testnet NEAR; the free
> faucet is rate-limited, so the account must be topped up from a funded wallet.
