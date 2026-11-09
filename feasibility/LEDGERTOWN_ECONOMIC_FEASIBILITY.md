# Ledgertown — Economic Feasibility Report

**Gate question:** does Ledgertown's economic simulation produce behaviour that is *believable*,
*interesting*, and *sustainable* enough to justify building the on-chain product?

**Verdict: PASS — build it.** The economy is deterministic, value-conserving, non-exploitable, and
it produces emergent stories (a glut crashes a price; a price war kills the weaker shop; a shock
closes a merchant; an investor revives it) that a judge can grasp in 60 seconds. The main caveat is
that the *default* town is too comfortable — shocks must be authored to bite — and that the single
most important open question (does an LLM merchant act sensibly against these rules?) is **not**
covered here, because it needs the agent layer.

- **Mission scope honoured:** research/simulation only. No smart contracts, no app code, no deploy.
- **Artifacts:** `RULES.md` (the rulebook), `simulate.py` (deterministic engine), `run_sim.py`
  (11 scenarios), `tests.py` (25 unit tests), `exploits.py` (39 probes), `sensitivity.py`
  (22-case sweep), `results/` (per-day CSVs + town health + events).
- **Stack:** Python 3.13 standard library only (`fractions.Fraction`, `hashlib`). No dependencies,
  no paid infrastructure, no network.

---

## 1. What was built (and what was deliberately not)

A **deterministic, exact-arithmetic model** of a four-shop market town. Every rule in `RULES.md`
has a line of code, and every scenario is a fixed function of its inputs — there is no randomness
anywhere (verified: `grep` for `random|time()|uuid|shuffle` finds only prose; two runs, and two
different `PYTHONHASHSEED`s, produce byte-identical output).

The engine is written to become the **on-chain rulebook**: pure integer/rational arithmetic, a
per-day ledger, and a SHA-256 hash of the whole run. If the model were ambiguous or depended on
floating point, it could not be reproduced on a blockchain. It is neither.

**Not built, on purpose:** the NEAR contracts, the LLM merchant agent, the UI, and any settlement.
Those are downstream of this gate.

---

## 2. The economic model in one screen

Four goods — **grain, iron, cloth, ale** — with reference prices **12 / 21 / 33 / 15** and restock
costs **10 / 17 / 27 / 12**. Four specialist merchants, one per good.

Each day, in fixed order, the engine:

1. **Restocks** each open merchant toward a target stock (`K_STOCK`), never dipping below a
   2-day fixed-cost reserve.
2. **Adjusts markups** competitively (§5.1): if a merchant is dearer than a rival in its own good it
   undercuts; if it is the cheapest it relaxes back toward target. Bounded, so no race to zero.
3. **Sets prices**: `list = clamp(avg_cost × (1+markup) × stock_factor, 60%·ref, 160%·ref)`, with
   `bid` a fixed fraction of list so **bid < list always**.
4. **Allocates demand**: customers prefer cheaper shops (price-sensitivity exponent 2.0), exactly
   filling demand when stock allows, otherwise recording lost demand.
5. **Settles** sales against an inventory cost basis (COGS) — money is integer, averages are exact
   rationals.
6. **Pays** each open merchant's fixed cost; applies **bankruptcy** (cash < 0 closes immediately, or
   three "dead days" at cash < fixed cost), a **one-shot lifeline**, and **investor revival** when
   injected cash reaches the recovery threshold.

The model conserves value **by assertion**: the engine checks every day that the sum of all cash
plus inventory cost bases equals the previous day's total plus the day's only external injections
(lifeline, investment, player gathering). This assertion has never fired.

---

## 3. The eight evaluation questions — answered from output

### Q1. Can merchants survive?

**Yes, comfortably, in the default town — arguably too comfortably.** `01_baseline`: 4/4 survive all
60 days, no events, town cash grows **1,643 → 4,064**, town profit a steady **+37/day**. The
sensitivity sweep confirms robustness: across **18 of 22** parameter cases every merchant survives,
including starting capital as low as 50 and fixed costs as high as 50.

**Reading:** the default parameters are a *healthy* economy, not a knife-edge one. That is a feature
for a demo (the town should look alive) and a warning for the design (see §6).

### Q2. Is the economy interesting?

**Yes — but only once you stress it.** In the calm baseline the four shops just tick along. Interest
comes from the shocks and the competition:

- **`05_price_war`** — two grain merchants undercut each other until the price hits the 13 floor.
  The cheaper, better-capitalised miller takes the whole market (16 units/day); the fragile
  newcomer `granary` (fixed cost 30, capital 70) bleeds to **-26 and CLOSES on day 25**. One
  merchant's ruin is another's monopoly. This is emergent — nothing in the code says "kill the
  rival".
- **`10_cost_shock`** — iron's cost doubles (×2.2) on day 10. The smith correctly raises its list
  price from **21 → 34**, but customers flee, its stock runs to zero, and it **CLOSES on day 30**.
  A price shock that the merchant *responds to correctly* still kills it — exactly the kind of
  "rational but doomed" behaviour that makes a market feel real.
- **`02_low_demand`** — a town-wide demand cut to 25% pushes every shop into daily losses
  (miller −17/day) for thirty days; they draw down cash from ~470 to ~80, then **recover the moment
  demand returns on day 51**, when daily profit flips from **−9 to +45**. A survivable recession with
  a visible trough.
- **`04_shortage`** — shops start empty and thin; prices spike **21 → 26** and **44 units** of
  demand go unmet. Scarcity produces visible rationing.

### Q3. Is it sustainable (long-run)?

**Yes in the default, no under permanent collapse — and that boundary is well-behaved.** Run to 60
days the baseline shows no drift, no oscillation, no runaway: profit is constant, cash grows
linearly. Under a **permanent** demand collapse (sweep 4, demand ×0.2 forever) the town reaches a
**failure state**: at capital 100 or 300, **0/4 merchants survive** (all close). This is the
"death spiral" answer (Q5) — the economy *can* be trapped, deterministically, and the model makes
that visible rather than hiding it.

### Q4. Is it exploitable?

**No exploitable loop was found; 39/39 probes pass.** The probes actively try to break it:

| Probe | Result |
| --- | --- |
| A — bid < list for every merchant/good | **pass** (no buy-low/sell-high round trip) |
| B — flood a shop to 400 units | **pass** (price floors at 60% of reference, never 0) |
| C — sell to a shop then buy back | **pass** (50 units in → **−1,000** out: a guaranteed loss) |
| D — repeatedly revive a shop | **pass** (each revival costs the investor exactly 120) |
| E — value conservation | **pass** (engine assertion held every day of every scenario) |
| F — revive a shop that died in debt | **pass** (it carries the debt; `-4 → 116`, not `-4 → 120`) |

The **floor** (60% of reference) is what prevents a race to zero; **bid < list** is what prevents
money-minting loops. Both are structural, not tuned.

### Q5. Can it be trapped in a failure state?

**Yes, and the trap is honest.** The permanent-collapse sweep shows the whole town dying at low or
moderate capital, and even at capital 800 one merchant dies. There is **no automatic rescue**: the
lifeline fires once per merchant and the investor must *choose* to spend. So a Ledgertown run can end
in a dead town. For a game this is the correct behaviour — the interesting question a judge asks is
"can the town die?", and the answer is a demonstrated **yes**, with a documented trigger.

### Q6. Does it respond to shocks?

**Yes, in the right direction, with the right shape.**

| Shock | Observable response |
| --- | --- |
| Demand ×0.25 (30 days) | prices dip, daily profit turns negative, cash troughs, recovers on day 51 |
| Demand ×3 (boom) | town revenue rises, **882 units** of demand unmet (the town cannot supply a boom) |
| Cost ×2.2 (30 days) | list price 21→34, stock to zero, merchant closes |
| Player floods 325 iron | list price **21 → 13**, merchant cash **665 → -4** |
| Rival enters the same good | price war, thinner margins, weaker shop closes |

The boom result is a nice find: **the town cannot serve a demand boom** — it runs out of stock and
loses 882 units of demand. That is a genuine, visible supply constraint.

### Q7. Does it produce a 60-second demonstration?

**Yes — `09_demo_flood` is a complete story in one scenario.** A player gathers iron and dumps it on
the smith:

| Day | Event | Cash | Iron | Price |
| --- | --- | --- | --- | --- |
| 17 | calm | 665 | 9 | 21 |
| 19 | flood begins | 143 | 50 | **13** |
| 23 | **smith CLOSES** | **-4** | 57 | 13 |
| 50 | investor injects 120 | 116 | 57 | — |
| 55 | trading again | 585 | 12 | 14 |
| 60 | recovered | 610 | 9 | 20 |

In sixty simulated days the town shows: **a glut crashes a price, a merchant goes bankrupt, an
investor buys it back, and it recovers.** That is the demo — and it is produced entirely by the
rules, not scripted. See §7 for the 60-second narration.

### Q8. Is it deterministic?

**Yes, proven four ways.** (1) No randomness in the code. (2) Two processes produce identical output
(`diff` clean). (3) Two different `PYTHONHASHSEED` values produce identical output — so dict
iteration order does not leak into results. (4) Every scenario prints a stable SHA-256 hash, and
`exploits.py` asserts each scenario reproduces its own hash on a second run. This is the property
that lets the same run be replayed on-chain and in a browser and agree to the last credit.

---

## 4. Scenario scoreboard (verified output)

```
scenario               hash              surv close reopen lifeline   lost    iron px
01_baseline            5a04763d99e19eba  4/4      0      0        0      0     20..21
02_low_demand          fc579da88f360632  4/4      0      0        0      2     20..22
03_excess_demand       bc27a833766e86ec  4/4      0      0        0    882     20..21
04_shortage            ceab30205f89e5d0  4/4      0      0        0     44     21..26
05_price_war           8e98cd700948a415  2/3      1      0        0   1031     20..21
06_overspend           8ad13f2ddc73036b  2/3      1      0        1    745     20..34
07_insolvency          78d1ff2be85868f7  3/4      1      0        0     77     20..34
08_invest_recovery     26753d2cece77daf  4/4      1      1        0     68     20..34
09_demo_flood          0209c047ac251c16  4/4      1      1        0     67     13..21
10_cost_shock          034bd9cda6b8a6a3  3/4      1      0        0    333     20..34
11_stress              31d7cc20205f6876  6/6      0      0        0    660     20..22
```

(`close` = closures, `reopen` = investor revivals, `lifeline` = lifeline grants, `lost` = unmet
demand units, `iron px` = iron list-price range.)

---

## 5. Verification evidence

| Check | Command | Result |
| --- | --- | --- |
| Unit tests | `python3 tests.py` | **25/25 passed** |
| Exploit/invariant probes | `python3 exploits.py` | **39/39 passed** |
| Sensitivity sweep | `python3 sensitivity.py` | **22 cases**, 18 all-survive, 2 total-collapse |
| Determinism (cross-process) | `python3 run_sim.py` ×2 + `diff` | identical |
| Determinism (hash seed) | `PYTHONHASHSEED=1` vs `99999` | identical md5 |
| No randomness | `grep -n "random\|time()\|uuid"` | none in code |

The unit tests name the rule they check, e.g. *"flooded price < price at target"*,
*"price never below floor"*, *"bid<list"*, *"demand N: allocated == demand"* (market clears),
*"no restock when cash < reserve"*, *"lifeline granted at most once"*,
*"investment below threshold does not reopen"*, *"avg_cost is exact rational (no float)"*.

---

## 6. Honest weaknesses and limitations

These are real and should shape the build:

1. **The default town is too comfortable.** 4/4 survive every calm scenario; shocks must be authored
   to create drama. **Fix in the product:** ship a "troubled town" default (thin capital, higher
   overheads, or a live rival) rather than the cosy baseline, so day 1 already has stakes.
2. **Demand is exogenous.** There is no wage, no income, no consumption feedback — customers are a
   fixed number per good. This keeps the model tractable but means the town cannot grow or shrink
   *endogenously*. Acceptable for a 5-day build; flag it as future work.
3. **The competitive-markup rule is a simplification.** Real merchants would price against expected
   demand, not just the current cheapest rival. The bounded undercut is a deliberate, tunable
   stand-in. It produces the *right qualitative behaviour* (thin margins, weaker shop dies) but is
   not a claim about real firm behaviour.
4. **The LLM merchant layer is untested here.** The most important product risk — *does an LLM given
   these rules and a daily balance sheet make sensible, in-character decisions?* — is outside this
   gate and **remains open**. The model is designed to be explainable to an LLM (each price has a
   `avg_cost × markup × stock_factor` breakdown), but that must be demonstrated in the next phase.
5. **No multi-good or multi-town coupling.** Each good's market clears independently. Cross-good
   effects (e.g. a grain shortage raising ale prices) are not modelled.
6. **Balancing is empirical, not derived.** `MARKUP=0.22`, `K_STOCK=0.35`, `FLOOR=0.60` were chosen
   by running the model until it produced the intended behaviour. They are defensible and documented
   but not derived from first principles.

None of these is a blocker. Items 1 and 4 are the ones that matter for winning.

---

## 7. The 60-second demonstration script

> "This is Ledgertown — a market town run by AI merchants, each with its own NEAR account and its
> own money.
>
> Watch the iron smith. It's healthy: nine bars in stock, a price of 21, 665 credits.
>
> Now I'm the player. I gather iron and dump it on the smith. **The price collapses — 21 to 13** —
> because that's what a glut does. And because I'm forcing it to buy, its cash drains too. *(point:
> cash 665 → 143 → 20)*
>
> **Day 23: the smith goes bankrupt.** Closed. Its account frozen. *(show the CLOSED event)*
>
> But Ledgertown has investors. Day 50, one injects 120 credits — more than the smith's debt — and
> the shop **reopens**, carrying the debt, and trades its way back to 610 by day 60.
>
> Every number you saw is produced by rules, not scripted. And here's the proof it's real: **the
> whole run hashes to `0209c047…`** — run it again, on any machine, and you get the same town,
> credit for credit."

---

## 8. What this gate licenses

Because the model is deterministic and value-conserving, it can be **translated directly into
contract logic** with confidence that the off-chain prototype and the on-chain version agree. The
next phase (contracts + agent + UI) is therefore de-risked on its hardest part: *the economics*.

**Recommended next step:** build the NEAR layer against `RULES.md`, keeping the Python engine as the
reference implementation and the regression oracle (same scenario in, same hash out).

---

## 9. Verdict

| Criterion | Result |
| --- | --- |
| Believability | **Pass** — prices, margins, bankruptcies and recoveries all read as a real market |
| Interest | **Pass** — emergent price wars, shock-driven ruin, booms the town can't serve |
| Sustainability | **Pass with a boundary** — stable by default; a permanent collapse can kill the town |
| Non-exploitability | **Pass** — 39/39 probes; no money-minting loop; value conserved |
| Determinism | **Pass** — reproducible across processes and hash seeds |
| Demo power | **Pass** — `09_demo_flood` is a complete 60-second story |
| Build-readiness | **Pass** — engine maps 1:1 onto contract rules |

**Gate decision: PASS.** Build the Ledgertown contracts and agent layer, using `RULES.md` as the
specification and the Python engine as the reference implementation and regression oracle. Carry the
two open items into the build: (1) ship a *troubled* town as the default, and (2) validate the LLM
merchant layer, which this gate did not cover.

*End of report.*
