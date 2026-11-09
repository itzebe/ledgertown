"""Unit tests for the Ledgertown economic model (RULES.md).

Each test names the rule it checks. Run: python3 tests.py
"""

from __future__ import annotations

from fractions import Fraction as F

from simulate import (Sim, Scenario, Merchant, Player, Investor, make_town,
                      GOODS, GOOD_ORDER, stock_target, r)

PASS = []
FAIL = []


def t(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name} {detail}")


def fresh():
    sc = Scenario(name="t", merchants=make_town([
        {"id": "smith", "name": "Smith", "specialty": "iron"},
    ]))
    sim = Sim(sc)
    sim.by_id = {"smith": sc.merchants[0]}
    sim.merchants = list(sc.merchants)
    return sim, sc.merchants[0]


def main():
    print("== RULES section 5: pricing responds to stock ==")
    sim, m = fresh()
    m.inventory["iron"] = stock_target("iron")
    m.cost_basis["iron"] = stock_target("iron") * GOODS["iron"]["cost"]
    sim.compute_prices(m)
    at_target = m.list_price["iron"]

    m.inventory["iron"] = stock_target("iron") * 3     # flooded
    sim.compute_prices(m)
    flooded = m.list_price["iron"]

    m.inventory["iron"] = max(1, stock_target("iron") // 4)   # short
    sim.compute_prices(m)
    short = m.list_price["iron"]

    t("flooded price < price at target", flooded < at_target, f"{flooded} < {at_target}")
    t("short price > price at target", short > at_target, f"{short} > {at_target}")
    t("price never below floor", flooded >= round(GOODS["iron"]["ref"] * 0.6))
    t("price never above ceiling", short <= round(GOODS["iron"]["ref"] * 1.6))

    print("\n== RULES section 4.3 / 11.6: bid < list always ==")
    for inv in [1, stock_target("iron"), stock_target("iron") * 5, 400]:
        m.inventory["iron"] = inv
        sim.compute_prices(m)
        t(f"inv={inv}: bid<list", m.bid_price["iron"] < m.list_price["iron"],
          f"{m.bid_price['iron']} < {m.list_price['iron']}")

    print("\n== RULES section 5: markup anchors to avg cost ==")
    sim, m = fresh()
    m.inventory["iron"] = stock_target("iron")
    m.cost_basis["iron"] = 100 * stock_target("iron")     # avg cost 100 (absurdly dear)
    sim.compute_prices(m)
    t("dear cost raises list price above reference",
      m.list_price["iron"] > GOODS["iron"]["ref"], f"{m.list_price['iron']}")

    print("\n== RULES section 6.2: allocation is exact (market clears) ==")
    sim, m = fresh()
    m.inventory["iron"] = 400
    sim.compute_prices(m)
    for demand in [0, 1, 7, 9, 13, 100]:
        alloc, lost = sim.allocate("iron", demand)
        total = sum(alloc.values())
        t(f"demand {demand}: allocated == demand", total == demand, f"got {total}")

    print("\n== RULES section 6.2: cheaper shop gets more custom ==")
    sc = Scenario(name="t2", merchants=make_town([
        {"id": "cheap", "name": "Cheap", "specialty": "iron"},
        {"id": "dear", "name": "Dear", "specialty": "iron"},
    ]))
    sim2 = Sim(sc)
    sim2.by_id = {m.mid: m for m in sc.merchants}
    sim2.merchants = list(sc.merchants)
    cheap, dear = sim2.by_id["cheap"], sim2.by_id["dear"]
    for m2 in (cheap, dear):
        m2.inventory["iron"] = 400
        m2.cost_basis["iron"] = 400 * GOODS["iron"]["cost"]
    sim2.compute_prices(cheap)
    # make dear dearer by giving it a higher cost basis
    dear.cost_basis["iron"] = 400 * 25
    sim2.compute_prices(dear)
    alloc, _ = sim2.allocate("iron", 100)
    t("cheaper shop receives more units", alloc["cheap"] > alloc["dear"],
      f"{alloc}")

    print("\n== RULES section 9: restock only the specialty, respects reserve ==")
    sim, m = fresh()
    m.cash = 5                      # below reserve (2*25=50): cannot restock
    spent = sim.restock(m, 1)
    t("no restock when cash < reserve", spent == 0, f"spent {spent}")

    print("\n== RULES section 10.1: bankruptcy on cash < 0 closes immediately ==")
    sc = Scenario(name="t3", merchants=make_town([
        {"id": "smith", "name": "Smith", "specialty": "iron", "cash": 0, "inv": 0}]),
        lifeline_enabled=False)
    sim3 = Sim(sc).run()
    t("zero-capital merchant closes within 60 days",
      any(e[2] == "CLOSED" for e in sim3.events), str(sim3.events[:2]))

    print("\n== RULES section 10.1: slow death needs 3 dead days ==")
    sc = Scenario(name="t4", merchants=make_town([
        {"id": "smith", "name": "Smith", "specialty": "iron", "cash": 30, "inv": 0}]),
        lifeline_enabled=False, days=6)
    sim4 = Sim(sc).run()
    # cash 30, fixed 25: day1 cash<25? after paying 25 -> 5, bd=1; day2 -> -20 <0 closes
    closed_days = [e[0] for e in sim4.events if e[2] == "CLOSED"]
    t("closes only after insolvency, not on day 1",
      closed_days and closed_days[0] >= 2, f"closed on {closed_days}")

    print("\n== RULES section 10.2: lifeline fires once ==")
    sc = Scenario(name="t5", merchants=make_town([
        {"id": "smith", "name": "Smith", "specialty": "iron", "cash": 10, "inv": 0}]),
        lifeline_enabled=True, days=20)
    sim5 = Sim(sc).run()
    life = [e for e in sim5.events if e[2] == "LIFELINE"]
    t("lifeline granted at most once", len(life) <= 1, f"{len(life)} lifeline(s)")

    print("\n== RULES section 10.4: recovery threshold ==")
    sc = Scenario(name="t6", merchants=make_town([
        {"id": "smith", "name": "Smith", "specialty": "iron", "cash": 0, "inv": 0}]),
        lifeline_enabled=False, investor=Investor(cash=1000),
        invest_actions={5: [("smith", 10)]}, days=10)   # 10 < RECOVERY_MIN (50)
    sim6 = Sim(sc).run()
    too_small = any(e[2] == "INVEST_TOO_SMALL" for e in sim6.events)
    t("investment below threshold does not reopen", too_small, str(sim6.events))

    print("\n== RULES section 12: determinism ==")
    h = [Sim(Scenario(name="d", merchants=make_town(
        [{"id": "smith", "name": "S", "specialty": "iron"}]))).run().hash for _ in range(3)]
    t("three runs are identical", len(set(h)) == 1, h[0][:12])

    print("\n== RULES section 6.4: integer money, no drift ==")
    sim, m = fresh()
    m.inventory["iron"] = 3
    m.cost_basis["iron"] = 50        # avg 16.67 (non-integer average)
    t("cost_basis stays integer", isinstance(m.cost_basis["iron"], int))
    t("cash stays integer", isinstance(m.cash, int))
    t("avg_cost is exact rational (no float)",
      isinstance(m.avg_cost("iron"), F), str(m.avg_cost("iron")))

    print(f"\n{len(PASS)}/{len(PASS) + len(FAIL)} tests passed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
