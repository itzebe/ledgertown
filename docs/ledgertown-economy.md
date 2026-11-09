# Ledgertown — economy gate (2026-11-09)

Detail file for the Ledgertown economic-feasibility mission. Workspace:
`ledgertown-feasibility/`. Verdict: **PASS — build the contracts next.**

## Why this file exists
The 2026-11-09 research recommended Ledgertown (agent-run market town, `games` track). The gate
before writing any contract code was: *does the economy produce believable, interesting, sustainable
behaviour?* Answer: yes. This file records the durable decisions and numbers so the next session does
not re-derive them.

## Files (all standard-library Python 3.13, no deps)
- `RULES.md` — the authoritative rulebook (goods, pricing §5, competitive markup §5.1, demand §6,
  accounting §7, bankruptcy/lifeline §10, recovery §10.4, determinism §12, params table). **This is
  the spec the contracts must implement.**
- `simulate.py` — deterministic engine, exact `Fraction` arithmetic, SHA-256 run hash, per-day
  ledger with a **value-conservation assertion** (fires never).
- `run_sim.py` — 11 scenarios; `tests.py` (25 unit tests); `exploits.py` (39 probes);
  `sensitivity.py` (22-case sweep). `results/` holds per-day CSVs, town health, events.
- `LEDGERTOWN_ECONOMIC_FEASIBILITY.md` — the report with the verdict and evidence.

## Calibrated constants (in `simulate.py`, mirrored in RULES.md §4/§5/§13)
Goods grain/iron/cloth/ale: ref 12/21/33/15, cost 10/17/27/12, D_base 16/9/6/11.
`MARKUP=0.22`, `K_STOCK=0.35`, `FLOOR=0.60`, `CEIL=1.60`, `BID_RATIO=0.70`, `reserve_days=2`,
`bankrupt_grace=3`, `fixed_cost=25`, `start_cash=300`, `start_inv=20`, lifeline=3×fixed,
recovery_min=2×fixed, competitive-markup `STEP=0.02 MIN=0.05 MAX=0.60`.
Result: each good supports ~one healthy shop (~+7–11/day); two shops on one good fall to break-even.

## Hard-won findings (do not re-learn)
- **Exact `Fraction` arithmetic is the key design choice.** Money stays integer; averages are exact
  rationals. This is what makes the engine translatable to on-chain logic and reproducible.
- **The engine asserts value conservation every day** (sum of cash + inventory cost basis = prior +
  only external injections). This one assertion catches most accounting bugs for free.
- **`bid < list` always** is the structural rule that prevents money-minting loops (buy-low/sell-high
  round trips). Verified by probe C: sell 50 → buy back loses exactly 1,000.
- **The 60% floor** prevents a race to zero in a price war; `MARKUP_MIN` bounds the undercut.
- **The default town is too comfortable** (4/4 survive calm scenarios). Shocks must be authored to
  bite. **Product decision carried forward: ship a *troubled* town as the default.**
- **The LLM merchant layer is NOT covered by this gate** — the biggest open product risk.
- **A permanent demand collapse (×0.2) kills the whole town** at low/moderate capital → the model
  *can* be trapped in a failure state, deterministically. That is a feature (a town can die).

## Demo (60-second story) — scenario `09_demo_flood`
Player dumps 325 iron on the smith: price 21→13, cash 665→−4, **CLOSED day 23**; investor injects
120 on day 50 → **REOPENED**; recovers to 610 by day 60. Produced by rules, not scripted.

## Verification (exact)
`python3 tests.py` 25/25 · `python3 exploits.py` 39/39 · `python3 sensitivity.py` 22 cases
(18 all-survive, 2 total-collapse) · two runs + two `PYTHONHASHSEED`s produce identical output ·
`grep random|time()|uuid` finds none in code.

## Next phase
Build NEAR contracts + agent + UI against `RULES.md`, keeping the Python engine as the reference
implementation and the regression oracle (same scenario in → same hash out).
