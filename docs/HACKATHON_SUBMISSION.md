# Ledgertown — NEAR Hackathon submission readiness

> **Track:** `games` (Games With Real Economies). Secondary fit: `agents`, `open`.
> **Deadline:** 2026-11-14T23:59:00Z. **Submission API:** `POST https://nearhackathon.com/api/applications`.
> Source of truth: https://nearhackathon.com/HACKATHON.md (read again before submitting).
>
> This file is a **readiness checklist and demo plan**, not the submission itself. The
> submission is sent only by the human, with the human-decided values below.

---

## 1. One-line pitch

A market town where every shop is an autonomous on-chain agent with its own NEAR
account and till. Players gather and trade; if they flood the market a merchant goes
insolvent, closes, and can be revived by investment. The economy evolves on its own —
no dev patch, no randomness, byte-reproducible.

## 2. Why this fits the `games` track

The track asks for *"NPCs with wallets, player-owned markets and economies that evolve
without a dev patch"*, judged on the **game loop**. The example prompt for the track
describes this exact loop (market town, NPC merchants, flood iron → cheap iron,
merchant closes until someone invests). Ledgertown is that loop, live on NEAR testnet.

| Track ask | Ledgertown | Status |
| --- | --- | --- |
| NPCs with wallets | Four merchants, each a real testnet subaccount (`smith.ledgertown.testnet` …) signing its own txs | **Done** |
| Economy evolves without a dev patch | Prices/stock/cash are contract state; closure + revival are on-chain events | **Done** |
| Judged on the game loop | 15 healthy days → flood → insolvency → close → invest → reopen → recover | **Done** |
| Merchant pricing rules in one readable file | `driver/agent.js` `decideForMe` (one pure function) | **Done** |
| Show a merchant's reasoning | On-chain `last_decision`, surfaced per shop as an ACCEPTED/REJECTED tag plus a plain-language line | **Done** |
| Fast-forward a week in a minute | `tick` advances one day; UI has **Advance one day** and **Fast-forward 7 days** (each day a separate real tx) | **Done** |
| Items as NEP-245 multi-tokens | Items are contract-internal balances on one contract | **Gap** (one contract holds all items, but not via NEP-245) |
| Social / email login, no popups | Local testnet key files; local play server | **Gap** (local harness, per Q-012) |

Gaps are disclosed here and in the README. Q-011 states track hints are hints, not
requirements; Q-012 allows a local-only demo with a reproducible README.

### Public hosting status (read this before the demo)

The project is deployed at **https://ledgertown.vercel.app/** (Vercel Hobby plan, free).
The hosted server runs **read-only with no keys loaded**: it serves the real UI and live
`town.ledgertown.testnet` state, so every figure and explorer link is real, and it proxies
the key-free `/api/player` purse read. Invalid input returns `400`, oversized bodies
`413`, and owner-only/`deposit` routes `400`.

Play is **non-custodial and does not need a server signer**. The player connects their own
NEAR testnet wallet (e.g. Freighter); the wallet extension signs each action in the
browser and the site never sees the key. The only methods the browser will ever ask a
wallet to sign are `player_init`, `player_gather`, `player_buy_from`, `player_sell_to`,
`player_invest` and `tick` — never `deposit` or an owner-only method.

Personal play needs the **per-account** contract build. The site detects the model at
runtime (the `player_model` view) and **degrades honestly**: until the owner deploys the
upgrade it says so in the play band and keeps the trade buttons disabled, while the
market stays fully live. The upgrade is proven safe first —
`node scripts/verify-migration.js` decodes the live state with the old layout and prints
`EXACT MATCH`; the owner then runs `node driver/upgrade.js` (deploy wasm + `migrate()`),
which preserves every merchant, event and shock. No website key is ever required.

## 3. NEAR's role (say this plainly in the demo post)

NEAR is the **authoritative ledger and the source of the agents' autonomy**:

- Each merchant is its **own NEAR account** that signs its own `merchant_decide`
  transactions — the merchant is not a server-side script pretending to act.
- The **contract enforces the economic rules** (reserve, stock bounds, price clamps)
  and records closure/revival as on-chain events. The agent *proposes*; the chain
  *decides*.
- The engine is **deterministic and byte-reproducible** (exact rational arithmetic on
  `i128`), and is tested for **exact 30-day parity** between the Rust contract and an
  independent Python reference model.

## 4. Judge demo script (60 seconds)

The hosted site is live at **https://ledgertown.vercel.app/**. It is fully playable once
the per-account upgrade is deployed: a judge can connect a NEAR testnet wallet and act
without any server keys. Until that upgrade is live the play band says so and the trade
buttons stay disabled, while the market stays fully live and readable.

1. Open **https://ledgertown.vercel.app/** and point at the four shop panels: each shows
   its own NEAR account, cash against its reserve, stock against its restock target, its
   sell/buy prices with margin, the agent's recorded decision, and a plain-language risk
   line. Point at the **price board** (cheapest quote marked) and the **scarcity strip**.
2. Connect a NEAR testnet wallet. The **play band** shows your net worth and three
   challenges read from the live town (an arbitrage, a rescue, or a free gather).
3. Click **Gather iron**, then **Sell iron** to the smith. Show the cargo and credits
   change and the new hash appear under "Your transactions"; open it on the explorer.
4. Click **Advance one day** a few times; show prices move as merchants restock and
   undercut each other. Point at the **Town ledger** events.
5. Scroll to the **lifecycle timeline** and the ledger's recorded **`CLOSED`**
   (day 22, cash −2) then **`REOPENED`** (day 31, cash 198) for the smith — the
   economy evolved on its own. Both rows link to the real transactions; the
   **On-chain provenance** panel lists the 14 verified txs that built today's town.
6. Say the one line: *"Every number here is read from a real NEAR testnet contract, and
   every action is a real transaction your own wallet signs."*

Fallback if testnet is unreachable: run `node driver/demo.js` locally (reproducible
from the README) and show `demo-log.json` plus the explorer hashes.

## 5. Evidence already verified (see README "Evidence")

- Contract `cargo test` — **20 passed**, incl. per-account purse isolation, owner-only
  migration, and exact 30-day parity vs the reference.
- `node --test tests/*.test.js` — **104 passed** (policy, failure detection, chain guard,
  server guards, handler incl. `/api/player`, town client, the economy derivations the UI
  reads, the game logic, the town scene, the non-custodial wallet layer, Vercel entry).
- Reference model — `feasibility/tests.py` **25/25**; `feasibility/exploits.py` **39/39**.
- Live parity vs deployed `town.ledgertown.testnet` — **PASS, 120 rows, 0 mismatches**.
- Lifecycle — `CLOSED` day 22 → `REOPENED` day 31, ending `open` (14 txs).
- Merchant agents — 8 real signed `merchant_decide` txs, accepted and recorded.
- Migration safety — `scripts/verify-migration.js` decodes the live `STATE` (2922 bytes)
  with the old layout: **EXACT MATCH**, so the per-account upgrade cannot corrupt state.
- Non-custodial play — headless-browser E2E with an injected wallet: `player_init`,
  `tick`, `player_gather`, `player_buy_from`, `player_sell_to` each sign exactly one
  action; no owner or `deposit` method is ever signable.
- Public deployment — `https://ledgertown.vercel.app/` read-only: `/healthz` and
  `/api/state` serve live day-51 state over the public internet with no keys; nested
  routes (`/api/action/<name>`) reach the handler (valid actions `503` read-only,
  owner-only/deposit `400`, invalid input `400`, oversized body `413`); all security
  headers present; browser console clean.
- UI — no horizontal overflow and no console errors at 320/390/768/1280/1440 px;
  text contrast ≥ AA by measurement; each action and the CLOSED/REOPENED ledger rows
  link to a real explorer transaction. Screenshots: `docs/screenshots/release-w*.png`.

## 6. Submission payload — values the human must supply

Do **not** invent any of these. The human provides them; the agent builds the payload
from their answers and sends only after they confirm. `website` must stay absent (spam trap).

| Field | Source | Notes |
| --- | --- | --- |
| `requestId` | generated once (`uuidgen`/`crypto.randomUUID`), reused on retries | keep it |
| `projectName` | human | 2–80 chars, e.g. "Ledgertown" |
| `leadName` | human | 2–80 chars |
| `email` | human | ≤160 chars, ≤2 submissions per email |
| `size` | human | one of `1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+` |
| `tracks` | human confirms | `["games"]`; add `agents`/`open` only if the human agrees they fit |
| `nearAddress` | human | mainnet payout account, lowercase named/implicit |
| `projectUrl` | human | public repo URL (must be public by the deadline) |
| `demoUrl` | human | public X post link (human publishes it) |
| `idea` | drafted from §1–§3 | 20–2000 chars |
| `consent` | human | read the notice verbatim, then `true` |

## 7. Pre-submission checklist

- [x] Repository is **public** (`itzebe/ledgertown`).
- [x] `LICENSE` file present (Q-014), MIT, holder `itzebe`.
- [x] README states what is real vs baseline (Q-002/Q-003) and how to reproduce.
- [x] PR #1, #2 (public release) and #3 (Vercel nested-route fix) merged to `main`
      (judges read the default branch).
- [ ] Demo video recorded and X post published by the human (`@NEARProtocol`, `#NEARHackathon`).
- [ ] Payload printed and confirmed by the human; sent once.
- [ ] **Owner action:** run `node scripts/verify-migration.js` (expects `EXACT MATCH`)
      then `node driver/upgrade.js` to activate non-custodial per-account play on the
      live contract. Until then the hosted site is live and readable but not playable.
- [x] Hosted demo live at `https://ledgertown.vercel.app/`; keep up through 2026-11-18.

## 8. Recommended small additions before the deadline

1. **Merchant-reasoning affordance** — *done*: each shop shows the contract's recorded
   `last_decision` as an **ACCEPTED/REJECTED** tag with a plain-language line, and an
   opt-in panel states the full policy and that the contract has the last word.
2. **Playable game loop** — *done*: a play band with wallet connect, live net worth, and
   three challenges derived from the live town; each challenge button signs the right
   action with the player's own wallet (non-custodial).

Larger, optional, higher risk (disclose as gaps if not done): NEP-245 item tokens, and
social/email login without key files. **Done already:** the fast-forward control, the
per-account purses, and the MIT `LICENSE`.
