"""Scenario definitions + reporting for the Ledgertown feasibility gate.

Writes per-scenario CSVs and a combined summary to results/.
No randomness anywhere: every scenario is fully specified below.
"""

from __future__ import annotations

import csv
import json
import os

from simulate import (Sim, Scenario, Player, Investor, make_town, GOODS)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
os.makedirs(OUT, exist_ok=True)


def std_town(specs=None, **kw):
    if specs is None:
        specs = [
            {"id": "miller", "name": "Miller (grain)", "specialty": "grain"},
            {"id": "smith", "name": "Smith (iron)", "specialty": "iron"},
            {"id": "weaver", "name": "Weaver (cloth)", "specialty": "cloth"},
            {"id": "brewer", "name": "Brewer (ale)", "specialty": "ale"},
        ]
    return make_town(specs, **kw)


SCENARIOS = {}


def scen(name, **kw):
    def deco(fn):
        SCENARIOS[name] = (fn, kw)
        return fn
    return deco


# 1. baseline --------------------------------------------------------------
@scen("01_baseline")
def _():
    return Scenario(name="01_baseline", merchants=std_town())


# 2. low demand (town-wide collapse) ---------------------------------------
@scen("02_low_demand")
def _():
    shocks = [{"type": "demand", "good": g, "mult": 0.25, "start": 20, "end": 50}
              for g in GOODS]
    return Scenario(name="02_low_demand", merchants=std_town(), shocks=shocks,
                    lifeline_enabled=False)


# 3. excess demand (boom) --------------------------------------------------
@scen("03_excess_demand")
def _():
    shocks = [{"type": "demand", "good": g, "mult": 3.0, "start": 20, "end": 40}
              for g in GOODS]
    return Scenario(name="03_excess_demand", merchants=std_town(), shocks=shocks)


# 4. inventory shortage (start empty, thin cash) ---------------------------
@scen("04_shortage")
def _():
    specs = [
        {"id": "miller", "name": "Miller (grain)", "specialty": "grain", "inv": 0, "cash": 150},
        {"id": "smith", "name": "Smith (iron)", "specialty": "iron", "inv": 0, "cash": 150},
        {"id": "weaver", "name": "Weaver (cloth)", "specialty": "cloth", "inv": 0, "cash": 150},
        {"id": "brewer", "name": "Brewer (ale)", "specialty": "ale", "inv": 0, "cash": 150},
    ]
    shocks = [{"type": "demand", "good": g, "mult": 1.8, "start": 5, "end": 20}
              for g in GOODS]
    return Scenario(name="04_shortage", merchants=std_town(specs), shocks=shocks)


# 5. price war (two grain merchants; one is a fragile newcomer) -----------
@scen("05_price_war")
def _():
    specs = [
        {"id": "miller", "name": "Miller (grain)", "specialty": "grain"},
        {"id": "granary", "name": "Granary (grain)", "specialty": "grain",
         "cash": 70, "fixed_cost": 30},
        {"id": "smith", "name": "Smith (iron)", "specialty": "iron"},
    ]
    return Scenario(name="05_price_war", merchants=std_town(specs),
                    lifeline_enabled=False)


# 6. overspending (high overhead, thin capital) ----------------------------
@scen("06_overspend")
def _():
    specs = [
        {"id": "miller", "name": "Miller (grain)", "specialty": "grain"},
        {"id": "smith", "name": "Smith (iron)", "specialty": "iron", "fixed_cost": 70, "cash": 120},
        {"id": "brewer", "name": "Brewer (ale)", "specialty": "ale"},
    ]
    return Scenario(name="06_overspend", merchants=std_town(specs))


# 7. genuine insolvency (demand collapse, no lifeline) ---------------------
@scen("07_insolvency")
def _():
    shocks = [{"type": "demand", "good": "iron", "mult": 0.1, "start": 12, "end": 52}]
    return Scenario(name="07_insolvency", merchants=std_town(), shocks=shocks,
                    lifeline_enabled=False)


# 8. investment recovery ---------------------------------------------------
@scen("08_invest_recovery")
def _():
    shocks = [{"type": "demand", "good": "iron", "mult": 0.1, "start": 12, "end": 52}]
    return Scenario(
        name="08_invest_recovery", merchants=std_town(), shocks=shocks,
        lifeline_enabled=False, investor=Investor(cash=1000),
        invest_actions={54: [("smith", 120)]},
    )


# 9. THE DEMO: player floods iron + demand collapses -> close -> revive ----
@scen("09_demo_flood")
def _():
    # Player gathers 25 iron/day (days 18-30) and sells it all to smith.
    actions = {}
    for d in range(18, 31):
        actions[d] = [("gather", "iron", 25), ("sell_to", "smith", "iron", 25)]
    # The flood coincides with a collapse in iron demand: no buyers for the glut.
    shocks = [{"type": "demand", "good": "iron", "mult": 0.15, "start": 20, "end": 45}]
    return Scenario(
        name="09_demo_flood", merchants=std_town(), player=Player(),
        player_actions=actions, shocks=shocks, lifeline_enabled=False,
        investor=Investor(cash=1000), invest_actions={50: [("smith", 120)]},
    )


# 10. cost inflation shock -------------------------------------------------
@scen("10_cost_shock")
def _():
    shocks = [{"type": "cost", "good": "iron", "mult": 2.2, "start": 10, "end": 40}]
    return Scenario(name="10_cost_shock", merchants=std_town(), shocks=shocks,
                    lifeline_enabled=False)


# 11. stress: many merchants competing for fixed demand --------------------
@scen("11_stress")
def _():
    specs = [
        {"id": "miller", "name": "Miller (grain)", "specialty": "grain"},
        {"id": "granary", "name": "Granary (grain)", "specialty": "grain"},
        {"id": "smith", "name": "Smith (iron)", "specialty": "iron"},
        {"id": "anvil", "name": "Anvil (iron)", "specialty": "iron"},
        {"id": "weaver", "name": "Weaver (cloth)", "specialty": "cloth"},
        {"id": "loom", "name": "Loom (cloth)", "specialty": "cloth"},
    ]
    return Scenario(name="11_stress", merchants=std_town(specs))


def run_all():
    summary = []
    for name in sorted(SCENARIOS):
        fn, _ = SCENARIOS[name]
        sc = fn()
        sim = Sim(sc).run()
        write_csvs(sim)
        summary.append(summarise(sim))
    write_summary(summary)
    return summary


def write_csvs(sim):
    with open(os.path.join(OUT, f"{sim.sc.name}_daily.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(sim.rows[0].keys()))
        w.writeheader()
        w.writerows(sim.rows)
    with open(os.path.join(OUT, f"{sim.sc.name}_town.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(sim.town_rows[0].keys()))
        w.writeheader()
        w.writerows(sim.town_rows)
    with open(os.path.join(OUT, f"{sim.sc.name}_events.json"), "w") as f:
        json.dump([{"day": e[0], "merchant": e[1], "event": e[2], "value": e[3]}
                   for e in sim.events], f, indent=1)


def summarise(sim):
    last = {}
    for row in sim.rows:
        last[row["merchant"]] = row
    closed = [e for e in sim.events if e[2] == "CLOSED"]
    reopened = [e for e in sim.events if e[2] == "REOPENED"]
    lifelines = [e for e in sim.events if e[2] == "LIFELINE"]
    survivors = [m for m, r in last.items() if r["state"] == "open" and r["cash"] > 0]
    final_cash = sum(r["cash"] for r in last.values())
    # price movement: max-min of smith's iron list price over the run (if present)
    def price_span(mid):
        ps = [r["price_specialty"] for r in sim.rows
              if r["merchant"] == mid and r["price_specialty"] != ""]
        return (min(ps), max(ps)) if ps else (None, None)
    return dict(
        scenario=sim.sc.name, hash=sim.hash[:16],
        survivors=len(survivors), of=len(last),
        closures=len(closed), reopens=len(reopened), lifelines=len(lifelines),
        final_cash=final_cash, lost_demand=sim.lost_demand,
        iron_price_span=price_span("smith"),
        grain_price_span=price_span("miller"),
    )


def write_summary(summary):
    with open(os.path.join(OUT, "summary.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(summary[0].keys()))
        w.writeheader()
        for s in summary:
            row = dict(s)
            row["iron_price_span"] = f"{s['iron_price_span'][0]}..{s['iron_price_span'][1]}"
            row["grain_price_span"] = f"{s['grain_price_span'][0]}..{s['grain_price_span'][1]}"
            w.writerow(row)


if __name__ == "__main__":
    rows = run_all()
    hdr = f"{'scenario':22} {'hash':16} {'surv':>5} {'close':>5} {'reopen':>6} {'lifeline':>8} {'lost':>6} {'iron px':>10}"
    print(hdr)
    print("-" * len(hdr))
    for s in rows:
        ip = s["iron_price_span"]
        print(f"{s['scenario']:22} {s['hash']:16} {s['survivors']:>2}/{s['of']:<2} "
              f"{s['closures']:>5} {s['reopens']:>6} {s['lifelines']:>8} {s['lost_demand']:>6} "
              f"{str(ip[0])+'..'+str(ip[1]):>10}")
    print(f"\nWrote {len(rows)} scenarios to {OUT}/")
