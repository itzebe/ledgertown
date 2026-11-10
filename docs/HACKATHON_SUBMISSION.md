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
| Show a merchant's reasoning | On-chain `last_decision` string, surfaced in the UI per shop | **Partial** (shown as text, not a hover tooltip) |
| Fast-forward a week in a minute | `tick` advances one day; UI has **Advance one day** and **Fast-forward 7 days** (each day a separate real tx) | **Done** |
| Items as NEP-245 multi-tokens | Items are contract-internal balances on one contract | **Gap** (one contract holds all items, but not via NEP-245) |
| Social / email login, no popups | Local testnet key files; local play server | **Gap** (local harness, per Q-012) |

Gaps are disclosed here and in the README. Q-011 states track hints are hints, not
requirements; Q-012 allows a local-only demo with a reproducible README.

### Public hosting status (read this before the demo)

The project is deployed read-only at **https://ledgertown.vercel.app/** (Vercel Hobby
plan, free). It serves the real UI and live `town.ledgertown.testnet` state with **no
signing keys loaded**, so every figure and explorer link is real, but the trade and
fast-forward buttons are disabled and every action endpoint returns `503`.

Public play mode is deliberately **not** enabled: the contract has a single shared
`Player` purse, so a public play deployment would put one funded shared signer behind
anonymous visitors. The **interactive** demo (gather / sell / advance / invest) is run
locally in play mode with a throwaway demo key, exactly as in §4 below; the hosted site
is the key-free read-only view of the same contract.

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

1. Open the play UI (live state of `town.ledgertown.testnet`). Point at the four
   shops: each shows its own account, cash, stock, price and last decision.
2. Click **Gather iron**, then **Sell iron** to the smith. Show the cargo and credits
   change and the new hash appear under "Your transactions"; open it on the explorer.
3. Click **Advance one day** a few times (or **Fast-forward 7 days**); show prices move
   as merchants restock and undercut each other. Point at the **Town ledger** events.
4. Scroll the ledger to the recorded **`CLOSED` (day 22, cash −2)** then
   **`REOPENED` (day 31, cash 198)** for the smith — the economy evolved on its own.
5. Say the one line: *"Every number here is read from a real NEAR testnet contract, and
   every action is a real signed transaction."*

Fallback if testnet is unreachable: run `node driver/demo.js` locally (reproducible
from the README) and show `demo-log.json` plus the explorer hashes.

## 5. Evidence already verified (see README "Evidence")

- Contract `cargo test` — **11 passed**, incl. exact 30-day parity vs the reference.
- `node --test tests/*.test.js` — **49 passed** (policy, failure detection, chain guard,
  server guards, handler, town client, Vercel entry).
- Reference model — `feasibility/tests.py` **25/25**; `feasibility/exploits.py` **39/39**.
- Live parity vs deployed `town.ledgertown.testnet` — **PASS, 120 rows, 0 mismatches**.
- Lifecycle — `CLOSED` day 22 → `REOPENED` day 31, ending `open` (14 txs).
- Merchant agents — 8 real signed `merchant_decide` txs, accepted and recorded.
- Public deployment — `https://ledgertown.vercel.app/` read-only: `/healthz` and
  `/api/state` serve live day-51 state over the public internet with no keys; owner-only
  and `deposit` routes return `400`; oversized/malformed bodies are rejected.
- UI — no horizontal overflow at 320/390/768/1280/1440 px; text contrast ≥ AA; each
  action links to its real explorer transaction.

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
- [x] PR #1 merged to `main`; PR #2 (public release) merges the Vercel path (judges read
      the default branch).
- [ ] Demo video recorded and X post published by the human (`@NEARProtocol`, `#NEARHackathon`).
- [ ] Payload printed and confirmed by the human; sent once.
- [x] Hosted demo live (read-only) at `https://ledgertown.vercel.app/`; keep up through 2026-11-18.

## 8. Recommended small additions before the deadline

1. **Merchant-reasoning tooltip** — turn the `last_decision` text into a hover tooltip
   on each shop. Directly answers "show a merchant's reasoning"; ~1 hour. (The text is
   already shown per shop; only the tooltip affordance is missing.)

Larger, optional, higher risk (disclose as gaps if not done): NEP-245 item tokens, and
social/email login without key files. **Done already:** the fast-forward control and the
MIT `LICENSE`.
