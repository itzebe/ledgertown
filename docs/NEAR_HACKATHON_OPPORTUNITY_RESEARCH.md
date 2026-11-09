# NEAR HACKATHON 2026 — Opportunity Research & Winning Recommendation

**Prepared:** 2026-11-09 (research-only; no code written, nothing submitted)
**Recommendation:** Build **Ledgertown** — an autonomous agent-run market town for the `games` track
(with `agents` as a secondary track).
**One line:** NPC merchants that are real economic agents with their own NEAR wallets and inventory,
whose prices, survival and shop closures are *earned* by a transparent local economy — and whose
on-chain identity is provable and individually ownable through NEAR sub-accounts.

---

## 0. How to read this document — facts vs assumptions

This report distinguishes three confidence levels throughout:

- **[VERIFIED]** — read directly from an official primary source (the live `HACKATHON.md`, the
  official project API, the official track prompts, NEAR/NEAR-Intents/NEAR-AI docs, or a public
  GitHub API response). Link given.
- **[OBSERVED]** — computed by me from a dataset I downloaded (the 368 live submissions), or read
  from a third-party page. Link or method given.
- **[ASSUMPTION]** — my judgement/estimate. Not a fact. Labelled every time.

The mission demanded that I not invent competition requirements. Every competition fact below is
quoted or directly derived from `https://nearhackathon.com/HACKATHON.md`.

---

## 1. Research methodology

1. **Primary source first.** Fetched `https://nearhackathon.com/` and the canonical
   `https://nearhackathon.com/HACKATHON.md` (22,199 bytes, 246 lines) and read it in full.
2. **Official prompts.** Downloaded all 13 track prompt files plus `README.md` from
   `github.com/nearai/near-hackathon-prompt-examples` (via the GitHub tree API and raw files).
3. **Actual competitor set, not guesswork.** Discovered the live submissions endpoint
   `GET https://nearhackathon.com/api/projects` (returns 8 per page, `total: 368`) and paginated
   all 368 live submissions into `research/all_projects.json`. This is the real, current competitor
   set — not a name search.
4. **Infrastructure verification.** Read the official docs for NEAR Intents 1Click Swap API, the
   Agent API (Agents on Intents), Chain Signatures, NEAR AI Cloud, Access Keys, NEP-245, NEP-141,
   NEP-171, the Top Level Accounts (TLA) contracts, the Sputnik DAO contract, and the NEAR agent
   skills library.
5. **Prior-art search.** GitHub repository search API for the candidate areas (chain signatures,
   intents, escrow/dispute, freelancing, NPC economies, DAO bounties). Web search engines were
   captcha-blocked (DuckDuckGo) or returned generic crypto noise (Bing), so **web-scale prior-art
   search is weaker than I would like** — this is stated as a limitation, not hidden.

**Limitations (honest):**
- I could **not** read the full project directory page `nearhackathon.com/projects` (404) or an
  individual-project endpoint; the API exposes only `id`, `project_name`, `tracks`, `demo_url`.
  So competitor analysis is at **name + track** granularity, plus whatever the name implies. I did
  **not** read 368 repos. Claims about what competitors *do* are inference from names/tracks and are
  labelled as such.
- Web-scale originality search was blocked. "No prior art found" means "none found via GitHub API
  and the official directory", not "provably none exists".
- The submission count (368) is a **snapshot at 2026-11-09**; it will grow before the deadline.

---

## 2. Verified competition facts

### 2.1 Key dates and the real remaining window  **[VERIFIED]**

| Fact | Value |
| --- | --- |
| Hackathon starts | 2026-11-01T00:00:00Z |
| **Development ends / submission deadline** | **2026-11-14T23:59:00Z** |
| Judging | 2026-11-16 → 2026-11-18 |
| Results by | 2026-11-18T23:59:00Z |
| Code before start allowed? | Yes, from the 2026-10-19 announcement; earlier commits are "baseline" (Q-001) |

**Remaining time from today (2026-11-09T13:44Z):** about **5 days and 10 hours** to the deadline.
This matches the mission's "3–5 development days" constraint — **the 5-day plan in §8 is the whole
window, not a subset of it.**

### 2.2 The 13 tracks  **[VERIFIED]** — ids are exact strings for the submission API

| # | id | Track | Tagline | Organizer hints |
| --- | --- | --- | --- | --- |
| 1 | `defi` | Unstoppable DeFi | Markets that never close | Trading, NEAR Intents, Chain Signatures |
| 2 | `thesis` | Investment Thesis | Make the long-term case | Onchain data, dashboards, research |
| 3 | `privacy` | Privacy & Private AI | Private by design | Private AI, TEE, NEAR AI Cloud |
| 4 | `business` | Autonomous Business | The company of one, or none | AI agents, NEAR Intents, Chain Signatures |
| 5 | `swarms` | AI Swarms | Many agents, one economy | Multi-agent systems, NEAR Intents, sub-accounts |
| 6 | `security` | AI Security & Defense | Trust, but verify | Agent security, function-call keys, TEE attestation |
| 7 | `agents` | Agent Economy | Give AI a wallet | Agent commerce, NEAR Intents, Chain Signatures |
| 8 | `realworld` | Real-World Money | Bring the boring money onchain | Stablecoins, NEAR Intents, meta transactions |
| 9 | `games` | Games With Real Economies | The economy is the gameplay | Agent NPCs, social login, NEAR Intents, NEP-245 |
| 10 | `nfts` | NFTs That Do Something | What comes after the JPEG | Dynamic NFTs, NEP-171, sub-accounts |
| 11 | `memecoins` | Memecoins With Mechanics | The joke needs rules | Memecoins, token mechanics, NEP-141 |
| 12 | `social` | Social Money | Coordinate value together | Sputnik DAO, Trezu, named accounts |
| 13 | `open` | Open Innovation | Something we haven't seen | Experimental, chain abstraction, build your own |

### 2.3 Prizes  **[VERIFIED]**

Prize pool **$250,000**, paid in NEAR to the account in the submission:

| Prize | Amount | Count | Total |
| --- | --- | --- | --- |
| Grand prize | $55,000 | 1 | $55,000 |
| 1st place (per track) | $10,000 | 13 | $130,000 |
| 2nd place (per track) | $3,000 | 13 | $39,000 |
| 3rd place (per track) | $2,000 | 13 | $26,000 |

**Key structural insight [OBSERVED/ASSUMPTION]:** there are **13 separate $10,000 first prizes**, one
per track. A project competes against *the other entrants in its track*, not against all 368. This
makes **track selection the single highest-leverage strategic decision**, and it directly favours a
strong entry in a **thin** track over a strong entry in a **saturated** one.

### 2.4 Judging and submission requirements  **[VERIFIED]**

- **Two-stage judging (Q-017):** Claude Code and Codex do **screening** — reproducibility check,
  feature verification, a structured report, a preliminary score. **Humans decide.** "Low AI score
  alone cannot reject."
- **README must be written for a machine reader as well as a human one:** what the product is, the
  problem it solves, and **"do X, see Y" steps a judge can follow**. No marketing.
- **Submission is via API:** `POST https://nearhackathon.com/api/applications`. Fields: `requestId`
  (UUID, reused on retry), `projectName` (2–80), `leadName` (2–80), `email` (≤160, ≤2 submissions
  per email), `size` (`1`|`2 - 4`|`4 - 6`|`6 - 8`|`8+`), `tracks` (array of ids), `nearAddress`
  (mainnet), `projectUrl` (public repo, unique — one submission per repo), `demoUrl` (public post),
  `idea` (20–2000 chars), `consent` (true). **`website` is a spam trap — any value rejects.**
- **One submission per project.** Mistakes are fixed via `nearhackathon.com/request-changes`, never
  by re-submitting.
- **Repo must be public** by the deadline. **An X demo post is required** (tags `@NEARProtocol`,
  `#NEARHackathon`, video/screenshots attached) — the **human** posts it.
- **Testnet-only projects are eligible in all tracks (Q-010).** Mainnet only where the integration
  is mainnet-only.
- **No mandatory integrations (Q-011):** "Own contract on NEAR that fits the track is enough."
- **Local-only demo is allowed (Q-012)** if the repo is public, the README is reproducible, and the
  X post has a video.

### 2.5 Available NEAR infrastructure and free tiers  **[VERIFIED]**

| Resource | What it gives you | Cost / access | Source |
| --- | --- | --- | --- |
| Testnet accounts + faucet | Free testnet NEAR | Free | docs.near.org; near-faucet.io (HTTP 200) |
| Public RPC | Free RPC endpoints | Free | docs.near.org/api/rpc/providers |
| Chain Signatures (MPC) | A NEAR account (incl. a contract) signs txs for BTC/ETH/Solana/… | Protocol feature | docs.near.org/chain-abstraction/chain-signatures |
| NEAR Intents — 1Click Swap API | REST cross-chain swaps, quotes, status, refund handling | 0.2% fee without 1Click JWT; testnet does **not** exist (Q-007) | docs.near-intents.org |
| Agent API (Agents on Intents) | Each agent gets a policy-bound wallet; owner-signed rules; TEE proofs | **Mainnet-only beta**; demo keys rotate | docs.agentsonintents.com |
| NEAR AI Cloud | OpenAI-compatible API at `https://cloud-api.near.ai/v1`; TEE-hosted models; attestation | **$10 free credit via NEAR Builders (Q-000)**; pay-as-you-go | docs.near.ai/cloud; cloud.near.ai |
| NEAR AI Agent Market | Marketplace to list/hire agents, API at `/v1/*` | Platform | market.near.ai |
| Access keys | Function-call keys scoped to one contract | Protocol feature | docs.near.org/protocol/accounts-contracts/access-keys |
| Sub-accounts / TLAs | A named account can own child accounts | Protocol feature | nearaccounts.com; houseofstake/tla-contracts |
| Sputnik DAO | DAO/treasury contracts | Open source | github.com/near-daos/sputnik-dao-contract |
| NEAR agent skills | `near-ai-cloud`, `near-intents`, `near-dapp`, `near-smart-contracts`, `near-kit`, `near-cli-rs`, `near-contract-audit` | Free | github.com/near/agent-skills |
| NEP-245 / NEP-141 / NEP-171 | Multi-token, fungible, non-fungible standards | Free | github.com/near/NEPs |

**Free-infrastructure verdict [VERIFIED]:** the whole winning plan can run on **free testnet NEAR +
a local frontend + free-tier hosting**, with **no paid API on the critical path**. NEAR AI Cloud is
the only optional paid element, and the $10 Builders credit covers a demo; the design keeps it
off the critical path (see §8.4).

---

## 3. Competitive analysis — what is already being built  **[OBSERVED]**

I pulled **all 368 live submissions** at 2026-11-09 from `nearhackathon.com/api/projects`.

### 3.1 Track saturation (submissions per track)

| Track | Submissions | Share of 368 | Competitive read |
| --- | --- | --- | --- |
| `security` | **180** | 49% | 🔴 Extremely crowded |
| `agents` | **176** | 48% | 🔴 Extremely crowded |
| `realworld` | 77 | 21% | 🟠 Busy |
| `open` | 66 | 18% | 🟠 Busy |
| `privacy` | 66 | 18% | 🟠 Busy |
| `business` | 64 | 17% | 🟠 Busy |
| `defi` | 60 | 16% | 🟠 Busy |
| `thesis` | 32 | 9% | 🟢 Moderate |
| `swarms` | 31 | 8% | 🟢 Moderate |
| `nfts` | 29 | 8% | 🟢 Moderate |
| `games` | 28 | 8% | 🟢 **Thin** |
| `social` | 28 | 8% | 🟢 **Thin** |
| `memecoins` | **20** | 5% | 🟢 **Thinnest** |

- **64% of all submissions (237/368)** touch `security` or `agents`. **32% (119/368)** touch *both*.
- **113 projects (31%)** are submitted to 2 tracks; 80 to 3; 30 to 4. Multi-track submission is
  normal — a project can aim at a thin track while listing its natural secondary tracks.

### 3.2 Idea clusters inside the crowded tracks (name-based)

| Cluster | Count | Representative names |
| --- | --- | --- |
| Spending limits / "leash" / guard | **~55** | Leash (×5), AgentGuard (×6), Allowance (×3), SpendGuard, Veto, Bridle, Halter, Capgrate, Mandate (×2), GetLeash, LEASH, Agent Allowance Guard (×2) |
| x402 / toll / paywall | 7 | Tollgate (×3), Agent Toll, x402-near, RedactGate |
| Dispute / court / arbitration | **3** | Jurat, Judge on NEAR, AgentEscrow |
| Games / NPC economies | 28 (track total) | most are single-track; see §3.3 |
| Reputation / bounty | 2 | NEAR Thesis Scorecard, Bountybot |

**Conclusion [OBSERVED]:** the `security`/`agents` space is not merely crowded — it is
**pathologically redundant**. Dozens of near-identical "give the agent an allowance / leash it"
projects will be compared against each other. Originality there is now very hard to demonstrate,
and the AI screener will see the same product repeatedly.

### 3.3 What is actually in the `games` track  **[OBSERVED]**

28 submissions total. The ones that describe a **player-facing economic game loop**:

| Project | Tracks | Read |
| --- | --- | --- |
| **Meridian** | swarms, agents, games, nfts, memecoins, social | Spans 6 tracks — likely a broad "economy/simulation" play; the closest direct rival |
| **Bazaar Sovereign** | swarms, agents, games, nfts, open | Spans 5 tracks — market/economy play |
| **Lantern Caravan** | swarms, agents, games | Caravan-trade economy (multi-agent) |
| **Grind District** | games, open | Looks like a game world |
| **Afterlight / Ashes of the Ninth Heaven / SCOGÉ Universe / Worldo / Nearverse / Nims / TreasureHunt / DeepSea Hunter / Pump Rider / TokenGo / Q-day** | mostly games | Single-track games; NPC-economy depth unknown |

**Honest read [OBSERVED + ASSUMPTION]:** the `games` track is **thin** (28 vs 180), and several of
the largest entrants (`Meridian`, `Bazaar Sovereign`, `Lantern Caravan`) are **multi-agent
"economy" projects that list games as one of 4–6 tracks** — i.e. they are primarily agent/swarm
plays that *also* claim games. A **single-focus, deep, judge-verifiable economic game** is therefore
both rare in this track and differentiated from the agent-swarm crowd. I could not read their code,
so I state this as inference, not proof.

### 3.4 Prior art outside the hackathon  **[VERIFIED via GitHub API]**

| Area | Found | Note |
| --- | --- | --- |
| NEAR + game + NPC | 3 repos, all ★0 | e.g. `vertum111/lunearcy` ("raise dragons … economy runs on NEAR"); no established project |
| NEAR + top level accounts | `CrossChainLabs/near-registrar` ★4; House of Stake `tla-contracts` | Infrastructure exists; **no game uses it** |
| NEAR + chain signatures | `near/chainsig-lib` ★7; `0xAlphaDevs/Bitcoin-Agent` ★4 | Building blocks, not a game |
| NEAR + intents swap SDK | 2 repos, ★0–3 | Nascent |
| NEAR + escrow/dispute | 1 repo, ★0 (`rjrajput-web3/escrowpact`) | Almost empty space |
| NEAR + freelance marketplace | 3 repos, ★0–5 (Neargigs, HireNear) | Weak, dormant |
| NEAR + DAO bounty | 1 repo, ★0 (`emilhuseyn/patch-fund`) | Almost empty space |

**Originality evidence for the winner [VERIFIED]:** GitHub API returned **zero** repositories for
`near npc agent economy` (total_count 0), and only **★0 hobby repos** for `near game npc`. The
official hackathon directory contains **no project whose name or track set describes an
agent-run NPC economy with merchant agents owning wallets** (the nearest are the multi-track
`Meridian`/`Bazaar Sovereign`/`Lantern Caravan`, which are agent-economy plays). The TLA/account-NFT
primitive exists but **no game or product uses it**. That is a genuinely open seam.

---

## 4. The strategic thesis

Three verified facts drive everything:

1. **13 independent $10K first prizes** → winning a *thin* track is easier than placing in a
   saturated one. **[VERIFIED]**
2. **`security` + `agents` = 64% of all entries** → the marginal value of a new "agent guard"
   project is near zero. **[OBSERVED]**
3. **`games`, `social`, `memecoins` are 5–8% of entries** → real headroom. **[OBSERVED]**

The trap: the thin tracks are thin *because they are harder*. Games need a real game loop; social
needs real coordination; memecoins need a real mechanic. The mission explicitly warns against
choosing the easiest idea. So the winner must be a **hard-track project that a solo builder can
still ship in 5 days** — which means the difficulty must be *game feel and economy legibility*, not
infrastructure.

**Also respected:** the builder's prior work (TRACESETTLE = authorization/settlement; INTENTPAY =
payment intents; PACT = negotiation/settlement; AFTERMATH = learning from verified failures) is
**not** renamed or extended. Ledgertown shares only the generic "agents transact" theme, and its
core — a persistent, playable **game world** with emergent NPC economies — is a different product
category.

---

## 5. Shortlist — six opportunities across all 13 tracks

Each idea was checked against the 10 feasibility criteria and the six anti-slop exclusions.

---

### Idea 1 — **Ledgertown** (working name) — autonomous agent-run market town
*Track: `games` (+ `agents`)*

1. **One-sentence explanation:** A playable market-town game where every NPC merchant is an
   autonomous economic agent with its own NEAR account and inventory, whose prices, solvency and
   shop closures emerge from real supply/demand and who can be invested in or own its shop as an
   account-NFT.
2. **Problem:** On-chain "games" today are mostly token wrappers; "agent economy" demos are
   dashboards, not worlds. There is no product where you can *feel* an agent economy — where you
   watch a merchant agent go broke because the market flooded with iron, and where the agent's
   on-chain identity is a real, ownable account.
3. **Target users:** Hackathon judges (60-second legibility), web3 game players, and the NEAR
   agent-economy audience who want a *tangible* demonstration of autonomous economic agents.
4. **Why existing solutions are insufficient:** The `games` track has 28 entries, but the big ones
   are multi-track agent/swarm plays; GitHub has **zero** repos for "NEAR NPC agent economy". No
   existing project makes merchant *agents* into *wallets with inventory that can die and be
   revived*.
5. **What makes it different:** the economy is the product and the NPCs are the agents; prices,
   stockouts and bankruptcies are computed by a **deterministic, readable pricing model** (judges
   can audit the rules), and each NPC's identity is **verifiable on-chain via a NEAR sub-account**.
6. **Relevant NEAR tech:** NEAR sub-accounts (per-NPC agent identity), NEP-245 multi-token items,
   testnet NEAR for wallets, optional NEAR AI Cloud for flavour dialogue, optional chain signatures
   for "the town's external bank" (a stretch only).
7. **Exact MVP:** ~6 merchant NPCs with wallets + inventory; 3–4 item types as NEP-245; a
   deterministic price function (`price = f(stock, recent_demand, cash)`); a player who gathers
   and trades; visible consequences (price crash, shop closure, revival by investment); a
   **fast-forward** control that simulates a week in a minute; an NPC detail panel that shows the
   *reasoning* behind a price.
8. **Architecture:** small Rust contract (`town`) holding inventory + ledger + pricing rules; a
   TypeScript/React frontend that calls view methods for state and a `trade` method for writes;
   NPC agent loop runs **deterministically in the contract/engine** (no LLM on the critical path).
9. **Development complexity:** Medium. The contract is small; the hard part is making the economy
   legible and the UI convincing.
10. **Estimated time:** 4–5 focused days.
11. **Free infra:** testnet accounts + faucet; free RPC; static hosting; optional $10 NEAR AI credit.
12. **Judge demo:** "do X, see Y" — flood the market with iron → watch iron's price fall and a
    merchant's cash hit zero → see the shop close → invest to revive it. All from real transactions.
13. **Main technical risks:** making the economy *interesting* rather than trivial; avoiding a
   slow/janky UI; ensuring the pricing model is auditable and not a black box.
14. **Competitive landscape:** 28 games entries, mostly single-track; nearest rivals are multi-track
   agent-economy plays (`Meridian`, `Bazaar Sovereign`, `Lantern Caravan`); no GitHub prior art for
   NPC-agent economies on NEAR.
15. **Supporting evidence:** track saturation 28/368; GitHub `near npc agent economy` = 0 repos;
   official prompt explicitly suggests "a market-town game" with agent merchants.

**Scores:** Originality 8 · Usefulness 7 · NEAR relevance 7 · Feasibility 8 · Differentiation 8 ·
Demo impact 9 · Judging potential 9 · Post-hackathon 7 → **see §6**

---

### Idea 2 — **Fairpath** — autonomous milestone escrow with jury arbitration
*Track: `realworld` (+ `open`, `business`)*

1. **One-sentence:** Trustless milestone escrow for freelancer↔client work where the **client's own
   agent** verifies deliverables against a pre-agreed, machine-checkable spec, and disputed
   milestones go to a stake-weighted juror panel — with USDC paid out over NEAR Intents.
2. **Problem:** ~3 dispute/court projects exist and freelance escrow on NEAR is essentially empty
   (★0 repos). Freelancers and clients have no neutral, automatic arbiter.
3. **Target users:** freelancers, small agencies, and cross-border clients who don't share a legal
   system.
4. **Why insufficient:** `rjrajput-web3/escrowpact` is ★0 and milestone-only; `Jurat`/`Judge on NEAR`
   are the only dispute entries. No project combines **agentic verification** + **juror arbitration**
   + **cross-chain payout**.
5. **Different:** the *verification is automated first* (agent checks a spec), and humans/jurors only
   handle genuine disputes; the spec is public and re-runnable.
6. **NEAR tech:** escrow contract, function-call keys for the verifier agent, NEAR Intents 1Click for
   payout, staking for jurors.
7. **MVP:** create a job with N milestones + a machine-checkable spec; fund it; submit work; the
   verifier agent returns pass/fail per milestone; a dispute opens a juror vote; funds release or
   refund; all events visible.
8. **Architecture:** Rust escrow contract + off-chain verifier service (deterministic spec runner) +
   web UI. Juror voting in-contract.
9. **Complexity:** Medium-high (two trust mechanisms).
10. **Time:** 5 days.
11. **Free infra:** testnet + faucet; free RPC. **Intents payout is mainnet-only → demo must use a
    simulated/testnet-native token instead (constraint).**
12. **Demo:** a milestone fails verification → dispute → jurors vote → funds split automatically.
13. **Risks:** juror collusion (needs a clear threat model); "verification" of creative work is hard
    to make honest; mainnet-only Intents complicates the demo.
14. **Landscape:** near-empty (1 escrow repo ★0, 3 dispute entries).
15. **Evidence:** GitHub counts above; track `realworld` at 77 entries (busy) — a minus.

**Scores:** Originality 8 · Usefulness 9 · NEAR relevance 7 · Feasibility 6 · Differentiation 8 ·
Demo impact 7 · Judging potential 7 · Post-hackathon 9

---

### Idea 3 — **Proving Ground** — a public benchmark + reputation registry for NEAR agents
*Track: `agents` (+ `thesis`, `open`)*

1. **One-sentence:** A neutral, reproducible **arena** that runs agents through standard tasks inside
   a TEE and publishes a **verifiable score and record** — turning "which NEAR agent can I trust?"
   into a checkable fact instead of a claim.
2. **Problem:** `agents` is 48% of all entries and there is **no** common way to compare them.
   Reputation exists (2 entries) but nothing is a *benchmark*.
3. **Target users:** agent developers, the NEAR AI Agent Market, and buyers hiring agents.
4. **Why insufficient:** `NEAR Thesis Scorecard` and `Bountybot` are not agent benchmarks; nothing
   in the directory measures agent capability reproducibly.
5. **Different:** it does not add another agent — it adds the **missing measuring stick** for all of
   them, with TEE-attested, re-runnable results.
6. **NEAR tech:** NEAR AI Cloud TEE + attestation, NEAR account for the registry, market.near.ai
   listing.
7. **MVP:** a fixed task suite; a runner that executes an agent and records pass/fail + cost +
   latency; a TEE attestation per run; a public leaderboard with a re-run button.
8. **Architecture:** registry contract (records) + runner service + static leaderboard.
9. **Complexity:** Medium.
10. **Time:** 4–5 days.
11. **Free infra:** testnet; **$10 NEAR AI credit may be consumed fast by repeated runs** → keep the
    task suite tiny.
12. **Demo:** submit an agent → watch it run the suite → a signed score appears on the board → a
    second, weaker agent scores lower.
13. **Risks:** **does not fit the stated criteria well** — it is *more* agent-infrastructure in the
    most saturated track, and "a benchmark" is less of a *product* than a tool; judge appeal is
    niche.
14. **Landscape:** crowded track; nothing identical, but the audience is saturated.
15. **Evidence:** 176 agent entries; 2 reputation entries; no benchmark found.

**Scores:** Originality 7 · Usefulness 7 · NEAR relevance 6 · Feasibility 7 · Differentiation 6 ·
Demo impact 6 · Judging potential 5 · Post-hackathon 7

---

### Idea 4 — **Loom** — a live, verifiable "supply-shock simulator" for the NEAR economy
*Track: `thesis` (+ `open`)*

1. **One-sentence:** An interactive simulator that lets anyone inject a shock (a big Intents inflow,
   a fee change, a staking shift) into a transparent model of NEAR's flows and **watch the
   consequences play out**, with every assumption editable and every number sourced.
2. **Problem:** `thesis` entries (32) are overwhelmingly static dashboards; none let a reader *test*
   a hypothesis interactively.
3. **Target users:** analysts, delegates, and judges who want to *do* something, not read a chart.
4. **Why insufficient:** dashboards show the past; Loom models the future and makes the model
   inspectable.
5. **Different:** it is a *toy you can break*, not a report you read.
6. **NEAR tech:** NEAR BigQuery public dataset, Intents Explorer API, static hosting.
7. **MVP:** 4–6 coupled state variables; sliders for shocks; a chart that responds; a "sources"
   panel; a THESIS.md with claims and counter-evidence.
8. **Architecture:** a pre-computed dataset + a client-side model + a static page. No contract needed.
9. **Complexity:** Low-medium.
10. **Time:** 3 days.
11. **Free infra:** **BigQuery is *not* free — "you pay normal BigQuery costs"** (track 02 note).
    This is a real constraint.
12. **Demo:** drag a slider → the chart moves → open a number and see its source.
13. **Risks:** **the track explicitly says "the score depends on evidence someone else can reproduce"**
    — a simulator is *model*, not *evidence*; judges may see it as speculation. BigQuery cost. Least
    NEAR-native (no contract, no chain).
14. **Landscape:** 32 entries, all evidence-based dashboards; this would be the odd one out — risky.
15. **Evidence:** track 02 prompt (quoted); 32 entries.

**Scores:** Originality 7 · Usefulness 6 · NEAR relevance 4 · Feasibility 7 · Differentiation 6 ·
Demo impact 7 · Judging potential 4 · Post-hackathon 5

---

### Idea 5 — **Sublet** — rentable NPC/agent sub-accounts as ownable, income-earning assets
*Track: `nfts` (+ `agents`, `open`)*

1. **One-sentence:** An **agent you can own and rent out**: an account-NFT (NEAR sub-account) that
   runs a small revenue-producing service, so holding it entitles you to its earnings and selling it
   transfers the wallet, the service and the income stream.
2. **Problem:** "NFTs that do something" is under-explored; `nfts` has 29 entries and GitHub has no
   "own an agent" product. There is no way to *own* an economic agent as an asset.
3. **Target users:** crypto-native investors who want productive assets; agent developers who want a
   distribution channel.
4. **Why insufficient:** `Agent NFT` and `Handover` exist but are not *revenue-producing agent
   accounts with rental*.
5. **Different:** ownership of an *income stream* with a real underlying account, not a JPEG.
6. **NEAR tech:** sub-accounts, NEP-171, TLA-style account NFTs, optional Chain Signatures for the
   agent's external actions.
7. **MVP:** mint an account-NFT; the account runs one scripted service that earns testnet tokens;
   earnings accrue to the holder; transfer moves control; a rental mode splits earnings.
8. **Architecture:** NEP-171 contract + sub-account control logic + a simple service runner.
9. **Complexity:** Medium (account control on transfer is fiddly).
10. **Time:** 4–5 days.
11. **Free infra:** testnet + faucet.
12. **Demo:** buy an agent → it earns → sell it → the income follows the new owner.
13. **Risks:** **overlaps the builder's "ownership" and payments history more than is ideal**; the
    "service" is a weak link (what does the agent actually *do*?); income on testnet is fictional,
    which risks feeling fake (violates the "no fake data" principle unless framed honestly).
14. **Landscape:** 29 NFT entries; `Agent NFT`, `Handover`, `Deed` are adjacent.
15. **Evidence:** 29 entries; GitHub prior-art searches.

**Scores:** Originality 7 · Usefulness 6 · NEAR relevance 7 · Feasibility 6 · Differentiation 7 ·
Demo impact 6 · Judging potential 6 · Post-hackathon 7

---

### Idea 6 — **Civic** — a live "workshop" for agent-run public services
*Track: `social` (+ `open`, `business`)*

1. **One-sentence:** A workshop where a community **collectively owns a fleet of service agents**,
   sets their budgets and rules by vote, and watches them deliver real work — with every payout
   traceable and every agent's spending constrained by the community's own policy.
2. **Problem:** `social` (28) is thin and mostly DAO tooling; nobody has made "a community that runs
   its own agents" tangible.
3. **Target users:** DAOs, mutual-aid groups, online communities.
4. **Why insufficient:** `Sputnik DAO`/`Trezu` handle treasury, but no entry shows communities
   *operating* agents as shared infrastructure.
5. **Different:** the community is the *owner and operator*, and the agents are the *labour*.
6. **NEAR tech:** Sputnik DAO / Trezu treasury, function-call keys for agents, named accounts.
7. **MVP:** a treasury; a proposal to fund an agent's budget; the agent does a task and pays a
   contributor; a public log of every action.
8. **Architecture:** existing DAO contracts + an agent runner + a dashboard. **Reuses** partner
   contracts (low code).
9. **Complexity:** Low-medium.
10. **Time:** 3–4 days.
11. **Free infra:** testnet + faucet.
12. **Demo:** vote to hire an agent → it does a job → the payout appears in the log.
13. **Risks:** **feels closest to the builder's existing payment/coordination projects (INTENTPAY,
    PACT)** — highest risk of being "another version" of prior work; agent labour is hard to make
    real; risks looking like DAO plumbing.
14. **Landscape:** 28 social entries; `AllTogether`, `Nearfund`, `FairShare`, `Potluck`.
15. **Evidence:** 28 entries; official social prompt.

**Scores:** Originality 6 · Usefulness 7 · NEAR relevance 7 · Feasibility 8 · Differentiation 5 ·
Demo impact 6 · Judging potential 6 · Post-hackathon 7

---

## 6. Comparative scoring (judge's lens)

Scores are 1–10. I deliberately did **not** inflate. Justifications are the evidence column, not
vibes.

| Idea | Orig | Use | NEAR | Feas | Diff | Demo | Judge | Post | **Total /80** |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **1. Ledgertown (games)** | 8 | 7 | 7 | 8 | 8 | 9 | 9 | 7 | **63** |
| 2. Fairpath (realworld) | 8 | 9 | 7 | 6 | 8 | 7 | 7 | 9 | **61** |
| 3. Proving Ground (agents) | 7 | 7 | 6 | 7 | 6 | 6 | 5 | 7 | **51** |
| 4. Loom (thesis) | 7 | 6 | 4 | 7 | 6 | 7 | 4 | 5 | **46** |
| 5. Sublet (nfts) | 7 | 6 | 7 | 6 | 7 | 6 | 6 | 7 | **52** |
| 6. Civic (social) | 6 | 7 | 7 | 8 | 5 | 6 | 6 | 7 | **52** |

**Evidence behind the deciding columns:**

- **Ledgertown Demo 9:** a 60-second judge moment is *designed into* the product — flood the market,
  watch a merchant go broke and close. Nothing else on the shortlist produces a visible consequence
  that fast. **[ASSUMPTION based on the product shape; verify by building.]**
- **Ledgertown Judge 9 / Differentiation 8:** the track is 28/368 (thin), the big rivals are
  multi-track agent plays (inference), and GitHub shows zero prior art for NPC-agent economies.
  **[VERIFIED counts + OBSERVED inference.]**
- **Fairpath loses on Feasibility (6) and Demo (7):** two trust mechanisms + a **mainnet-only**
  Intents dependency for the payout makes a clean testnet demo harder, and disputes take longer than
  60 seconds to show. **[VERIFIED mainnet-only constraint.]**
- **Proving Ground loses on Judge (5):** it *adds to the most saturated track* with a tool, not a
  product. **[OBSERVED 176 agent entries.]**
- **Loom loses on NEAR relevance (4) and Judge (4):** no contract, and the track explicitly rewards
  *reproducible evidence*, which a simulator is not. **[VERIFIED track text + BigQuery cost note.]**
- **Sublet and Civic lose on Differentiation (7 / 5):** Sublet overlaps "ownership" and risks fake
  testnet income; Civic is closest to the builder's own INTENTPAY/PACT space. **[ASSUMPTION +
  mission constraint.]**

---

## 7. Selected winner — **Ledgertown**

### 7.1 Why this beats the other five

1. **Thin track, real difficulty.** `games` is 28/368 (8%) — a $10K first prize is contested by far
   fewer teams than in `security`/`agents` (180/176). But it is not the *easy* pick: it demands a
   real game loop, which the mission explicitly wants over a token wrapper. **[VERIFIED + OBSERVED]**
2. **Distinct from the agent crowd.** The biggest `games` entrants are multi-track agent/swarm
   projects; Ledgertown is a **single-focus economic game**. It sidesteps the 64%-of-entries
   security/agent pile-up entirely. **[OBSERVED]**
3. **Zero prior art found.** GitHub: `near npc agent economy` → **0 repos**; `near game npc` → ★0
   hobby repos. Official directory: no NPC-economy game. The TLA/account-NFT primitive exists but no
   product uses it. **[VERIFIED]**
4. **Demo is the product.** The judge moment (flood → price crash → bankruptcy → revival) is a
   *consequence*, not a claim, and it fits the required "do X, see Y" README format perfectly.
   **[ASSUMPTION; to be validated by building.]**
5. **Feasible in the real window.** A small contract + a frontend + a deterministic engine is a
   4–5-day build, and the whole thing runs on **free testnet infrastructure with no paid API on the
   critical path**. **[VERIFIED infra + ASSUMPTION effort.]**
6. **NEAR is load-bearing, not decorative.** Each merchant is a **real NEAR sub-account** — its
   on-chain identity is the game's fiction made true. That is a concrete NEAR-specific advantage the
   README can state plainly (avoiding the "vague powered-by-NEAR" trap the organizers warn about).
7. **Different from prior work.** It is a **game world**, not an authorization, payment, settlement
   or failure-learning product. It does not rename TRACESETTLE/INTENTPAY/PACT/AFTERMATH.

### 7.2 The one honest weakness

The **riskiest assumption** is that a solo builder can make the economy *legible and fun* in 5 days.
If the economy is trivial, the demo falls flat regardless of the on-chain story. The mitigation is
built into the plan: **a fast-forward control and a mandatory pre-coding RULES.md**, so the economy
is designed and tuned *before* any UI work (§8.1, §8.5).

---

## 8. Winning execution blueprint

### 8.1 Final product concept

**Ledgertown** is a small browser market town. You play a trader. The town's shops are run by NPC
**merchant agents**, each of which:

- has its **own NEAR sub-account** (e.g. `smith.ledgertown.testnet`) — its identity and till,
- holds **inventory** of items (NEP-245 multi-token),
- sets prices from a **single readable function** of stock, recent demand and its cash,
- can go **bankrupt and close** when cash hits zero, and be **revived** when someone invests.

**Tagline (draft):** *"The economy is the gameplay — and the shopkeepers are real accounts."*

### 8.2 Positioning

- **Not** a token game, **not** a dashboard, **not** an agent-guard.
- **Is** the `games` track's clearest "economy is the gameplay" entry, with NPCs that are *agents*
  in the strict sense (autonomous, stateful, with wallets) and whose identity is *provable on-chain*.

### 8.3 Core user journey (one loop)

1. Open the town. See 5–6 shops with visible stock and prices.
2. Gather a resource (one click) or buy low from a glutted shop.
3. Sell into a shop. **Watch its price fall** and its stock rise.
4. Repeat until one shop's cash hits zero → it **closes** (visibly shuttered).
5. Invest testnet NEAR/tokens to **revive** it; it reopens with adjusted prices.
6. Press **Fast-forward** to simulate a week and watch the whole economy settle.
7. Open a shop's panel to see **why** its price is what it is.

### 8.4 MVP feature boundaries (do only these)

**In scope:**
- 5–6 merchant agents, each with a sub-account, cash, inventory and a pricing rule.
- 3–4 item types as **NEP-245** multi-tokens (one contract).
- Deterministic pricing in **one file** (`pricing.ts` / a Rust module) — auditable.
- `trade` (player↔shop), `invest`, `revive` actions; `view` methods for all state.
- **Fast-forward** simulation (pure function, no LLM).
- NPC detail panel showing the pricing *reasoning*.
- A plain README with "do X, see Y" steps for the AI screener.

**Out of scope (explicitly cut):** social login, cross-chain Intents payments, chain-signature
external banking, generative dialogue, PvP, crafting trees, leaderboards, mobile optimisation beyond
a responsive pass. *(Optional, only if days 1–4 finish early: NEAR AI Cloud flavour dialogue behind
a feature flag.)*

### 8.5 Technical architecture

```
┌────────────────────────────┐        ┌─────────────────────────────┐
│  Frontend (React + TS)     │        │  town contract (Rust)       │
│  - town view, shop panels  │  view  │  - items: NEP-245           │
│  - fast-forward control    │ ─────▶ │  - merchant cash/inventory  │
│  - "why this price?" panel │  call  │  - pricing rules (one file) │
└────────────────────────────┘        │  - trade / invest / revive  │
             │                        └─────────────────────────────┘
             │ localStorage/JSON                 ▲
             ▼                                   │ sub-account per merchant
   ┌────────────────────┐              ┌──────────────────────────────┐
   │ pricing engine     │              │ smith.ledgertown.testnet ... │
   │ (pure, deterministic)│             │ (real testnet accounts)      │
   └────────────────────┘              └──────────────────────────────┘
```

- **Contract:** one Rust contract, `near-sdk`, NEP-245 for items; the pricing function lives in the
  contract so it cannot be "switched off".
- **Engine:** the same pricing function mirrored in TypeScript for the fast-forward simulation
  (single source of truth documented; a test asserts both agree on fixtures).
- **Accounts:** each merchant gets a **testnet sub-account** at deploy time; the contract records the
  mapping. (Sub-account creation is a small, scriptable deploy step.)
- **No database.** State is on-chain + a static JSON snapshot for the leaderboard/history.

### 8.6 Recommended stack

- **Contract:** Rust + `near-sdk`, built with `cargo near build`, deployed to testnet.
- **Frontend:** React + TypeScript + Vite; a small canvas or CSS grid for the town.
- **Wallet:** `@near-wallet-selector` (testnet), or a **key-in-env demo mode** for judges who don't
  want a wallet.
- **Hosting:** static host (Vercel/Netlify free tier) — free.
- **No paid services on the critical path.** NEAR AI Cloud is optional and feature-flagged.

### 8.7 NEAR integrations and their exact purpose

| Integration | Purpose in Ledgertown | Required? |
| --- | --- | --- |
| **NEAR sub-accounts** | Give each merchant agent a real, named on-chain identity (its till) | **Yes — the differentiator** |
| **NEP-245 contract** | One contract holds every item type; clean, standard, auditable | **Yes** |
| **Testnet + faucet** | Free accounts and funds for the demo | **Yes** |
| **Free RPC** | Read state and submit trades | **Yes** |
| NEAR AI Cloud | Optional NPC flavour dialogue (never on the pricing path) | No (stretch) |
| Chain Signatures | "The town's external bank" — a stretch only, cut if time runs short | No |
| NEAR Intents | Only if the town trades with "outside" assets — cut from MVP | No |

### 8.8 Database requirements

**None.** All authoritative state is on-chain (contract) or in the repo (static JSON fixtures). This
keeps the architecture small and the demo reproducible — a judge clones, runs one command, and sees
the same world.

### 8.9 API requirements

**None external.** The only "API" is the contract's own `view`/call interface plus the frontend's
RPC calls. This removes an entire class of demo failure.

### 8.10 Security considerations

- **Keys:** the deployer key lives in an environment variable, never committed. If a demo key is
  needed, use a **function-call key scoped to the `town` contract** — never a full-access key.
- **Validation:** every `trade`/`invest` amount is validated in the contract (positive, within the
  caller's balance) — no unvalidated input reaches state.
- **Honesty:** all testnet balances are labelled as testnet; **no fabricated metrics** (the README
  must not claim real users or real money).
- **README limits:** state plainly that merchant "wallets" are testnet accounts and that the economy
  is a simulation, so nothing masquerades as real.
- **Blast radius:** testnet only; no mainnet deployment, no real funds.

### 8.11 UI/UX direction (per the design constitution's gate)

- **The three weaknesses of the default approach** (before building): (1) a generic dashboard with
  cards, not a *place*; (2) prices shown as numbers with no visible *cause*; (3) no moment where the
  player *feels* the economy move.
- **Visual direction:** a **print-shop / ledger** aesthetic — cream paper, one ink accent (rust red),
  monospaced figures for prices, hairline rules instead of card shadows. The town is a **map of
  shopfronts**, not a grid of tiles. The one thing to remember: **you can watch a shopkeeper go
  broke.**
- **Rules:** one accent colour that means "value at risk"; a real type scale; no gradients, no
  glassmorphism, no emoji icons, no rounded-2xl+shadow-xl on everything; visible focus rings;
  full set of states (default/hover/focus/active/disabled, loading, empty, error, success);
  responsive at mobile/tablet/desktop; verify by screenshot, not assumption.

### 8.12 Testing strategy

- **Contract unit tests (Rust):** pricing function fixtures; `trade` changes price in the expected
  direction; bankruptcy triggers at cash = 0; `revive` restores solvency; access checks.
- **Engine parity test (TS):** the TypeScript pricing function returns identical results to the Rust
  one on a fixture set (guards the "single source of truth" claim).
- **Integration:** deploy to a **local sandbox** (`near-workspaces`) and run one full loop.
- **Frontend:** a scripted Playwright pass of the demo journey, screenshots at 3 widths.
- **Reproducibility:** one command rebuilds the world from fixtures; the README documents it.

### 8.13 Deployment strategy

1. Build + test the contract locally (`cargo near build`, `cargo test`, `near-workspaces`).
2. Deploy to **testnet**; create merchant sub-accounts with a script.
3. Deploy the frontend to a free static host; keep it live through **2026-11-18** (ideally
   **2026-11-25**, per Q-012).
4. Keep a **local demo mode** so the project still demos if hosting hiccups (Q-012 allows this).

### 8.14 Five-day implementation schedule

| Day | Goal | Deliverable | Gate |
| --- | --- | --- | --- |
| **0.5** | Design | `RULES.md` + `DESIGN.md` + the pricing formula on paper; a 60-day simulation in a scratch script showing supply/price behaviour | *Stop and sanity-check the economy before coding* |
| **1** | Contract | `town` contract: NEP-245 items, merchant state, `trade`/`invest`/`revive`, pricing module; unit tests green | `cargo test` passes |
| **2** | Engine + sim | TS pricing mirror + parity test; fast-forward simulation; 5–6 merchant sub-accounts deployed on testnet | Parity test green; accounts exist |
| **3** | Frontend v1 | Town view, shop panels, trade/invest/revive, "why this price?" panel; wallet + key demo mode | One full loop runs against testnet |
| **4** | Polish + consequences | Bankruptcy/revival visuals, fast-forward UI, states (loading/empty/error), responsive pass, screenshots at 3 widths | Visual QA done, screenshots saved |
| **5** | Harden + ship | `near-workspaces` integration test; README "do X, see Y"; demo video script; repo public; X post drafted (human posts) | All checks green; README reproducible |

**Buffer rule:** Day 5 has no new features — only hardening, the README and the demo. Anything not
done by end of Day 4 is cut, not squeezed.

### 8.15 Judge demonstration script (60 seconds)

> **0–5s — The problem.** "On-chain games today are token wrappers. I want to show you an economy
> you can *feel*."
> **5–15s — The town.** Show the map of 6 shops with live stock and prices, each shop labelled with
> its own NEAR account (e.g. `smith.ledgertown.testnet`).
> **15–30s — Do X.** Flood the iron market: sell a big pile into the smith.
> **30–40s — See Y.** Iron's price collapses, the smith's cash drains to zero, the shopfront
> **shutters**. Open the panel: "cash 0 · stock 900 · price floor hit."
> **40–50s — Revive.** Invest a small amount; the shop reopens with corrected prices.
> **50–60s — Why NEAR.** "Each shopkeeper is a real testnet account, and the pricing rule is in the
> contract — nobody can switch it off." Point at the explorer link for one merchant account.

### 8.16 Expected evidence of genuine functionality

- **On-chain:** testnet transaction hashes for trades/investments; the contract account; the merchant
  sub-accounts (verifiable in an explorer).
- **Reproducible:** one command rebuilds the world; the parity test proves the sim matches the
  contract.
- **Behavioural:** a recording of price crash → bankruptcy → revival, produced by real transactions.
- **Honest:** README states testnet-only, simulation, and what is *not* built.

---

## 9. Risks and feasibility assessment

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Economy feels trivial/unfun | Medium | High | Design `RULES.md` + simulate 60 days **before** coding (Day 0.5 gate) |
| Contract/engine drift | Low | Medium | Parity test; pricing lives in one documented place |
| Sub-account creation friction | Medium | Medium | Script it; fall back to one parent account + mapping table if needed |
| Frontend jank / slow demo | Medium | Medium | Keep the town simple; key-demo mode with no wallet popups |
| Time overrun (5-day window) | High | High | Hard cut list (§8.4); Day 5 = no new features |
| Judges see "another agent demo" | Low-Medium | Medium | Single-focus game, visible consequences, on-chain identity — not a dashboard |
| Originality claim too strong | Low | Medium | Report states "no prior art *found*", not "provably unique" |

**Feasibility verdict [ASSUMPTION]:** the build is comfortably inside the window *if* the economy is
designed before coding and the feature list is respected. The single biggest threat is scope creep,
not technology.

---

## 10. Sources and working links

**Competition (primary):**
- Hackathon site — https://nearhackathon.com/ ✅
- **HACKATHON.md (canonical, read in full)** — https://nearhackathon.com/HACKATHON.md ✅
- **Live submissions API (368 projects)** — https://nearhackathon.com/api/projects ✅
- Submission API — `POST https://nearhackathon.com/api/applications` ✅
- Request changes — https://nearhackathon.com/request-changes ✅
- Track prompts (13) — https://github.com/nearai/near-hackathon-prompt-examples ✅
- NEAR AI credits — https://cloud.near.ai ✅ · NEAR Builders — https://nearbuilders.org/build ✅

**NEAR infrastructure (primary):**
- NEAR docs — https://docs.near.org/ ✅
- Tools for AI agents — https://docs.near.org/getting-started/tools-for-ai ✅
- Chain Signatures — https://docs.near.org/chain-abstraction/chain-signatures/getting-started ✅
- Access keys — https://docs.near.org/protocol/accounts-contracts/access-keys ✅
- Public RPC — https://docs.near.org/api/rpc/providers ✅
- NEAR Intents 1Click — https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api ✅
- Agent API — https://docs.agentsonintents.com/integration/agent-api/overview ✅
- NEAR AI Cloud — https://docs.near.ai/cloud/quickstart ✅
- NEAR AI Agent Market — https://market.near.ai/ ✅
- Agent skills — https://github.com/near/agent-skills ✅
- NEP-245 — https://github.com/near/NEPs/blob/master/neps/nep-0245.md ✅
- Top Level Accounts contracts — https://github.com/houseofstake/tla-contracts ✅
- Sputnik DAO — https://github.com/near-daos/sputnik-dao-contract ✅
- Testnet faucet — https://near-faucet.io ✅

**Local research artifacts (in `research/`):**
- `HACKATHON.md` (full copy), `all_projects.json` (368 submissions), `tracks/*.md` (13 prompts +
  README), `proj_*.json` (paginated raw pulls).

**Blocked sources (stated honestly):**
- `https://nearhackathon.com/projects` → **404**; no per-project API endpoint.
- DuckDuckGo HTML search → **captcha**; Bing → generic crypto noise. Web-scale originality search
  was therefore **not** possible; GitHub API was used instead.

---

## 11. One recommendation

**Build Ledgertown for the `games` track, with `agents` as a secondary track.**

It is the only shortlisted idea that combines (a) a **thin track** with a real $10K first prize
contested by ~28 teams instead of ~180, (b) **zero prior art found** on NEAR for agent-run NPC
economies, (c) a **60-second judge moment that is a consequence, not a claim**, (d) a **genuinely
NEAR-native** differentiator (every shopkeeper is a real sub-account), (e) a **5-day, free-testnet,
no-paid-API** build, and (f) a **different product category** from TRACESETTLE, INTENTPAY, PACT and
AFTERMATH.

**Why not the other four:**
- **Fairpath** is arguably the most *useful* idea (real freelancer pain) and would be my pick if the
  window were two weeks — but two trust mechanisms plus a **mainnet-only** Intents dependency make a
  clean 5-day testnet demo risky, and its drama unfolds over days, not 60 seconds.
- **Proving Ground** adds a *tool* to the **most saturated track** (176 entries) — the marginal
  originality is lowest exactly where the competition is densest.
- **Loom** has the **weakest NEAR connection** (no contract), and the `thesis` track explicitly
  rewards *reproducible evidence*, which a simulator is not; BigQuery also costs money.
- **Sublet** risks **fake testnet income** (an honesty problem) and overlaps the builder's existing
  "ownership" territory.
- **Civic** is the **closest to the builder's prior work** (INTENTPAY/PACT) and therefore the most
  likely to read as a repackaging — which the mission forbids.

**Immediate next step (still research-gated):** spend the first half-day writing `RULES.md` and
simulating 60 days of town behaviour in a throwaway script. If the economy is not visibly
interesting on paper, do **not** start the contract — switch to **Fairpath**. Everything else in the
Ledgertown plan is only worth building once that gate passes.

---

*This document is research only. No repository was created, no code was written, nothing was
deployed, purchased or submitted. All competition facts are from the live `HACKATHON.md`; all
competitor counts are from the live submissions API on 2026-11-09; all prior-art claims are from the
GitHub API and are stated as "none found", not "provably none exists".*
