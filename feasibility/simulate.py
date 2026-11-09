"""Ledgertown economic feasibility simulation.

Implements RULES.md exactly. No randomness: all allocation uses exact rational
arithmetic (fractions.Fraction) so every run is bit-for-bit reproducible and
portable across platforms.

Run:  python3 simulate.py            # all scenarios
      python3 simulate.py baseline   # one scenario
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import sys
from dataclasses import dataclass, field
from fractions import Fraction as F

# ---------------------------------------------------------------------------
# Fixed constants (RULES.md section 4, 5, 8, 9, 10, 13)
# ---------------------------------------------------------------------------

GOODS = {
    "grain": {"ref": 12, "cost": 10, "dbase": 16},
    "iron": {"ref": 21, "cost": 17, "dbase": 9},
    "cloth": {"ref": 33, "cost": 27, "dbase": 6},
    "ale": {"ref": 15, "cost": 12, "dbase": 11},
}
GOOD_ORDER = ["grain", "iron", "cloth", "ale"]

MARKUP = F(22, 100)          # 1.22 markup over avg cost -> list ~= reference at target stock
K_STOCK = F(35, 100)         # stock sensitivity
FLOOR = F(60, 100)           # price floor as fraction of reference
CEIL = F(160, 100)           # price ceiling
BID_RATIO = F(70, 100)       # bid at target stock = 70% of reference
STOCK_MAX = 400
RESERVE_DAYS = 2
BANKRUPT_GRACE = 3
D_MAX = 400

DEFAULTS = dict(
    markup=MARKUP, k_stock=K_STOCK, floor=FLOOR, ceil=CEIL, bid_ratio=BID_RATIO,
    reserve_days=RESERVE_DAYS, bankrupt_grace=BANKRUPT_GRACE,
    stock_max=STOCK_MAX, d_max=D_MAX,
    fixed_cost=25, start_cash=300, start_inv=20,
    lifeline_enabled=True, lifeline_mult=3, recovery_mult=2,
    markup_step=F(2, 100), markup_min=F(5, 100), markup_max=F(60, 100),
)


def r(fr: F) -> int:
    """Round a Fraction half-up to int (all values here are non-negative)."""
    return int((fr + F(1, 2)) // 1)


def clampf(x: F, lo: F, hi: F) -> F:
    return lo if x < lo else (hi if x > hi else x)


def stock_target(good: str) -> int:
    return 2 * GOODS[good]["dbase"]


# ---------------------------------------------------------------------------
# Actors
# ---------------------------------------------------------------------------

@dataclass
class Merchant:
    mid: str
    name: str
    specialty: str
    fixed_cost: int
    cash: int
    inventory: dict = field(default_factory=dict)
    cost_basis: dict = field(default_factory=dict)
    lifeline_used: bool = False
    bankrupt_days: int = 0
    state: str = "open"
    closed_on: int | None = None
    reopened_count: int = 0
    # per-day computed
    list_price: dict = field(default_factory=dict)
    bid_price: dict = field(default_factory=dict)
    markup: F = field(default_factory=lambda: MARKUP)   # RULES section 5.1

    @property
    def account(self) -> str:
        return f"{self.mid}.ledgertown.testnet"

    def avg_cost(self, good: str) -> F:
        inv = self.inventory.get(good, 0)
        if inv <= 0:
            return F(GOODS[good]["ref"])
        return F(self.cost_basis.get(good, 0), inv)

    def units(self, good: str) -> int:
        return self.inventory.get(good, 0)


@dataclass
class Player:
    cash: int = 0
    inventory: dict = field(default_factory=dict)


@dataclass
class Investor:
    cash: int = 0


# ---------------------------------------------------------------------------
# Scenario
# ---------------------------------------------------------------------------

@dataclass
class Scenario:
    name: str
    merchants: list
    days: int = 60
    shocks: list = field(default_factory=list)      # {type,good,mult,start,end}
    player: Player = field(default_factory=Player)
    player_actions: dict = field(default_factory=dict)   # day -> [ops]
    investor: Investor = field(default_factory=Investor)
    invest_actions: dict = field(default_factory=dict)   # day -> [(mid, amount)]
    lifeline_enabled: bool = True
    params: dict = field(default_factory=dict)


def make_town(merchants_spec, default_fixed=25, default_cash=300, default_inv=20):
    out = []
    for spec in merchants_spec:
        mid, name, spec_good = spec["id"], spec["name"], spec["specialty"]
        cash = spec.get("cash", default_cash)
        inv_units = spec.get("inv", default_inv)
        inv = dict(spec.get("inventory", {}))
        if spec_good and spec_good not in inv:
            inv[spec_good] = inv_units
        cost = GOODS[spec_good]["cost"] if spec_good else 0
        basis = {g: n * cost for g, n in inv.items()}
        out.append(Merchant(
            mid=mid, name=name, specialty=spec_good,
            fixed_cost=spec.get("fixed_cost", default_fixed),
            cash=cash, inventory=inv, cost_basis=basis,
        ))
    return out


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class Sim:
    def __init__(self, sc: Scenario):
        self.sc = sc
        self.p = dict(DEFAULTS)
        self.p.update(sc.params)
        self.day = 0
        self.ledger = []
        self.events = []
        self.lost_demand = 0
        self.rows = []

    # -- shock helpers ------------------------------------------------------
    def demand_mult(self, good, day):
        m = F(1)
        for s in self.sc.shocks:
            if s["type"] == "demand" and s["good"] == good and s["start"] <= day <= s["end"]:
                m *= F(str(s["mult"]))
        return m

    def cost_mult(self, good, day):
        m = F(1)
        for s in self.sc.shocks:
            if s["type"] == "cost" and s["good"] == good and s["start"] <= day <= s["end"]:
                m *= F(str(s["mult"]))
        return m

    def restock_cost(self, good, day):
        return r(F(GOODS[good]["cost"]) * self.cost_mult(good, day))

    def demand(self, good, day):
        d = r(F(GOODS[good]["dbase"]) * self.demand_mult(good, day))
        return max(0, min(self.p["d_max"], d))

    # -- pricing (RULES section 5, 4.3) ------------------------------------
    def compute_prices(self, m: Merchant):
        m.list_price, m.bid_price = {}, {}
        if m.state != "open":
            return
        for g in GOOD_ORDER:
            inv = m.units(g)
            tgt = stock_target(g)
            surplus = F(inv - tgt, tgt)
            factor = clampf(1 - self.p["k_stock"] * surplus, self.p["floor"], self.p["ceil"])
            base = m.avg_cost(g) * (1 + m.markup)
            ref = GOODS[g]["ref"]
            pmin = -(-r(F(ref) * self.p["floor"]) // 1)          # ceil(ref*floor)
            pmax = r(F(ref) * self.p["ceil"])
            lp = r(base * factor)
            m.list_price[g] = max(pmin, min(pmax, lp))
            bf = clampf(1 - self.p["k_stock"] * surplus, self.p["floor"], self.p["ceil"])
            bp = r(F(ref) * self.p["bid_ratio"] * bf)
            m.bid_price[g] = max(1, min(ref, bp))
            # anti-exploit invariant (RULES section 11.6)
            if m.bid_price[g] >= m.list_price[g]:
                m.bid_price[g] = m.list_price[g] - 1
                if m.bid_price[g] < 1:
                    m.bid_price[g] = 1

    # -- competitive markup adjustment (RULES section 5.1) -----------------
    def adjust_markups(self):
        """Each day, a merchant compares its price to the cheapest competitor
        for its specialty and nudges its markup: undercut when it is the dearer
        shop, relax back toward the target when it is already the cheapest.
        Bounded by MARKUP_MIN / MARKUP_MAX, so no race to zero."""
        step = self.p["markup_step"]
        lo, hi = self.p["markup_min"], self.p["markup_max"]
        for g in GOOD_ORDER:
            shops = [m for m in self.merchants
                     if m.state == "open" and m.specialty == g and m.units(g) > 0]
            if len(shops) < 2:
                # no rival: drift back to target
                for m in shops:
                    if m.markup < MARKUP:
                        m.markup = min(MARKUP, m.markup + step)
                    elif m.markup > MARKUP:
                        m.markup = max(MARKUP, m.markup - step)
                continue
            for m in shops:
                mine = m.list_price.get(g, None)
                if mine is None:
                    continue
                rivals = [o.list_price[g] for o in shops
                          if o.mid != m.mid and g in o.list_price]
                if not rivals:
                    continue
                if mine > min(rivals):
                    m.markup = max(lo, m.markup - step)     # undercut
                elif mine <= min(rivals):
                    m.markup = min(MARKUP, m.markup + step)  # relax toward target
                m.markup = clampf(m.markup, lo, hi)

    # -- restock (RULES section 9) -----------------------------------------
    def restock(self, m: Merchant, day):
        if m.state != "open":
            return 0
        spent = 0
        reserve = self.p["reserve_days"] * m.fixed_cost
        # A merchant restocks only its specialty (RULES section 2: "specialising in one good").
        for g in [m.specialty]:
            tgt = stock_target(g)
            need = max(0, tgt - m.units(g))
            if need == 0:
                continue
            unit_cost = self.restock_cost(g, day)
            spendable = max(0, m.cash - reserve)
            affordable = spendable // unit_cost
            buy = min(need, affordable, self.p["stock_max"] - m.units(g))
            if buy <= 0:
                continue
            cost = buy * unit_cost
            m.cash -= cost
            m.inventory[g] = m.units(g) + buy
            m.cost_basis[g] = m.cost_basis.get(g, 0) + cost
            spent += cost
        return spent

    # -- allocation (RULES section 6.2) ------------------------------------
    def allocate(self, good, demand):
        shops = [(m.mid, m.list_price[good], m.units(good))
                 for m in self.merchants if m.state == "open"
                 and m.units(good) > 0 and good in m.list_price]
        if not shops or demand <= 0:
            return {}, demand
        expo = 2
        att = [(mid, (F(1, price) ** expo)) for mid, price, _ in shops]
        total = sum((a for _, a in att), F(0))
        raw = [(mid, F(demand) * a / total) for mid, a in att]
        base = {mid: int(v // 1) for mid, v in raw}
        assigned = sum(base.values())
        remainder = demand - assigned
        # largest fractional part, ties by id asc
        order = sorted(raw, key=lambda t: (-(t[1] - (t[1] // 1)), t[0]))
        for i in range(remainder):
            base[order[i % len(order)][0]] += 1
        lost = 0
        for mid, price, stock in shops:
            want = base.get(mid, 0)
            if want > stock:
                lost += want - stock
        return base, lost

    # -- one day -----------------------------------------------------------
    def step(self):
        self.day += 1
        day = self.day
        p = self.p
        cash_before = sum(m.cash for m in self.merchants) + self.sc.player.cash + self.sc.investor.cash

        # 1. restock
        restock_cost = 0
        restock_by = {}
        for m in sorted(self.merchants, key=lambda x: x.mid):
            s = self.restock(m, day)
            restock_by[m.mid] = s
            restock_cost += s

        # 1b. competitive markup adjustment (RULES section 5.1)
        self.adjust_markups()

        # 2. prices
        for m in sorted(self.merchants, key=lambda x: x.mid):
            self.compute_prices(m)

        # 3+4+5. demand, allocation, settlement
        revenue = cogs_total = 0
        sold_by = {}
        rev_by = {}
        cogs_by = {}
        for g in GOOD_ORDER:
            demand = self.demand(g, day)
            alloc, lost = self.allocate(g, demand)
            self.lost_demand += lost
            for mid, units in sorted(alloc.items()):
                m = self.by_id[mid]
                avail = m.units(g)
                sell = min(units, avail)
                if sell <= 0:
                    continue
                price = m.list_price[g]
                rev = sell * price
                avg = m.avg_cost(g)
                cogs = r(F(sell) * avg)
                m.cash += rev
                m.inventory[g] = avail - sell
                m.cost_basis[g] = max(0, m.cost_basis.get(g, 0) - cogs)
                revenue += rev
                cogs_total += cogs
                sold_by[m.mid] = sold_by.get(m.mid, 0) + sell
                rev_by[m.mid] = rev_by.get(m.mid, 0) + rev
                cogs_by[m.mid] = cogs_by.get(m.mid, 0) + cogs
                if sell > 0:
                    m.bankrupt_days = 0

        # 6. player actions (scripted)
        for op in self.sc.player_actions.get(day, []):
            self.apply_player_op(op)

        # 7. fixed costs
        fixed_total = 0
        for m in self.merchants:
            if m.state == "open":
                m.cash -= m.fixed_cost
                fixed_total += m.fixed_cost

        # 8. insolvency, lifeline, closure
        lifeline_total = 0
        for m in sorted(self.merchants, key=lambda x: x.mid):
            if m.state != "open":
                continue
            dead = False
            if m.cash < 0:
                dead = True
            elif m.cash < m.fixed_cost:
                m.bankrupt_days += 1
                if sold_by.get(m.mid, 0) == 0 and m.bankrupt_days >= p["bankrupt_grace"]:
                    dead = True
            if dead:
                if p["lifeline_enabled"] and self.sc.lifeline_enabled and not m.lifeline_used:
                    grant = p["lifeline_mult"] * m.fixed_cost
                    m.cash += grant
                    m.lifeline_used = True
                    m.bankrupt_days = 0
                    lifeline_total += grant
                    self.events.append((day, m.mid, "LIFELINE", grant))
                else:
                    m.state = "closed"
                    m.closed_on = day
                    m.bankrupt_days = 0
                    self.events.append((day, m.mid, "CLOSED", m.cash))

        # 9. investor recovery (scripted)
        for (mid, amount) in self.sc.invest_actions.get(day, []):
            m = self.by_id[mid]
            if m.state == "closed" and self.sc.investor.cash >= amount:
                self.sc.investor.cash -= amount
                m.cash += amount
                if m.cash >= p["recovery_mult"] * m.fixed_cost:
                    m.state = "open"
                    m.reopened_count += 1
                    self.events.append((day, mid, "REOPENED", m.cash))
                else:
                    self.events.append((day, mid, "INVEST_TOO_SMALL", m.cash))

        # 10. assertions + record
        cash_after = sum(m.cash for m in self.merchants) + self.sc.player.cash + self.sc.investor.cash
        expected = revenue - restock_cost - fixed_total + lifeline_total
        assert cash_after - cash_before == expected, (
            f"ledger mismatch day {day}: {cash_after - cash_before} != {expected}")
        for m in self.merchants:
            assert m.inventory.get(m.specialty, 0) >= 0
            for g in GOOD_ORDER:
                assert m.units(g) >= 0, f"{m.mid} negative inv {g}"
                assert m.cost_basis.get(g, 0) >= 0

        self.record(day, revenue, cogs_total, restock_cost, fixed_total, lifeline_total, sold_by,
                    rev_by, cogs_by, restock_by)
        self.ledger.append(dict(day=day, revenue=revenue, cogs=cogs_total,
                                restock=restock_cost, fixed=fixed_total, lifeline=lifeline_total,
                                cash=sum(m.cash for m in self.merchants),
                                open=sum(1 for m in self.merchants if m.state == "open")))

    def apply_player_op(self, op):
        kind = op[0]
        pl = self.sc.player
        if kind == "gather":
            _, good, units = op
            pl.inventory[good] = pl.inventory.get(good, 0) + units
        elif kind == "sell_to":
            _, mid, good, units = op
            m = self.by_id[mid]
            if m.state != "open" or good not in m.bid_price:
                return
            units = min(units, pl.inventory.get(good, 0),
                        max(0, self.p["stock_max"] - m.units(good)))
            if units <= 0:
                return
            price = m.bid_price[good]
            spendable = max(0, m.cash - self.p["reserve_days"] * m.fixed_cost)
            affordable = spendable // price
            units = min(units, affordable)
            if units <= 0:
                return
            cost = units * price
            m.cash -= cost
            pl.cash += cost
            pl.inventory[good] -= units
            m.inventory[good] = m.units(good) + units
            m.cost_basis[good] = m.cost_basis.get(good, 0) + cost
        elif kind == "buy_from":
            _, mid, good, units = op
            m = self.by_id[mid]
            if m.state != "open" or good not in m.list_price:
                return
            units = min(units, m.units(good))
            cost = units * m.list_price[good]
            if cost > pl.cash:
                return
            m.cash += cost
            pl.cash -= cost
            m.inventory[good] = m.units(good) - units
            m.cost_basis[good] = max(0, m.cost_basis.get(good, 0) - units * int(m.avg_cost(good)))
            pl.inventory[good] = pl.inventory.get(good, 0) + units

    def record(self, day, revenue, cogs, restock, fixed, lifeline, sold_by,
               rev_by=None, cogs_by=None, restock_by=None):
        rev_by = rev_by or {}
        cogs_by = cogs_by or {}
        restock_by = restock_by or {}
        for m in sorted(self.merchants, key=lambda x: x.mid):
            ev = [e[2] for e in self.events if e[0] == day and e[1] == m.mid]
            m_rev = rev_by.get(m.mid, 0)
            m_cogs = cogs_by.get(m.mid, 0)
            m_restock = restock_by.get(m.mid, 0)
            m_fixed = m.fixed_cost if m.state == "open" else 0
            self.rows.append(dict(
                day=day, merchant=m.mid, state=m.state, cash=m.cash,
                inv_specialty=m.units(m.specialty),
                price_specialty=m.list_price.get(m.specialty, ""),
                sold=sold_by.get(m.mid, 0),
                revenue=m_rev, cogs=m_cogs, restock=m_restock, expense=m_fixed,
                # economic profit (P&L): restock is a capital purchase, not an expense
                profit=m_rev - m_cogs - m_fixed,
                # actual cash movement this day
                cash_delta=m_rev - m_restock - m_fixed,
                bankrupt_days=m.bankrupt_days, events="|".join(ev),
            ))
        self.town_rows = getattr(self, "town_rows", [])
        self.town_rows.append(dict(day=day, revenue=revenue, cogs=cogs, restock=restock,
                                   fixed=fixed, lifeline=lifeline,
                                   profit=revenue - cogs - fixed,
                                   cash=sum(m.cash for m in self.merchants),
                                   open=sum(1 for m in self.merchants if m.state == "open")))

    # -- run ----------------------------------------------------------------
    def run(self):
        self.by_id = {m.mid: m for m in self.sc.merchants}
        self.merchants = sorted(self.sc.merchants, key=lambda x: x.mid)
        self.town_rows = []
        for _ in range(self.sc.days):
            self.step()
        blob = json.dumps(self.ledger, sort_keys=True, separators=(",", ":"))
        self.hash = hashlib.sha256(blob.encode()).hexdigest()
        return self
