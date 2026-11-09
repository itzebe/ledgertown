# Ledgertown — RULES.md

The complete economic model. Every rule here is **explicit, testable and explainable**.
The deterministic simulation in `simulate.py` implements exactly these rules; nothing else.
The smart-contract MVP (a later mission) must port these rules unchanged.

**Version:** 1.0.0 · **Status:** Feasibility gate spec · **Units:** abstract credits (1 credit = 1¢
of the later USDC-denominated economy). No tokenomics, no speculation.

---

## 0. Design principles

1. **Deterministic.** No randomness anywhere. Every event is a function of prior state. Two runs
   with the same inputs are byte-identical.
2. **Explainable.** Every number a player sees traces to a named rule below.
3. **Bounded.** Prices, inventory and balances have hard floors and ceilings, so no run can diverge
   into nonsense.
4. **Fair.** Identical merchants facing identical conditions behave identically; different outcomes
   come from *decisions and position*, not luck.
5. **Small.** Six merchants, four goods, one town. Complexity must earn its place.

---

## 1. Vocabulary

| Term | Meaning |
| --- | --- |
| **Town** | The whole economy: all merchants, all customers, the market clock. |
| **Merchant** | An NPC agent with its own NEAR sub-account, a cash balance, an inventory, a cost basis and a life state. |
| **Good** | One of four tradeable items. Each good has a reference price and a daily market demand. |
| **Customer** | A modelled shopper (aggregate, not an agent). Customers choose *which shop* to buy from, not whether to buy. |
| **Market day** | One simulation step. A "day" = one settlement cycle. |
| **List price** | The price a merchant offers for a good this day, computed by the pricing rule (§5). |
| **Sale price** | The price actually paid, after the competitiveness adjustment (§6.3). |
| **Lifeline** | The standard small recovery grant the town offers an insolvent merchant (§10.2). |

---

## 2. The town

- **Goods:** `grain`, `iron`, `cloth`, `ale`. Each has a fixed `reference_price` (§4.1) and a base
  daily market demand `D_base` (§6.1).
- **Merchants:** up to six, each specialising in one good but able to hold any good.
- **Market days:** 60 by default (configurable). Day numbering starts at 1.
- **Daily demand** for each good is fixed and known; demand does **not** drift randomly. Scenario
  variation comes only from explicit, dated **shocks** (§7).

---

## 3. Merchant state

Each merchant is defined by:

| Field | Type | Meaning | Constraint |
| --- | --- | --- | --- |
| `id` | string | stable identity | — |
| `name` | string | display name | — |
| `account` | string | its NEAR sub-account (`<id>.ledgertown.testnet`) | — |
| `specialty` | good | the good it restocks | one of §2 goods |
| `cash` | int | liquid credits | `>= 0` |
| `inventory` | map good→int | units on hand | `>= 0` |
| `cost_basis` | map good→int | total credits paid for units currently held | `>= 0` |
| `fixed_cost` | int | daily overhead (rent, upkeep) | `> 0` |
| `lifeline_used` | bool | has taken the lifeline this run | — |
| `bankrupt_days` | int | consecutive days insolvent | `>= 0` |
| `state` | enum | `open` \| `closed` | — |
| `closed_on` | int\|null | day it closed | — |
| `reopened_count` | int | times revived | `>= 0` |

**Derived:** `avg_cost(g) = cost_basis[g] / inventory[g]` when `inventory[g] > 0`, else
`reference_price[g]`.

---

## 4. Goods

### 4.1 Fixed constants

| Good | `reference_price` | `restock_unit_cost` | `D_base` (units/day) |
| --- | ---: | ---: | ---: |
| grain | 12 | 8 | 16 |
| iron | 21 | 14 | 9 |
| cloth | 33 | 22 | 6 |
| ale | 15 | 10 | 12 |

`restock_unit_cost` is about **80% of the reference price** (83% / 81% / 82% / 80%), so a merchant
that buys and sells at reference earns a **17–20% gross margin** before overhead. Daily gross margin
per good is `(ref − cost) × D_base` = **32, 36, 36, 33**, each above `fixed_cost = 25`, so a merchant
holding its specialty at target stock nets roughly **+7 to +11 credits/day** (§8, §9). This margin is
the town's *only* source of value creation; everything else is redistribution between merchants, the
player and the market.

**Why these numbers.** The margin is deliberately **thin**: a healthy shop survives comfortably but a
shock, a price war or a bad cost basis can push it into loss. That is the tension the model is built
to expose. Because each good supports roughly one healthy shop, **two merchants sharing one good's
demand each fall to roughly break-even** (§6.2, §15).

### 4.2 Stock limits

- `STOCK_MAX = 400` units per good per merchant. Restocking beyond this is refused.
- `STOCK_TARGET(good) = 2 × D_base(good)` units — the level a merchant aims to hold (§9).

### 4.3 The bid price (what a merchant pays to buy stock)

A merchant will also **buy** a good — from the player or another merchant — at its `bid_price`:

```
bid_factor = clamp(1 - K_STOCK * surplus_ratio, FLOOR, CEIL)     # same surplus_ratio as §5
bid_price  = clamp(round(reference_price × BID_RATIO × bid_factor), BID_MIN, BID_MAX)
BID_RATIO  = 0.70 ;  BID_MIN = 1 ;  BID_MAX = reference_price
```

Reading: a merchant pays ~70% of reference when it is at target stock, **less** when it is
overstocked (it does not want more) and **more** when it is short. The invariant `bid_price <
list_price` always holds (asserted in §12), so there is **no risk-free buy-low/sell-high loop**
between a shop's bid and its list — a deliberate anti-exploit rule.


---

## 5. Pricing algorithm

Each day, for each good `g` it holds, an **open** merchant sets:

```
surplus_ratio = (inventory[g] - STOCK_TARGET[g]) / STOCK_TARGET[g]      # can be negative
stock_factor  = clamp(1 - K_STOCK * surplus_ratio, FLOOR, CEIL)
```

| Constant | Value | Meaning |
| --- | ---: | --- |
| `K_STOCK` | 0.35 | how strongly stock moves price |
| `FLOOR` | 0.60 | a merchant never lists below 60% of reference |
| `CEIL` | 1.60 | …nor above 160% of reference |

```
base_price = avg_cost[g] * (1 + MARKUP_TARGET)          # MARKUP_TARGET = 0.30
list_price = clamp(round(base_price * stock_factor), PRICE_MIN, PRICE_MAX)
PRICE_MIN  = ceil(reference_price[g] * 0.60)
PRICE_MAX  = ceil(reference_price[g] * 1.60)
```

**Reading:** stock above target pushes the price **down** (toward the 60% floor); stock below target
pushes it **up** (toward the 160% ceiling). `avg_cost` anchors the price to what the merchant
actually paid, so a merchant that bought dear does not sell cheap.

**Explainability requirement.** The UI must be able to print, for any price:
`"list 13 = avg_cost 12.0 × 1.22 × stock_factor 0.90"`. The simulation emits these components.

**Insolvent merchants do not set prices** — they are closed (§10).

### 5.1 Competitive markup adjustment (price competition)

Prices are not static: a merchant with a **rival in its own good** adjusts its markup once per day,
*before* prices are set.

```
MARKUP_MIN = 0.05 ;  MARKUP_MAX = 0.60 ;  MARKUP_STEP = 0.02 ;  MARKUP_TARGET = 0.22

for each good g with >= 2 open shops holding g:
    for each shop m:
        if m.list_price[g] > min(rival list prices):  m.markup -= STEP   # undercut
        elif m.list_price[g] <= min(rival list prices): m.markup += STEP  # relax toward target
        m.markup = clamp(m.markup, MARKUP_MIN, MARKUP_MAX)
for each good g with < 2 shops:  each shop drifts back toward MARKUP_TARGET
```

**Reading:** two merchants in the same trade undercut each other until one is the cheapest, then the
cheapest relaxes back up — so the market settles at a **low, thin-margin clearing price** rather than
collapsing to zero. `MARKUP_MIN` makes a **race to zero impossible**; `MARKUP_MAX` stops a monopolist
gouging beyond the §5 price ceiling (which still applies). With a single merchant in a good, the
markup returns to target and the shop is comfortably profitable.

This rule is what turns "share competition" (§6.2) into genuine **price competition**, and it is the
mechanism that makes a price war fatal to the *weaker* merchant (the one with higher `fixed_cost` or
less capital) rather than to both.

---

## 6. Customers and demand

### 6.1 Daily demand

```
D(g, day) = clamp(round(D_base[g] * demand_multiplier[g](day)), 0, D_max)
D_max = 400
```

`demand_multiplier` is **1.0** except on days named by a shock (§7).

### 6.2 How customers choose a shop

Customers are **aggregate**: for each good, `D(g, day)` purchase attempts happen. Each attempt is
assigned to a shop by **deterministic share weighting**:

```
open_shops(g)      = merchants with state == open and inventory[g] > 0
attractiveness(m)  = (1 / list_price[m][g]) * price_sensitivity_exponent
share(m)           = attractiveness(m) / sum(attractiveness over open_shops(g))
units_to(m)        = largest-remainder split of D(g,day) by share(m)     # deterministic
```

- `price_sensitivity_exponent = 2.0`. A shop priced 10% lower gets roughly `1.1² ≈ 1.21×` the share;
  priced 25% lower, `1.25² ≈ 1.56×`. Cheaper shops win custom, but never monopolise.
- **Ties are broken by `merchant.id` ascending** — fully deterministic.
- **Largest-remainder split**: the integer units are allocated so the total equals `D(g, day)`
  exactly; remainders go to the merchant with the largest fractional part, ties by `id`.
- If **no** shop holds the good, the demand is **unmet** and is recorded as `lost_demand[g]`.

### 6.3 Sale price

```
if inventory[m][g] >= units_to(m):   sold = units_to(m);  sale_price = list_price[m][g]
else:                                sold = inventory[m][g]; sale_price = list_price[m][g]
```

A merchant cannot sell more than it holds. **A shopper that cannot be served at its chosen shop does
not re-route** — the unit is `lost_demand`. (This is a deliberate simplification: it makes
stockouts visibly costly, which is the behaviour we want judges to see. Recorded as a known
simplification in §14.)

### 6.4 Revenue and COGS

```
revenue(m, g) = sold * sale_price
cogs(m, g)    = round_half_up(sold * avg_cost(m, g))        # average-cost accounting, integer
cash         += revenue
inventory[g] -= sold
cost_basis[g] -= min(cost_basis[g], cogs(m, g))            # clamp at 0
```

`gross_profit(m, g) = revenue - cogs`. All money is integer, so the value-conservation identity of
§11.5 holds exactly.

### 6.5 The player (the demo's human actor)

The player is a single deterministic actor with its own `cash` and `inventory`. It has exactly two
verbs, both priced by the merchant's own rules:

| Verb | Effect |
| --- | --- |
| `gather(good, units)` | the player obtains units for free (a resource-gathering action) |
| `sell_to(m, g, units)` | the player sells to merchant `m` at `m.bid_price[g]`; `m.cash -= units × bid_price`; `m.inventory[g] += units` (refused above `STOCK_MAX`, or if `m` cannot pay from cash beyond its reserve) |
| `buy_from(m, g, units)` | the player buys from `m` at `m.list_price[g]`; limited by `m.inventory[g]` |

**Why the player matters.** A merchant never overstocks on its own (§9 tops up to target). The
**player is what can push a merchant above target** — which is precisely the official prompt's
"if players flood the market with iron, iron gets cheap". A flood moves the merchant's cash into the
player's pocket in exchange for goods the merchant cannot quickly resell, so the merchant's list
price falls **and** its cash drains. This is the mechanism behind the 60-second demo (§16).

Player actions are **scripted per day** in the scenario (deterministic, no randomness).


---

## 7. Shocks (the only source of variation)

A shock is a dated, explicit change to `demand_multiplier`. It is **data**, not randomness.

| Shock | Effect | Duration |
| --- | --- | --- |
| `demand_boom(g, x)` | `demand_multiplier[g] *= x` (x > 1) | days `[from, to]` |
| `demand_collapse(g, x)` | `demand_multiplier[g] *= x` (0 <= x < 1) | days `[from, to]` |
| `cost_inflation(g, x)` | `restock_unit_cost[g] *= x` | days `[from, to]` |

Shocks are listed in the scenario definition and printed in the run header, so any result can be
traced to its cause.

---

## 8. Operating expenses

Every **open** merchant pays, at the end of each day:

```
operating_expense = fixed_cost
```

`fixed_cost` is set per merchant at start (default **25** credits/day for a specialty shop). It is
paid whether or not the shop sold anything. **Closed merchants pay nothing** (their lease is
suspended — this is what makes closure a rational act, not a slow death).

---

## 9. Restocking

At the **start** of each day, an open merchant restocks toward `STOCK_TARGET`:

```
need(g)      = max(0, STOCK_TARGET[g] - inventory[g])
affordable   = cash_reserve_aware_units(need(g))         # see below
buy(g)       = min(need(g), affordable, STOCK_MAX - inventory[g])
cost         = buy(g) * restock_unit_cost[g]
cash        -= cost
inventory[g]+= buy(g)
cost_basis[g]+= cost
```

**Reserve rule (the merchant is not suicidal).** A merchant keeps a cash buffer so it does not spend
itself into bankruptcy:

```
RESERVE_DAYS = 2
reserve      = RESERVE_DAYS * fixed_cost
spendable    = max(0, cash - reserve)
affordable   = floor(spendable / restock_unit_cost[g])
```

If `spendable` cannot buy even one unit, the merchant buys nothing (and will likely struggle — that
is intended, and is how overspending/insolvency arise, see §10).

**Overspending is possible by construction:** a merchant with high `fixed_cost`, or hit by
`cost_inflation`, or starved of sales by a price war, will run its reserve down and then fail. No
special rule is needed to make bankruptcy reachable.

---

## 10. Bankruptcy, closure and recovery

### 10.1 Insolvency test (end of day)

After expenses are paid, a merchant is **insolvent** if:

```
cash < 0                                          OR
(cash < fixed_cost AND total_inventory_value == 0)  OR
(cash < fixed_cost AND no sale for 3 consecutive days AND inventory not moving)
```

To keep the rule simple and auditable, the model uses the **two primary tests**:

1. `cash < 0` — the merchant cannot meet its obligations. **Immediate closure.**
2. `cash < fixed_cost` for `BANKRUPT_GRACE = 3` consecutive days **and** the merchant has sold
   nothing on those days — a slow death. **Closure on the third day.**

`bankrupt_days` counts consecutive days on test 2. Any sale resets it to 0.

### 10.2 The lifeline (standard recovery)

Before a merchant closes, the town offers a lifeline — **once per merchant per run**, and only when
the scenario sets `lifeline_enabled = true`:

```
if insolvent and lifeline_enabled and not lifeline_used:
    cash += LIFELINE_GRANT            # LIFELINE_GRANT = 3 × fixed_cost = 120
    lifeline_used = true
    record LIFELINE event
```

The lifeline is a *deliberate, explainable subsidy* — it models the "invest to revive" mechanic in
its simplest deterministic form, and it lets the simulation show recovery without an investor agent.
It is once per merchant, so it cannot mask a structurally broken merchant. Scenarios that must show
a **genuine closure** set `lifeline_enabled = false` (§13).

### 10.3 Closure

```
state = closed; closed_on = day; stop paying fixed_cost; stop restocking; stop pricing.
```

A closed merchant keeps its cash and inventory (frozen). Its sub-account still exists.

### 10.4 Recovery by investment

An **investor** (a scenario actor) may revive a closed merchant:

```
if merchant.state == closed and investor.invest(merchant, amount):
    cash += amount
    if cash >= RECOVERY_MIN_CASH:      # RECOVERY_MIN_CASH = 2 × fixed_cost = 50
        state = open; reopened_count += 1; bankrupt_days = 0
        record RECOVERY event
    else:
        record INVESTMENT_INSUFFICIENT event
```

Investment must reach `RECOVERY_MIN_CASH`; a token gesture does not reopen a shop. The investor's
own cash is tracked, so "investment" is not free money — it is a transfer with an opportunity cost.

### 10.5 Merchant lifecycle

```
        start
          │
          ▼
       ┌──────┐   insolvent (cash<0, or 3 dead days)
       │ open │ ─────────────────────────────┐
       └──────┘                              ▼
          ▲                            ┌──────────┐
          │ revive (cash≥RECOVERY_MIN) │  closed  │
          └────────────────────────────┘──────────┘
                    (or stays closed forever)
```

States: `open → closed → open` (repeatable). A merchant with `lifeline_used` and no investor that
closes again stays closed for the rest of the run.

---

## 11. Economic fairness

1. **Identical merchants, identical outcomes.** Same good, same capital, same `fixed_cost` ⇒
   identical daily results.
2. **No luck.** The only asymmetry a run can introduce is a *stated* shock or a *different starting
   condition*; both are printed in the run header.
3. **Ties by `id`.** Every comparison and split is ordered deterministically.
4. **The market clears.** `sum(units_to) == D(g, day)` exactly, so demand is never silently lost to
   rounding.
5. **Value is conserved except at the stated margin.** Credits move only between merchants, the
   player and the town; the only *creation* is the gross margin on restocking, and the only
   *destruction* is `fixed_cost`. Each day the simulation asserts:

   ```
   Δ(total merchant cash + player cash) == total_revenue − total_restock_cost − total_fixed_cost
   ```

   over the goods traded that day (revenue and restock are already net of the same goods), so a
   drifting ledger fails the run loudly rather than quietly.
6. **Anti-exploit invariant.** For every merchant and good, `bid_price < list_price` (§4.3), so no
   actor can profit by buying a shop's own stock back from it.

---

## 12. Deterministic simulation rules

- **No `random`.** The simulation imports no random module. Determinism is enforced by test.
- **Integer money.** All money is integer credits; `avg_cost` uses one decimal place, rounded half-up,
  and is recomputed (not accumulated) each day to prevent float drift.
- **Largest-remainder allocation** for every split.
- **Stable iteration order** (sorted by `merchant.id`) for all per-merchant loops.
- **Assertions each day** (fail loudly, never silently):
  - `cash >= 0` for every merchant **or** the merchant is flagged insolvent and handled in §10;
  - `inventory[g] >= 0` and `cost_basis[g] >= 0`;
  - `sum(units_to) == D(g, day)`;
  - the value-conservation identity of §11.5.
- **Reproducibility contract:** `simulate.py` writes a SHA-256 of the full day-by-day ledger; the
  same scenario must always produce the same hash.

---

## 13. Configuration surface (the only knobs)

| Knob | Default | Where |
| --- | --- | --- |
| `days` | 60 | scenario |
| `markup_target` | 0.22 | §5 |
| `k_stock` | 0.35 | §5 |
| `price_sensitivity_exponent` | 2.0 | §6.2 |
| `markup_step` | 0.02 | §5.1 |
| `markup_min` | 0.05 | §5.1 |
| `markup_max` | 0.60 | §5.1 |
| `reserve_days` | 2 | §9 |
| `bankrupt_grace` | 3 | §10.1 |
| `lifeline_enabled` | true | §10.2 |
| `lifeline_grant` | 3 × fixed_cost | §10.2 |
| `recovery_min_cash` | 2 × fixed_cost | §10.4 |
| `fixed_cost` | 25 | §8 |
| `starting_cash` | 300 | scenario |
| `starting_inventory` | 20 units of specialty | scenario |
| `player_starting_cash` | 0 | scenario |
| `player_actions` | [] | scenario, scripted per day (§6.5) |

These are the *only* parameters. Anything else is derived.

---

## 14. Known simplifications (declared, not hidden)

1. Customers do not re-route on a stockout; the unit is `lost_demand` (§6.3).
2. Customers never leave the town — total demand is fixed apart from shocks.
3. Merchants hold at most one specialty and do not diversify (keeps the model auditable).
4. Restocking happens once per day, at the start; there is no intraday trading.
5. `fixed_cost` is uniform by default; varying it is an explicit scenario choice.
6. Investment is modelled as an external investor actor; there is no *agent* investor in this gate.
   (The agent investor is a product decision for the MVP, not a feasibility question.)
7. The player's actions are scripted, not human-driven, in this gate. The MVP replaces the script
   with real input; the *economics* are identical because the player's verbs are priced by the
   merchant's own rules (§6.5).

---

## 15. What "interesting" means (the acceptance bar for the Gate)

The model passes only if, in the simulation, **all** of the following are observable:

1. At least one merchant **survives** 60 days with positive cash.
2. At least one merchant **goes bankrupt** and closes, in at least one scenario.
3. At least one **recovery** (lifeline or investment) produces a shop that reopens and then *trades
   again*.
4. Prices **move** with stock (a flooded market shows a visibly lower list price).
5. A **price war** between two merchants produces a lower clearing price and thinner margins.
6. A **demand collapse** is survivable by a well-capitalised merchant and fatal to a fragile one.
7. The economy does **not** trivially spiral into total collapse, nor trivially succeed for everyone.
8. Every one of these is **reproducible** from the same inputs.

---

## 16. The 60-second demonstration (specification)

The demo must show one complete, *emergent* story. No step is fabricated; every value comes from the
rules above.

| Beat | What the judge sees | Rule that produces it |
| --- | --- | --- |
| 1. Open | Merchant `smith` opens with 300 credits and 20 iron; list price ~21 | §3, §5 |
| 2. Trade | Customers buy iron; smith's cash rises, stock falls | §6.1–6.4 |
| 3. Earn | Daily profit shown: revenue − restock − 25 | §6.4, §8 |
| 4. Shock | A demand collapse hits iron (×0.25 for 12 days) | §7 |
| 5. Trouble | Sales stop; smith still pays 25/day; cash drains | §8, §9 |
| 6. Close | Cash < 25 for 3 dead days → shop **closes** | §10.1, §10.3 |
| 7. Invest | An investor injects 120; cash ≥ 50 → shop **reopens** | §10.4 |
| 8. Recover | Demand returns; smith trades again and stabilises | §7, §6 |

The **flood** variant replaces beats 4–6: over 13 days the *player* sells 325 iron to smith at the
bid price, so the merchant's list price falls from 21 to the 13 floor **and** its cash drains from 665
to -4, reaching the same closure. Both paths are run and reported (scenario `09_demo_flood`).

*End of RULES.md.*
