//! Ledgertown — authoritative on-chain market town (NEAR testnet).
//!
//! This contract is the settlement layer: it owns the ledger, enforces every
//! economic rule from `ledgertown-feasibility/RULES.md`, and is the single
//! source of truth for merchant balances, inventories, prices and events.
//!
//! Arithmetic is exact rational (i128 num/den, reduced) mirroring the reference
//! implementation in `simulate.py` (which uses `fractions.Fraction`). Money and
//! inventory are integers; averages and price factors are rationals rounded
//! half-up at exactly the same points as the reference. This lets a scenario
//! driven through the contract be compared, day by day, against the reference.

use near_sdk::json_types::U128;
use near_sdk::store::IterableMap;
use near_sdk::{env, near, AccountId, NearToken, PanicOnDefault, Promise};

/// Fail with a message the NEAR runtime keeps in the receipt.
/// `std`'s wasm panic handler turns panics into bare `unreachable` traps and
/// discards the message, so user-facing refusals call the host directly.
#[cfg(target_arch = "wasm32")]
fn fail(msg: &str) -> ! {
    #[link(wasm_import_module = "env")]
    extern "C" {
        fn panic_utf8(len: u64, ptr: u64) -> !;
    }
    unsafe { panic_utf8(msg.len() as u64, msg.as_ptr() as u64) }
}
#[cfg(not(target_arch = "wasm32"))]
fn fail(msg: &str) -> ! {
    panic!("{}", msg)
}

macro_rules! ensure {
    ($cond:expr, $($arg:tt)*) => {
        if !$cond {
            fail(&format!($($arg)*));
        }
    };
}

use std::collections::BTreeMap;

// ---------------------------------------------------------------------------
// Goods table (RULES.md section 4.1)
// ---------------------------------------------------------------------------

/// (name, reference price, restock cost, base demand)
const GOODS: [(&str, i128, i128, i128); 4] = [
    ("grain", 12, 10, 16),
    ("iron", 21, 17, 9),
    ("cloth", 33, 27, 6),
    ("ale", 15, 12, 11),
];

const STOCK_MAX: i128 = 400;
const D_MAX: i128 = 400;
const CREDITS_PER_NEAR: i128 = 1000;
const YOCTO_PER_NEAR: i128 = 1_000_000_000_000_000_000_000_000;

/// Per-player inventory ceiling. A single gather call already caps at 50, so
/// this only ever bites after many calls; it bounds storage growth per account.
const PLAYER_STOCK_MAX: i128 = 500;
/// Cap on the lifetime NEAR a single account may deposit, so a public
/// deployment that ever exposes a funded signer cannot be drained arbitrarily.
/// Expressed in yoctoNEAR (100 NEAR).
const PLAYER_DEPOSIT_CAP_YOCTO: i128 = 100 * YOCTO_PER_NEAR;
/// Max number of distinct players whose purses are tracked on chain.
const MAX_PLAYERS: u32 = 100_000;

fn good_ref(g: &str) -> i128 {
    GOODS.iter().find(|x| x.0 == g).map(|x| x.1).unwrap_or(0)
}
fn good_cost(g: &str) -> i128 {
    GOODS.iter().find(|x| x.0 == g).map(|x| x.2).unwrap_or(0)
}
fn good_dbase(g: &str) -> i128 {
    GOODS.iter().find(|x| x.0 == g).map(|x| x.3).unwrap_or(0)
}
fn stock_target(g: &str) -> i128 {
    2 * good_dbase(g)
}

// ---------------------------------------------------------------------------
// Exact rational helpers
// ---------------------------------------------------------------------------

fn gcd(a: i128, b: i128) -> i128 {
    let (mut a, mut b) = (a.abs(), b.abs());
    while b != 0 {
        let t = b;
        b = a % b;
        a = t;
    }
    if a == 0 {
        1
    } else {
        a
    }
}

/// Reduce a rational to lowest terms with a positive denominator.
fn rat(n: i128, d: i128) -> (i128, i128) {
    assert!(d != 0, "division by zero");
    let (mut n, mut d) = (n, d);
    if d < 0 {
        n = -n;
        d = -d;
    }
    let g = gcd(n, d);
    (n / g, d / g)
}

/// Round n/d half-up to the nearest integer (works for negative n too).
fn round_half_up(n: i128, d: i128) -> i128 {
    let (n, d) = rat(n, d);
    if n >= 0 {
        (2 * n + d) / (2 * d)
    } else {
        -((-2 * n + d) / (2 * d))
    }
}

/// Ceiling of n/d for positive values.
fn ceil_div(n: i128, d: i128) -> i128 {
    (n + d - 1) / d
}

/// Move a markup (in basis points) one 200bp step toward the 2200bp target,
/// never overshooting — mirrors `adjust_markups` in the reference engine.
fn drift_to_target(bp: i128) -> i128 {
    const TARGET: i128 = 2200;
    const STEP: i128 = 200;
    if bp < TARGET {
        (bp + STEP).min(TARGET)
    } else if bp > TARGET {
        (bp - STEP).max(TARGET)
    } else {
        TARGET
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Merchant {
    pub id: String,
    pub name: String,
    /// Real NEAR testnet subaccount that operates this merchant.
    pub account: AccountId,
    pub specialty: String,
    pub fixed_cost: i128,
    /// Game-credit balance. May go negative (debt) before closure.
    pub cash: i128,
    pub inventory: BTreeMap<String, i128>,
    pub cost_basis: BTreeMap<String, i128>,
    /// Markup in basis points (2200 = 22.00%). Integer so daily steps are exact.
    pub markup_bp: i128,
    /// Day on which an agent last set this merchant's markup (0 = never).
    pub decision_day: u64,
    pub list_price: BTreeMap<String, i128>,
    pub bid_price: BTreeMap<String, i128>,
    pub lifeline_used: bool,
    pub bankrupt_days: u32,
    pub state: String,
    pub closed_on: Option<u64>,
    pub reopened_count: u32,
    pub last_decision: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Player {
    pub cash: i128,
    pub inventory: BTreeMap<String, i128>,
    pub deposited_yocto: u128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Event {
    pub id: u64,
    pub day: u64,
    pub merchant: String,
    pub kind: String,
    pub value: i128,
    pub note: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Shock {
    pub kind: String, // "demand" | "cost"
    pub good: String,
    pub num: i128,
    pub den: i128,
    pub start: u64,
    pub end: u64,
}

/// The original on-chain layout, kept solely so a state migration can read it.
/// Field order/types MUST mirror the deployed contract exactly: Borsh is
/// positional, so this is the authoritative description of the bytes that a
/// `deploy` + `migrate` upgrade must interpret. It is never used at runtime
/// after migration.
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct OldContract {
    pub owner: AccountId,
    pub day: u64,
    pub merchants: BTreeMap<String, Merchant>,
    pub player: Player,
    pub events: Vec<Event>,
    pub shocks: Vec<Shock>,
    pub next_event_id: u64,
    pub lifeline_enabled: bool,
    pub total_credits_minted: i128,
    pub total_fixed_paid: i128,
    pub total_revenue: i128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub owner: AccountId,
    pub day: u64,
    pub merchants: BTreeMap<String, Merchant>,
    /// Per-account player purses, keyed by the player's own NEAR account id.
    /// Each player may only ever touch their own entry; identity comes from
    /// `env::predecessor_account_id()`, never from an argument.
    pub players: IterableMap<AccountId, Player>,
    pub events: Vec<Event>,
    pub shocks: Vec<Shock>,
    pub next_event_id: u64,
    pub lifeline_enabled: bool,
    pub total_credits_minted: i128,
    pub total_fixed_paid: i128,
    pub total_revenue: i128,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            day: 0,
            merchants: BTreeMap::new(),
            players: IterableMap::new(b"p"),
            events: Vec::new(),
            shocks: Vec::new(),
            next_event_id: 0,
            lifeline_enabled: true,
            total_credits_minted: 0,
            total_fixed_paid: 0,
            total_revenue: 0,
        }
    }

    /// Seed the four founding merchants. Owner-only; callable once per merchant.
    /// Each merchant's `account` must be a real testnet subaccount.
    pub fn seed_merchant(
        &mut self,
        id: String,
        name: String,
        account: AccountId,
        specialty: String,
        start_cash: U128,
        start_inv: U128,
    ) {
        self.assert_owner();
        ensure!(
            GOODS.iter().any(|g| g.0 == specialty),
            "unknown good: {}", specialty
        );
        ensure!(!self.merchants.contains_key(&id), "merchant exists: {}", id);
        let cash: i128 = start_cash.0 as i128;
        let inv: i128 = start_inv.0 as i128;
        let cost = good_cost(&specialty);
        let mut inventory = BTreeMap::new();
        let mut cost_basis = BTreeMap::new();
        inventory.insert(specialty.clone(), inv);
        cost_basis.insert(specialty.clone(), inv * cost);
        let m = Merchant {
            id: id.clone(),
            name,
            account,
            specialty,
            fixed_cost: 25,
            cash,
            inventory,
            cost_basis,
            markup_bp: 2200,
            decision_day: 0,
            list_price: BTreeMap::new(),
            bid_price: BTreeMap::new(),
            lifeline_used: false,
            bankrupt_days: 0,
            state: "open".to_string(),
            closed_on: None,
            reopened_count: 0,
            last_decision: String::new(),
        };
        self.merchants.insert(id, m);
        self.total_credits_minted += cash;
    }

    pub fn set_lifeline_enabled(&mut self, enabled: bool) {
        self.assert_owner();
        self.lifeline_enabled = enabled;
    }

    /// Owner-only: restore the town to its initial state for a repeatable demo.
    /// Merchant identities (id, account, specialty) are preserved.
    pub fn reset(&mut self) {
        self.assert_owner();
        self.day = 0;
        self.shocks.clear();
        self.events.clear();
        self.next_event_id = 0;
        self.total_credits_minted = 0;
        self.total_fixed_paid = 0;
        self.total_revenue = 0;
        // Clear every player purse. Iterating the map (not a single field) is
        // what makes reset work with the per-account model.
        let keys: Vec<AccountId> = self.players.keys().cloned().collect();
        for k in keys {
            self.players.remove(&k);
        }
        for id in self.merchant_ids() {
            let mut m = self.merchants.get(&id).unwrap().clone();
            let cost = good_cost(&m.specialty);
            m.cash = 300;
            m.inventory.clear();
            m.cost_basis.clear();
            m.inventory.insert(m.specialty.clone(), 20);
            m.cost_basis.insert(m.specialty.clone(), 20 * cost);
            m.markup_bp = 2200;
            m.decision_day = 0;
            m.list_price.clear();
            m.bid_price.clear();
            m.lifeline_used = false;
            m.bankrupt_days = 0;
            m.state = "open".to_string();
            m.closed_on = None;
            m.reopened_count = 0;
            m.last_decision = String::new();
            self.merchants.insert(id, m);
        }
    }

    /// Owner-only: install a market shock (used to drive the demo lifecycle).
    pub fn add_shock(
        &mut self,
        kind: String,
        good: String,
        num: i128,
        den: i128,
        start: u64,
        end: u64,
    ) {
        self.assert_owner();
        ensure!(kind == "demand" || kind == "cost", "bad shock kind");
        ensure!(GOODS.iter().any(|g| g.0 == good), "unknown good");
        ensure!(den > 0 && num >= 0, "bad shock multiplier");
        self.shocks.push(Shock {
            kind,
            good,
            num,
            den,
            start,
            end,
        });
    }

    // -- market engine ------------------------------------------------------

    /// Advance the town by one day. Any signed caller may run a day; the
    /// engine itself is deterministic, so who calls it does not change the
    /// outcome.
    pub fn tick(&mut self) {
        self.day += 1;
        let day = self.day;

        // 1. restock (unless the merchant's agent set an explicit target today)
        for id in self.merchant_ids() {
            self.restock(&id, day);
        }
        // 2. competitive markup adjustment (skip agents that decided today)
        self.adjust_markups(day);
        // 3. prices
        for id in self.merchant_ids() {
            self.compute_prices(&id);
        }
        // 4. demand, allocation, settlement
        let mut sold_today: BTreeMap<String, i128> = BTreeMap::new();
        for (g, _, _, _) in GOODS {
            let demand = self.demand(g, day);
            let alloc = self.allocate(g, demand);
            for (mid, units) in alloc {
                self.settle_sale(&mid, g, units);
                *sold_today.entry(mid).or_insert(0) += units;
            }
        }
        // 5. fixed costs
        let mut fixed_total: i128 = 0;
        for id in self.merchant_ids() {
            let m = self.merchants.get(&id).unwrap().clone();
            if m.state == "open" {
                let mut m2 = m;
                m2.cash -= m2.fixed_cost;
                fixed_total += m2.fixed_cost;
                self.merchants.insert(id.clone(), m2);
            }
        }
        self.total_fixed_paid += fixed_total;
        // 6. insolvency, lifeline, closure
        self.resolve_solvency(day, &sold_today);
    }

    fn resolve_solvency(&mut self, day: u64, sold_today: &BTreeMap<String, i128>) {
        for id in self.merchant_ids() {
            let mut m = self.merchants.get(&id).unwrap().clone();
            if m.state != "open" {
                continue;
            }
            let mut dead = false;
            if m.cash < 0 {
                dead = true;
            } else if m.cash < m.fixed_cost {
                m.bankrupt_days += 1;
                // slow death only if the shop also sold nothing that day
                if sold_today.get(&id).copied().unwrap_or(0) == 0 && m.bankrupt_days >= 3 {
                    dead = true;
                }
            }
            if dead {
                if self.lifeline_enabled && !m.lifeline_used {
                    let grant = 3 * m.fixed_cost;
                    m.cash += grant;
                    m.lifeline_used = true;
                    m.bankrupt_days = 0;
                    self.total_credits_minted += grant;
                    self.push_event(day, &id, "LIFELINE", grant, "one-shot lifeline");
                } else {
                    m.state = "closed".to_string();
                    m.closed_on = Some(day);
                    m.bankrupt_days = 0;
                    self.push_event(day, &id, "CLOSED", m.cash, "insolvent");
                }
            }
            self.merchants.insert(id, m);
        }
    }

    // -- per-merchant mechanics --------------------------------------------

    fn merchant_ids(&self) -> Vec<String> {
        self.merchants.keys().cloned().collect()
    }

    fn restock(&mut self, id: &str, day: u64) {
        let mut m = self.merchants.get(id).unwrap().clone();
        if m.state != "open" {
            return;
        }
        // an explicit agent restock decision overrides the default target
        let target = stock_target(&m.specialty);
        let reserve = 2 * m.fixed_cost;
        let g = m.specialty.clone();
        let inv = *m.inventory.get(&g).unwrap_or(&0);
        let need = (target - inv).max(0);
        if need == 0 {
            self.merchants.insert(id.to_string(), m);
            return;
        }
        let unit_cost = {
            let (cn, cd) = self.cost_mult(&g, day);
            round_half_up(good_cost(&g) * cn, cd)
        };
        let spendable = (m.cash - reserve).max(0);
        let affordable = spendable / unit_cost;
        let buy = need.min(affordable).min(STOCK_MAX - inv);
        if buy <= 0 {
            self.merchants.insert(id.to_string(), m);
            return;
        }
        let cost = buy * unit_cost;
        m.cash -= cost;
        m.inventory.insert(g.clone(), inv + buy);
        let cb = *m.cost_basis.get(&g).unwrap_or(&0);
        m.cost_basis.insert(g, cb + cost);
        self.merchants.insert(id.to_string(), m);
    }

    fn adjust_markups(&mut self, day: u64) {
        for (g, _, _, _) in GOODS {
            let shops: Vec<String> = self
                .merchant_ids()
                .into_iter()
                .filter(|id| {
                    let m = self.merchants.get(id).unwrap();
                    m.state == "open" && m.specialty == g && m.units_or0(g) > 0
                })
                .collect();
            if shops.len() < 2 {
                for id in shops {
                    let mut m = self.merchants.get(&id).unwrap().clone();
                    if m.decision_day == day {
                        continue;
                    }
                    m.markup_bp = drift_to_target(m.markup_bp);
                    self.merchants.insert(id, m);
                }
                continue;
            }
            for id in shops.clone() {
                let mut m = self.merchants.get(&id).unwrap().clone();
                if m.decision_day == day {
                    continue;
                }
                let mine = match m.list_price.get(g) {
                    Some(v) => *v,
                    None => continue,
                };
                let rival_min = shops
                    .iter()
                    .filter(|o| **o != id)
                    .filter_map(|o| self.merchants.get(o).unwrap().list_price.get(g).copied())
                    .min();
                let rival_min = match rival_min {
                    Some(v) => v,
                    None => continue,
                };
                if mine > rival_min {
                    m.markup_bp -= 200;
                } else {
                    m.markup_bp = (m.markup_bp + 200).min(2200);
                }
                m.markup_bp = m.markup_bp.clamp(500, 6000);
                self.merchants.insert(id, m);
            }
        }
    }

    fn compute_prices(&mut self, id: &str) {
        let mut m = self.merchants.get(id).unwrap().clone();
        m.list_price.clear();
        m.bid_price.clear();
        if m.state != "open" {
            self.merchants.insert(id.to_string(), m);
            return;
        }
        let mk_bp = m.markup_bp;
        for (g, refp, _, _) in GOODS {
            let inv = *m.inventory.get(g).unwrap_or(&0);
            let tgt = stock_target(g);
            // factor = clamp(1 - 0.35*(inv-tgt)/tgt, 0.60, 1.60)
            let fn_num = 100 * tgt - 35 * (inv - tgt);
            let fn_den = 100 * tgt;
            let (f_num, f_den) = if fn_num < 60 * tgt {
                (60, 100)
            } else if fn_num > 160 * tgt {
                (160, 100)
            } else {
                (fn_num, fn_den)
            };
            // base = avg_cost * (1 + markup)
            let (b_num, b_den) = if inv > 0 {
                let cb = *m.cost_basis.get(g).unwrap_or(&0);
                // avg_cost = cb/inv ; base = cb*(10000+mk_bp) / (inv*10000)
                (cb * (10_000 + mk_bp), inv * 10_000)
            } else {
                // avg_cost = ref ; base = ref*(10000+mk_bp)/10000
                (refp * (10_000 + mk_bp), 10_000)
            };
            // lp = round(base * factor)
            let lp = round_half_up(b_num * f_num, b_den * f_den);
            let pmin = ceil_div(refp * 60, 100);
            let pmax = round_half_up(refp * 160, 100);
            let lp = lp.clamp(pmin, pmax);
            // bid = round(ref * 0.70 * factor), clamped to [1, ref]
            let bp = round_half_up(refp * 70 * f_num, 100 * f_den);
            let mut bid = bp.clamp(1, refp);
            if bid >= lp {
                bid = (lp - 1).max(1);
            }
            m.list_price.insert(g.to_string(), lp);
            m.bid_price.insert(g.to_string(), bid);
        }
        self.merchants.insert(id.to_string(), m);
    }

    fn demand(&self, good: &str, day: u64) -> i128 {
        let (n, d) = self.demand_mult(good, day);
        let raw = round_half_up(good_dbase(good) * n, d);
        raw.clamp(0, D_MAX)
    }

    fn demand_mult(&self, good: &str, day: u64) -> (i128, i128) {
        let mut n: i128 = 1;
        let mut d: i128 = 1;
        for s in &self.shocks {
            if s.kind == "demand" && s.good == good && s.start <= day && day <= s.end {
                n *= s.num;
                d *= s.den;
            }
        }
        rat(n, d)
    }

    fn cost_mult(&self, good: &str, day: u64) -> (i128, i128) {
        let mut n: i128 = 1;
        let mut d: i128 = 1;
        for s in &self.shocks {
            if s.kind == "cost" && s.good == good && s.start <= day && day <= s.end {
                n *= s.num;
                d *= s.den;
            }
        }
        rat(n, d)
    }

    /// Allocate `demand` units of `good` across open shops by price weight
    /// (1/price^2), exactly mirroring the reference implementation.
    fn allocate(&self, good: &str, demand: i128) -> Vec<(String, i128)> {
        let mut shops: Vec<(String, i128, i128)> = Vec::new();
        for id in self.merchant_ids() {
            let m = self.merchants.get(&id).unwrap();
            if m.state != "open" {
                continue;
            }
            let stock = m.units_or0(good);
            if stock <= 0 {
                continue;
            }
            if let Some(p) = m.list_price.get(good) {
                shops.push((id.clone(), *p, stock));
            }
        }
        if shops.is_empty() || demand <= 0 {
            return Vec::new();
        }
        // weight = 1/price^2 ; total = sum
        let mut weights: Vec<(String, i128, i128)> = Vec::new(); // (mid, num, den)
        let mut tn: i128 = 0;
        let mut td: i128 = 1;
        for (mid, price, _) in &shops {
            let (wn, wd) = rat(1, price * price);
            weights.push((mid.clone(), wn, wd));
            // add wn/wd to tn/td
            let (n, d) = rat(tn * wd + wn * td, td * wd);
            tn = n;
            td = d;
        }
        // raw_i = demand * w_i / total  -> (num, den)
        let mut raw: Vec<(String, i128, i128)> = Vec::new();
        let mut base: BTreeMap<String, i128> = BTreeMap::new();
        let mut assigned: i128 = 0;
        for (mid, wn, wd) in &weights {
            let (n, d) = rat(demand * wn * td, wd * tn);
            let fl = n.div_euclid(d);
            base.insert(mid.clone(), fl);
            assigned += fl;
            raw.push((mid.clone(), n, d));
        }
        let mut remainder = demand - assigned;
        // sort by fractional part desc, then mid asc
        raw.sort_by(|a, b| {
            let fa = a.1.rem_euclid(a.2) * b.2; // frac_a as fraction over common den
            let fb = b.1.rem_euclid(b.2) * a.2;
            fb.cmp(&fa).then(a.0.cmp(&b.0))
        });
        let mut i = 0;
        while remainder > 0 && !raw.is_empty() {
            let mid = raw[i % raw.len()].0.clone();
            *base.entry(mid).or_insert(0) += 1;
            remainder -= 1;
            i += 1;
        }
        let mut out = Vec::new();
        for (mid, _price, stock) in shops {
            let want = *base.get(&mid).unwrap_or(&0);
            let give = want.min(stock);
            if give > 0 {
                out.push((mid, give));
            }
        }
        out
    }

    fn settle_sale(&mut self, id: &str, good: &str, units: i128) {
        let mut m = self.merchants.get(id).unwrap().clone();
        let price = *m.list_price.get(good).unwrap_or(&0);
        let rev = units * price;
        let inv = m.units_or0(good);
        let cb = *m.cost_basis.get(good).unwrap_or(&0);
        let (cn, cd) = m.avg_cost(good);
        let cogs = round_half_up(cn * units, cd);
        m.cash += rev;
        m.inventory.insert(good.to_string(), inv - units);
        m.cost_basis
            .insert(good.to_string(), (cb - cogs).max(0));
        if units > 0 {
            m.bankrupt_days = 0;
        }
        self.total_revenue += rev;
        self.merchants.insert(id.to_string(), m);
    }

    // -- player actions -----------------------------------------------------

    /// Create (or return) the caller's own purse. Idempotent. Identity is the
    /// transaction's `predecessor` — a wallet cannot create or touch another
    /// account's purse.
    #[payable]
    pub fn player_init(&mut self) {
        let player = env::predecessor_account_id();
        if self.players.contains_key(&player) {
            return;
        }
        ensure!(
            self.players.len() < MAX_PLAYERS,
            "player capacity reached"
        );
        self.players.insert(
            player.clone(),
            Player {
                cash: 0,
                inventory: BTreeMap::new(),
                deposited_yocto: 0,
            },
        );
        self.push_event(self.day, "player", "JOIN", 0, "player joined the town");
    }

    /// Owner-only, on-chain probe: is `player`'s purse initialised?
    /// Reading another account's *existence* is harmless; reading their
    /// balances or moving their credits is not, and is not exposed.
    pub fn is_player_initialized(&self, player: AccountId) -> bool {
        self.players.contains_key(&player)
    }

    #[payable]
    pub fn player_deposit(&mut self) {
        let player = env::predecessor_account_id();
        let yocto = env::attached_deposit().as_yoctonear() as i128;
        ensure!(yocto > 0, "attach NEAR to deposit");
        let credits = yocto / (YOCTO_PER_NEAR / CREDITS_PER_NEAR);
        ensure!(credits > 0, "deposit too small");
        let mut p = self.players.get(&player).cloned().unwrap_or(Player {
            cash: 0,
            inventory: BTreeMap::new(),
            deposited_yocto: 0,
        });
        ensure!(
            p.deposited_yocto as i128 + yocto <= PLAYER_DEPOSIT_CAP_YOCTO,
            "deposit cap reached"
        );
        p.cash += credits;
        p.deposited_yocto += yocto as u128;
        self.players.insert(player, p);
        self.total_credits_minted += credits;
        self.push_event(
            self.day,
            "player",
            "DEPOSIT",
            credits,
            "player deposited NEAR for credits",
        );
    }

    /// Deterministic free action: the caller gathers raw goods into their own
    /// inventory (capped per call and in total).
    pub fn player_gather(&mut self, good: String, units: U128) {
        ensure!(GOODS.iter().any(|g| g.0 == good), "unknown good");
        let units: i128 = units.0 as i128;
        ensure!(units > 0 && units <= 50, "gather 1..=50 per call");
        let player = env::predecessor_account_id();
        let mut p = self.players.get(&player).cloned().unwrap_or(Player {
            cash: 0,
            inventory: BTreeMap::new(),
            deposited_yocto: 0,
        });
        let inv = *p.inventory.get(&good).unwrap_or(&0);
        ensure!(
            inv + units <= PLAYER_STOCK_MAX,
            "inventory limit for {} reached",
            good
        );
        p.inventory.insert(good.clone(), inv + units);
        self.players.insert(player, p);
        self.push_event(self.day, "player", "GATHER", units, &format!("gathered {}", good));
    }

    pub fn player_sell_to(&mut self, merchant_id: String, good: String, units: U128) {
        let units: i128 = units.0 as i128;
        ensure!(units > 0, "units must be positive");
        let player = env::predecessor_account_id();
        let mut p = self.players.get(&player).cloned().unwrap_or(Player {
            cash: 0,
            inventory: BTreeMap::new(),
            deposited_yocto: 0,
        });
        let mut m = self.merchants.get(&merchant_id).expect("no merchant").clone();
        ensure!(m.state == "open", "merchant closed");
        let bid = match m.bid_price.get(&good) {
            Some(b) => *b,
            None => env::panic_str("merchant does not quote this good"),
        };
        let have = *p.inventory.get(&good).unwrap_or(&0);
        let room = STOCK_MAX - m.units_or0(&good);
        let mut sell = units.min(have).min(room.max(0));
        let spendable = (m.cash - 2 * m.fixed_cost).max(0);
        let affordable = spendable / bid;
        sell = sell.min(affordable);
        ensure!(sell > 0, "nothing could be sold");
        let cost = sell * bid;
        m.cash -= cost;
        let inv = m.units_or0(&good);
        m.inventory.insert(good.clone(), inv + sell);
        let cb = *m.cost_basis.get(&good).unwrap_or(&0);
        m.cost_basis.insert(good.clone(), cb + cost);
        self.merchants.insert(merchant_id.clone(), m);
        p.cash += cost;
        p.inventory.insert(good.clone(), have - sell);
        self.players.insert(player, p);
        self.push_event(
            self.day,
            &merchant_id,
            "PLAYER_SELL",
            cost,
            &format!("player sold {} {} at bid {}", sell, good, bid),
        );
    }

    pub fn player_buy_from(&mut self, merchant_id: String, good: String, units: U128) {
        let units: i128 = units.0 as i128;
        ensure!(units > 0, "units must be positive");
        let player = env::predecessor_account_id();
        let mut p = self.players.get(&player).cloned().unwrap_or(Player {
            cash: 0,
            inventory: BTreeMap::new(),
            deposited_yocto: 0,
        });
        let mut m = self.merchants.get(&merchant_id).expect("no merchant").clone();
        ensure!(m.state == "open", "merchant closed");
        let price = match m.list_price.get(&good) {
            Some(p) => *p,
            None => env::panic_str("merchant does not quote this good"),
        };
        let avail = m.units_or0(&good);
        let buy = units.min(avail);
        ensure!(buy > 0, "merchant has no stock");
        let have = *p.inventory.get(&good).unwrap_or(&0);
        ensure!(
            have + buy <= PLAYER_STOCK_MAX,
            "inventory limit for {} reached",
            good
        );
        let cost = buy * price;
        ensure!(cost <= p.cash, "not enough credits");
        m.cash += cost;
        m.inventory.insert(good.clone(), avail - buy);
        let cb = *m.cost_basis.get(&good).unwrap_or(&0);
        let (cn, cd) = m.avg_cost(&good);
        let cogs = round_half_up(cn * buy, cd);
        m.cost_basis.insert(good.clone(), (cb - cogs).max(0));
        self.merchants.insert(merchant_id.clone(), m);
        p.cash -= cost;
        p.inventory.insert(good.clone(), have + buy);
        self.players.insert(player, p);
        self.push_event(
            self.day,
            &merchant_id,
            "PLAYER_BUY",
            cost,
            &format!("player bought {} {} at list {}", buy, good, price),
        );
    }

    /// Fund a closed merchant. Reopens it when the balance reaches 2x fixed cost.
    pub fn player_invest(&mut self, merchant_id: String, amount: U128) {
        let amount: i128 = amount.0 as i128;
        ensure!(amount > 0, "amount must be positive");
        let player = env::predecessor_account_id();
        let mut p = self.players.get(&player).cloned().unwrap_or(Player {
            cash: 0,
            inventory: BTreeMap::new(),
            deposited_yocto: 0,
        });
        ensure!(p.cash >= amount, "not enough credits");
        let mut m = self.merchants.get(&merchant_id).expect("no merchant").clone();
        ensure!(m.state == "closed", "merchant is not closed");
        p.cash -= amount;
        m.cash += amount;
        if m.cash >= 2 * m.fixed_cost {
            m.state = "open".to_string();
            m.reopened_count += 1;
            m.bankrupt_days = 0;
            self.push_event(self.day, &merchant_id, "REOPENED", m.cash, "investor funded revival");
        } else {
            self.push_event(
                self.day,
                &merchant_id,
                "INVEST_TOO_SMALL",
                m.cash,
                "below recovery threshold",
            );
        }
        self.players.insert(player, p);
        self.merchants.insert(merchant_id, m);
    }

    // -- constrained AI merchant decision ----------------------------------

    /// A merchant agent proposes a decision for *its own* shop. The caller must
    /// be the merchant's on-chain account (or the owner, for testing). The
    /// contract validates every constraint against real balances/inventory and
    /// either applies the decision or records a rejection. It never trusts the
    /// agent's numbers.
    pub fn merchant_decide(&mut self, merchant_id: String, kind: String, arg: i128) {
        let caller = env::predecessor_account_id();
        let mut m = self.merchants.get(&merchant_id).expect("no merchant").clone();
        ensure!(
            caller == m.account || caller == self.owner,
            "caller {} may not act for {}", caller, merchant_id
        );
        if m.state != "open" {
            m.last_decision = format!("REJECTED {}: merchant closed", kind);
            self.push_event(self.day, &merchant_id, "DECISION_REJECTED", arg, "merchant closed");
            self.merchants.insert(merchant_id, m);
            return;
        }
        match kind.as_str() {
            "set_markup" => {
                // arg is markup in basis points (e.g. 3000 = 30.00%)
                if arg < 0 {
                    m.last_decision = "REJECTED set_markup: negative".to_string();
                    self.push_event(self.day, &merchant_id, "DECISION_REJECTED", arg, "negative markup");
                } else {
                    let clamped = arg.clamp(500, 6000);
                    m.markup_bp = clamped;
                    m.decision_day = self.day;
                    m.last_decision = format!(
                        "ACCEPTED set_markup {}bp -> {}bp",
                        arg, clamped
                    );
                    self.push_event(self.day, &merchant_id, "DECISION_ACCEPTED", arg, "markup set");
                }
            }
            "restock_extra" => {
                // arg = units the agent wants to buy beyond the default target
                let g = m.specialty.clone();
                let inv = m.units_or0(&g);
                let room = STOCK_MAX - inv;
                let reserve = 2 * m.fixed_cost;
                let unit_cost = {
                    let (cn, cd) = self.cost_mult(&g, self.day);
                    round_half_up(good_cost(&g) * cn, cd)
                };
                let spendable = (m.cash - reserve).max(0);
                let affordable = spendable / unit_cost;
                let want = arg.clamp(0, room);
                let buy = want.min(affordable);
                if buy <= 0 {
                    m.last_decision = format!(
                        "REJECTED restock_extra {}: unaffordable (room {}, affordable {})",
                        arg, room, affordable
                    );
                    self.push_event(self.day, &merchant_id, "DECISION_REJECTED", arg, "unaffordable");
                } else {
                    let cost = buy * unit_cost;
                    m.cash -= cost;
                    m.inventory.insert(g.clone(), inv + buy);
                    let cb = *m.cost_basis.get(&g).unwrap_or(&0);
                    m.cost_basis.insert(g.clone(), cb + cost);
                    m.decision_day = self.day;
                    m.last_decision = format!("ACCEPTED restock_extra {} units for {}", buy, cost);
                    self.push_event(self.day, &merchant_id, "DECISION_ACCEPTED", cost, "restocked");
                }
            }
            "hold" => {
                m.last_decision = "ACCEPTED hold".to_string();
            }
            _ => {
                m.last_decision = format!("REJECTED unknown decision {}", kind);
                self.push_event(self.day, &merchant_id, "DECISION_REJECTED", arg, "unknown decision");
            }
        }
        self.merchants.insert(merchant_id, m);
    }

    // -- views --------------------------------------------------------------

    /// Capability probe: identifies the player model this contract exposes.
    /// Absent on the original single-purse contract, so a client can tell the
    /// two apart and label the interface honestly (see web/app.js).
    pub fn player_model(&self) -> String {
        "per-account".to_string()
    }

    pub fn get_day(&self) -> u64 {
        self.day
    }

    pub fn get_events(&self, from_id: u64) -> Vec<Event> {
        self.events
            .iter()
            .filter(|e| e.id >= from_id)
            .cloned()
            .collect()
    }

    pub fn event_count(&self) -> u64 {
        self.next_event_id
    }

    pub fn get_merchant(&self, id: String) -> Option<Merchant> {
        self.merchants.get(&id).cloned()
    }

    pub fn list_merchants(&self) -> Vec<Merchant> {
        self.merchants.values().cloned().collect()
    }

    /// A player's purse for `account`. On-chain state is publicly readable (a
    /// property of any blockchain); the website only ever asks for the
    /// connected account's own purse. Crucially, no *mutation* accepts an
    /// account argument — every action derives identity from the predecessor.
    pub fn get_player(&self, account: AccountId) -> Option<Player> {
        self.players.get(&account).cloned()
    }

    pub fn get_town(&self) -> (u64, i128, i128, i128) {
        // (day, merchant cash total, open count, number of player purses)
        let total: i128 = self.merchants.values().map(|m| m.cash).sum();
        let open = self.merchants.values().filter(|m| m.state == "open").count() as i128;
        (self.day, total, open, self.players.len() as i128)
    }

    /// Full snapshot for the UI/driver in one call.
    pub fn snapshot(&self) -> String {
        let merchants: Vec<_> = self
            .merchants
            .values()
            .map(|m| {
                let inv = *m.inventory.get(&m.specialty).unwrap_or(&0);
                let list = m.list_price.get(&m.specialty).copied().unwrap_or(0);
                let bid = m.bid_price.get(&m.specialty).copied().unwrap_or(0);
                format!(
                    r#"{{"id":"{}","name":"{}","account":"{}","specialty":"{}","cash":{},"inv":{},"list":{},"bid":{},"state":"{}","markup_bp":{},"reopened":{},"last_decision":"{}"}}"#,
                    m.id,
                    m.name,
                    m.account,
                    m.specialty,
                    m.cash,
                    inv,
                    list,
                    bid,
                    m.state,
                    m.markup_bp,
                    m.reopened_count,
                    m.last_decision
                )
            })
            .collect();
        format!(
            r#"{{"day":{},"player_count":{},"merchants":[{}],"events":{},"event_count":{}}}"#,
            self.day,
            self.players.len(),
            merchants.join(","),
            self.events.len(),
            self.next_event_id
        )
    }

    // -- internals ----------------------------------------------------------

    fn assert_owner(&self) {
        ensure!(
            env::predecessor_account_id() == self.owner,
            "owner only"
        );
    }

    fn push_event(&mut self, day: u64, merchant: &str, kind: &str, value: i128, note: &str) {
        let id = self.next_event_id;
        self.next_event_id += 1;
        self.events.push(Event {
            id,
            day,
            merchant: merchant.to_string(),
            kind: kind.to_string(),
            value,
            note: note.to_string(),
        });
    }
}

impl Merchant {
    fn units_or0(&self, g: &str) -> i128 {
        *self.inventory.get(g).unwrap_or(&0)
    }
    fn avg_cost(&self, g: &str) -> (i128, i128) {
        let inv = self.units_or0(g);
        if inv <= 0 {
            (good_ref(g), 1)
        } else {
            rat(*self.cost_basis.get(g).unwrap_or(&0), inv)
        }
    }
}

/// Owner can withdraw unallocated NEAR held by the contract (e.g. testnet funds).
#[near]
impl Contract {
    pub fn owner_withdraw(&mut self, amount: NearToken) {
        self.assert_owner();
        Promise::new(self.owner.clone()).transfer(amount).detach();
    }

    /// One-time, owner-only upgrade from the original single-`Player` layout to
    /// the per-account `players` map. The existing shared purse becomes the
    /// owner's own purse (the town's "resident" player), so no credits,
    /// inventory or deposited-NEAR accounting is lost; every merchant, event,
    /// shock and town counter is carried over verbatim.
    ///
    /// Borsh is positional, so this re-reads the deployed bytes as `OldContract`
    /// and rewrites the same value under the new struct. `#[init(ignore_state)]`
    /// tells the SDK to skip deserialising the old state into the new struct
    /// (which would fail on the changed field) and lets this method do the
    /// conversion explicitly. Called with `deploy` + `migrate` in one batch.
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: OldContract = env::state_read().unwrap_or_else(|| env::panic_str("no state"));
        ensure!(
            env::predecessor_account_id() == old.owner,
            "migrate: owner only"
        );
        let mut players = IterableMap::new(b"p");
        if old.player.cash != 0
            || old.player.deposited_yocto != 0
            || !old.player.inventory.is_empty()
        {
            players.insert(old.owner.clone(), old.player);
        }
        Self {
            owner: old.owner,
            day: old.day,
            merchants: old.merchants,
            players,
            events: old.events,
            shocks: old.shocks,
            next_event_id: old.next_event_id,
            lifeline_enabled: old.lifeline_enabled,
            total_credits_minted: old.total_credits_minted,
            total_fixed_paid: old.total_fixed_paid,
            total_revenue: old.total_revenue,
        }
    }
}
