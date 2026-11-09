"""Sensitivity sweep: vary starting conditions and report outcomes.

Answers "can merchants survive", "can the economy be trapped in a failure
state", and "does the model stay deterministic" across a parameter grid.

Run: python3 sensitivity.py
"""

from __future__ import annotations

import csv
import os

from simulate import Sim, Scenario, make_town, GOODS

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
os.makedirs(OUT, exist_ok=True)


def town(start_cash, fixed_cost):
    return make_town([
        {"id": "miller", "name": "Miller", "specialty": "grain"},
        {"id": "smith", "name": "Smith", "specialty": "iron"},
        {"id": "weaver", "name": "Weaver", "specialty": "cloth"},
        {"id": "brewer", "name": "Brewer", "specialty": "ale"},
    ], default_cash=start_cash, default_fixed=fixed_cost)


def run_case(label, **kw):
    sc = Scenario(name=label, **kw)
    sim = Sim(sc).run()
    last = {}
    for row in sim.rows:
        last[row["merchant"]] = row
    survivors = sum(1 for r in last.values() if r["state"] == "open" and r["cash"] > 0)
    closures = sum(1 for e in sim.events if e[2] == "CLOSED")
    reopens = sum(1 for e in sim.events if e[2] == "REOPENED")
    lifelines = sum(1 for e in sim.events if e[2] == "LIFELINE")
    final = sum(r["cash"] for r in last.values())
    return dict(label=label, survivors=survivors, of=len(last), closures=closures,
                reopens=reopens, lifelines=lifelines, final_cash=final,
                hash=sim.hash[:12])


def main():
    rows = []

    print("== Sweep 1: starting capital (fixed_cost 25, no shock) ==")
    for cash in [50, 100, 200, 300, 500, 800]:
        r = run_case(f"cash{cash}", merchants=town(cash, 25))
        rows.append(r)
        print(f"  start cash {cash:4}: survive {r['survivors']}/{r['of']}  "
              f"closures {r['closures']}  final {r['final_cash']}")

    print("\n== Sweep 2: fixed cost (start cash 300, no shock) ==")
    for fc in [15, 20, 25, 30, 35, 40, 50]:
        r = run_case(f"fixed{fc}", merchants=town(300, fc))
        rows.append(r)
        print(f"  fixed cost {fc:3}: survive {r['survivors']}/{r['of']}  "
              f"closures {r['closures']}  final {r['final_cash']}")

    print("\n== Sweep 3: town-wide demand level (cash 300, fixed 25) ==")
    for mult in [0.25, 0.5, 0.75, 1.0, 1.5, 2.0]:
        shocks = [{"type": "demand", "good": g, "mult": mult, "start": 1, "end": 60}
                  for g in GOODS]
        r = run_case(f"demand{mult}", merchants=town(300, 25), shocks=shocks)
        rows.append(r)
        print(f"  demand x{mult:<4}: survive {r['survivors']}/{r['of']}  "
              f"closures {r['closures']}  final {r['final_cash']}")

    print("\n== Sweep 4: permanent demand collapse x0.2 (failure-trap probe) ==")
    for cash in [100, 300, 800]:
        shocks = [{"type": "demand", "good": g, "mult": 0.2, "start": 1, "end": 60}
                  for g in GOODS]
        r = run_case(f"trap_cash{cash}", merchants=town(cash, 25), shocks=shocks,
                     lifeline_enabled=False)
        rows.append(r)
        print(f"  collapse x0.2, cash {cash:4}: survive {r['survivors']}/{r['of']}  "
              f"closures {r['closures']}")

    with open(os.path.join(OUT, "sensitivity.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    # summary assertions for the report
    print("\n== Summary ==")
    surv = [r for r in rows if r["survivors"] == r["of"]]
    dead = [r for r in rows if r["survivors"] == 0]
    print(f"  cases where ALL merchants survive: {len(surv)}/{len(rows)}")
    print(f"  cases where NONE survive (trap):  {len(dead)}/{len(rows)}")
    print(f"  wrote results/sensitivity.csv ({len(rows)} cases)")


if __name__ == "__main__":
    main()
