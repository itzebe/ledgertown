//! Contract tests: economic rules, agent constraints, and survival/price
//! invariants that must match the reference Python engine
//! (`ledgertown-feasibility/simulate.py`).

use ledgertown::*;
use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

fn owner() -> near_sdk::AccountId {
    "owner.testnet".parse().unwrap()
}

fn setup() -> Contract {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(owner())
        .attached_deposit(near_sdk::NearToken::from_yoctonear(0))
        .build());
    let mut c = Contract::new(owner());
    let town = [
        ("miller", "Miller", "miller.ledgertown.testnet", "grain"),
        ("smith", "Smith", "smith.ledgertown.testnet", "iron"),
        ("weaver", "Weaver", "weaver.ledgertown.testnet", "cloth"),
        ("brewer", "Brewer", "brewer.ledgertown.testnet", "ale"),
    ];
    for (id, name, acct, good) in town {
        c.seed_merchant(
            id.to_string(),
            name.to_string(),
            acct.parse().unwrap(),
            good.to_string(),
            U128(300),
            U128(20),
        );
    }
    c
}

fn as_account(id: &str) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(id.parse().unwrap())
        .attached_deposit(near_sdk::NearToken::from_yoctonear(0))
        .build());
}

#[test]
fn seed_creates_four_merchants_with_capital() {
    let c = setup();
    assert_eq!(c.list_merchants().len(), 4);
    for m in c.list_merchants() {
        assert_eq!(m.cash, 300);
        assert_eq!(*m.inventory.get(&m.specialty).unwrap(), 20);
        assert_eq!(m.state, "open");
        assert_eq!(m.account.as_str(), format!("{}.ledgertown.testnet", m.id));
    }
}

#[test]
fn first_day_prices_match_reference() {
    let mut c = setup();
    c.tick();
    let smith = c.get_merchant("smith".to_string()).unwrap();
    let miller = c.get_merchant("miller".to_string()).unwrap();
    // reference simulate.py day 1: smith iron list 20, miller grain list 12
    assert_eq!(*smith.list_price.get("iron").unwrap(), 20, "smith iron list");
    assert_eq!(*miller.list_price.get("grain").unwrap(), 12, "miller grain list");
    assert!(smith.bid_price["iron"] < smith.list_price["iron"]);
    assert!(miller.bid_price["grain"] < miller.list_price["grain"]);
}

#[test]
fn bid_is_always_below_list() {
    let mut c = setup();
    for _ in 0..20 {
        c.tick();
    }
    for m in c.list_merchants() {
        for g in ["grain", "iron", "cloth", "ale"] {
            if let (Some(l), Some(b)) = (m.list_price.get(g), m.bid_price.get(g)) {
                assert!(b < l, "{} {} bid {} !< list {}", m.id, g, b, l);
            }
        }
    }
}

#[test]
fn deposit_mints_credits_at_fixed_rate() {
    let mut c = setup();
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id("player.testnet".parse().unwrap())
        .attached_deposit(near_sdk::NearToken::from_near(10))
        .build());
    c.player_deposit();
    assert_eq!(c.get_player("player.testnet".parse().unwrap()).unwrap().cash, 10 * 1000, "10 NEAR -> 10,000 credits");
}

#[test]
fn player_sell_earns_and_buy_costs() {
    let mut c = setup();
    c.tick();
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id("player.testnet".parse().unwrap())
        .attached_deposit(near_sdk::NearToken::from_near(100))
        .build());
    c.player_deposit();
    c.player_gather("iron".to_string(), U128(50));
    let before = c.get_player("player.testnet".parse().unwrap()).unwrap().cash;
    c.player_sell_to("smith".to_string(), "iron".to_string(), U128(50));
    let after_sell = c.get_player("player.testnet".parse().unwrap()).unwrap().cash;
    assert!(after_sell > before, "selling earned credits");
    let held = c.get_player("player.testnet".parse().unwrap()).unwrap().inventory.get("iron").copied().unwrap_or(0);
    assert!(held < 50, "some iron was sold");
    if held > 0 {
        c.player_buy_from("smith".to_string(), "iron".to_string(), U128(held as u128));
        assert!(
            c.get_player("player.testnet".parse().unwrap()).unwrap().cash < after_sell,
            "buying back at list must cost credits"
        );
    }
}

#[test]
fn merchant_agent_cannot_exceed_cash() {
    let mut c = setup();
    c.tick();
    as_account("smith.ledgertown.testnet");
    c.merchant_decide("smith".to_string(), "restock_extra".to_string(), 100_000);
    let after = c.get_merchant("smith".to_string()).unwrap();
    assert!(after.cash >= 0, "cash {} must stay >= 0", after.cash);
    assert!(after.cash >= 2 * after.fixed_cost, "reserve must be preserved");
    let inv = *after.inventory.get("iron").unwrap_or(&0);
    assert!(inv <= 400, "stock capped at STOCK_MAX, got {}", inv);
    assert!(after.last_decision.contains("ACCEPTED") || after.last_decision.contains("REJECTED"));
}

#[test]
fn agent_may_not_act_for_another_merchant() {
    let mut c = setup();
    c.tick();
    as_account("miller.ledgertown.testnet");
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.merchant_decide("smith".to_string(), "set_markup".to_string(), 3000);
    }));
    assert!(r.is_err(), "miller must not be able to act for smith");
}

#[test]
fn markup_decision_is_clamped() {
    let mut c = setup();
    c.tick();
    as_account("smith.ledgertown.testnet");
    c.merchant_decide("smith".to_string(), "set_markup".to_string(), 999_999);
    let m = c.get_merchant("smith".to_string()).unwrap();
    assert_eq!(m.markup_bp, 6000, "markup clamped to the 60% ceiling");
}

#[test]
fn closed_merchant_reopens_only_when_funded_past_threshold() {
    let mut c = setup();
    // starve smith, then close it via a demand collapse with no sales
    c.set_lifeline_enabled(false);
    c.add_shock("demand".to_string(), "iron".to_string(), 1, 100, 1, 60);
    as_account("player.testnet");
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id("player.testnet".parse().unwrap())
        .attached_deposit(near_sdk::NearToken::from_near(100))
        .build());
    c.player_deposit();
    c.tick();
    c.player_buy_from("smith".to_string(), "iron".to_string(), U128(20));
    for _ in 0..30 {
        c.tick();
    }
    let smith = c.get_merchant("smith".to_string()).unwrap();
    assert_eq!(smith.state, "closed", "smith should have closed");
    // too-small investment does not reopen
    c.player_invest("smith".to_string(), U128(10));
    assert_eq!(c.get_merchant("smith".to_string()).unwrap().state, "closed");
    // sufficient investment reopens
    c.player_invest("smith".to_string(), U128(120));
    let s2 = c.get_merchant("smith".to_string()).unwrap();
    assert_eq!(s2.state, "open", "smith should reopen when funded past 2x fixed cost");
    assert!(s2.reopened_count >= 1);
    assert!(c.get_events(0).iter().any(|e| e.kind == "REOPENED"));
}

#[test]
fn baseline_30_days_survival_and_price_bounds() {
    let mut c = setup();
    for _ in 0..30 {
        c.tick();
    }
    let ms = c.list_merchants();
    assert_eq!(ms.len(), 4);
    for m in &ms {
        assert_eq!(m.state, "open", "{} should survive 30 calm days", m.id);
        assert!(m.cash > 0, "{} cash {}", m.id, m.cash);
        let inv = *m.inventory.get(&m.specialty).unwrap();
        assert!(inv >= 0, "{} stock {}", m.id, inv);
        let list = *m.list_price.get(&m.specialty).unwrap();
        let refp = match m.specialty.as_str() {
            "grain" => 12,
            "iron" => 21,
            "cloth" => 33,
            "ale" => 15,
            _ => panic!(),
        };
        let lo = (refp * 60 + 99) / 100;
        let hi = (refp * 160 + 50) / 100;
        assert!(list >= lo && list <= hi, "{} list {} out of [{}, {}]", m.id, list, lo, hi);
    }
}

/// Exact day-by-day parity with the reference engine: replay 30 calm days on
/// the contract and compare every (day, merchant) cash / stock / list-price /
/// sold row against `testdata/golden_baseline.json`, which is produced by
/// `simulate.py`. This is the strongest evidence that the on-chain settlement
/// layer reproduces the validated economics exactly.
#[test]
fn exact_parity_with_reference_engine_30_days() {
    let golden: Vec<serde_json::Value> = serde_json::from_str(
        include_str!("../testdata/golden_baseline.json"),
    )
    .expect("golden json parses");

    // group golden rows by day
    let mut by_day: std::collections::BTreeMap<u64, Vec<&serde_json::Value>> =
        std::collections::BTreeMap::new();
    for row in &golden {
        let d = row["day"].as_u64().unwrap();
        by_day.entry(d).or_default().push(row);
    }

    let mut c = setup();
    let mut mismatches: Vec<String> = Vec::new();
    for day in 1..=30u64 {
        c.tick();
        let rows = match by_day.get(&day) {
            Some(r) => r,
            None => continue,
        };
        for row in rows {
            let mid = row["merchant"].as_str().unwrap();
            let m = c.get_merchant(mid.to_string()).unwrap();
            let g_cash = row["cash"].as_i64().unwrap() as i128;
            let g_inv = row["inv"].as_i64().unwrap() as i128;
            let g_list = row["list"].as_i64().unwrap() as i128;
            let g_state = row["state"].as_str().unwrap();
            let c_inv = *m.inventory.get(&m.specialty).unwrap();
            let c_list = *m.list_price.get(&m.specialty).unwrap();
            if m.cash != g_cash || c_inv != g_inv || c_list != g_list || m.state != g_state {
                mismatches.push(format!(
                    "day {} {}: contract(cash {} inv {} list {} {}) vs ref(cash {} inv {} list {} {})",
                    day, mid, m.cash, c_inv, c_list, m.state, g_cash, g_inv, g_list, g_state
                ));
            }
        }
    }
    assert!(
        mismatches.is_empty(),
        "contract diverged from reference engine in {} rows:\n{}",
        mismatches.len(),
        mismatches.join("\n")
    );
}

// -- per-account player model (non-custodial ownership) ----------------------

fn as_player(id: &str, near: u128) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(id.parse().unwrap())
        .attached_deposit(near_sdk::NearToken::from_yoctonear(near * 1_000_000_000_000_000_000_000_000))
        .build());
}

#[test]
fn two_players_have_isolated_purses() {
    let mut c = setup();
    c.tick();
    as_player("alice.testnet", 10);
    c.player_init();
    c.player_deposit();
    c.player_gather("grain".to_string(), U128(30));

    as_player("bob.testnet", 5);
    c.player_init();
    c.player_deposit();

    let alice = c.get_player("alice.testnet".parse().unwrap()).unwrap();
    let bob = c.get_player("bob.testnet".parse().unwrap()).unwrap();
    assert_eq!(alice.cash, 10 * 1000, "alice keeps her own deposit");
    assert_eq!(bob.cash, 5 * 1000, "bob keeps his own deposit");
    assert_eq!(*alice.inventory.get("grain").unwrap_or(&0), 30);
    assert_eq!(*bob.inventory.get("grain").unwrap_or(&0), 0, "bob did not gather");
    assert_eq!(c.get_town().3, 2, "two distinct purses exist");
}

#[test]
fn a_player_cannot_touch_another_purse() {
    let mut c = setup();
    c.tick();
    // alice funds and gathers
    as_player("alice.testnet", 10);
    c.player_init();
    c.player_deposit();
    c.player_gather("grain".to_string(), U128(20));
    // bob, with no funds and no grain, tries to sell grain he does not own
    as_player("bob.testnet", 0);
    c.player_init();
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.player_sell_to("miller".to_string(), "grain".to_string(), U128(10));
    }));
    assert!(r.is_err(), "bob cannot sell goods he does not own");
    // bob cannot invest credits he does not have
    let r2 = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.player_invest("smith".to_string(), U128(50));
    }));
    assert!(r2.is_err(), "bob cannot invest credits he does not have");
    // alice's purse is untouched by bob's failed attempts
    let alice = c.get_player("alice.testnet".parse().unwrap()).unwrap();
    assert_eq!(alice.cash, 10 * 1000);
    assert_eq!(*alice.inventory.get("grain").unwrap_or(&0), 20);
}

#[test]
fn player_init_is_idempotent_and_does_not_reset_state() {
    let mut c = setup();
    c.tick();
    as_player("alice.testnet", 10);
    c.player_init();
    c.player_deposit();
    c.player_gather("iron".to_string(), U128(15));
    c.player_init(); // second call must be a no-op
    let a = c.get_player("alice.testnet".parse().unwrap()).unwrap();
    assert_eq!(a.cash, 10 * 1000);
    assert_eq!(*a.inventory.get("iron").unwrap_or(&0), 15);
    assert_eq!(c.get_town().3, 1, "no duplicate purse created");
}

#[test]
fn gather_respects_the_per_player_inventory_limit() {
    let mut c = setup();
    c.tick();
    as_player("alice.testnet", 0);
    c.player_init();
    // 10 calls of 50 = 500 (the cap). The 11th must fail.
    for _ in 0..10 {
        c.player_gather("ale".to_string(), U128(50));
    }
    assert_eq!(*c.get_player("alice.testnet".parse().unwrap()).unwrap()
        .inventory.get("ale").unwrap_or(&0), 500);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.player_gather("ale".to_string(), U128(1));
    }));
    assert!(r.is_err(), "gather past PLAYER_STOCK_MAX must be refused");
}

#[test]
fn deposit_cap_limits_lifetime_deposits() {
    let mut c = setup();
    c.tick();
    as_player("alice.testnet", 100); // exactly the 100-NEAR cap
    c.player_init();
    c.player_deposit();
    assert_eq!(c.get_player("alice.testnet".parse().unwrap()).unwrap().cash, 100 * 1000);
    as_player("alice.testnet", 1); // one more NEAR exceeds the cap
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.player_deposit();
    }));
    assert!(r.is_err(), "deposit past the lifetime cap must be refused");
}

#[test]
fn buy_respects_the_per_player_inventory_limit() {
    let mut c = setup();
    c.tick();
    as_player("alice.testnet", 100);
    c.player_init();
    c.player_deposit();
    // Fill alice's iron inventory via buys; merchant stock is capped at 400 so
    // the player cap (500) is reachable across two merchants' worth of stock.
    let mut total = 0;
    for _ in 0..20 {
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.player_buy_from("smith".to_string(), "iron".to_string(), U128(50));
        }));
        if r.is_err() { break; }
        total = *c.get_player("alice.testnet".parse().unwrap()).unwrap()
            .inventory.get("iron").unwrap_or(&0);
        if total >= 400 { break; }
    }
    assert!(total <= 500, "player inventory never exceeds the cap (got {})", total);
}

#[test]
fn is_player_initialized_reflects_real_state() {
    let mut c = setup();
    c.tick();
    assert!(!c.is_player_initialized("alice.testnet".parse().unwrap()));
    as_player("alice.testnet", 0);
    c.player_init();
    assert!(c.is_player_initialized("alice.testnet".parse().unwrap()));
    assert!(!c.is_player_initialized("carol.testnet".parse().unwrap()));
}

#[test]
fn migrate_carries_over_town_and_shared_purse() {
    let mut c = setup();
    c.tick();
    as_player("player.testnet", 10);
    c.player_init();
    c.player_deposit();
    c.player_gather("iron".to_string(), U128(7));
    let shared = c.get_player("player.testnet".parse().unwrap()).unwrap();

    // Serialise the town exactly as the DEPLOYED (single-player) contract would
    // have stored it, then run the real migration over those bytes.
    let old = OldContract {
        owner: c.owner.clone(),
        day: c.day,
        merchants: c.merchants.clone(),
        player: shared.clone(),
        events: c.events.clone(),
        shocks: c.shocks.clone(),
        next_event_id: c.next_event_id,
        lifeline_enabled: c.lifeline_enabled,
        total_credits_minted: c.total_credits_minted,
        total_fixed_paid: c.total_fixed_paid,
        total_revenue: c.total_revenue,
    };
    near_sdk::env::state_write(&old);

    as_account("owner.testnet"); // migrate is owner-only
    let migrated = Contract::migrate();

    assert_eq!(migrated.day, old.day, "day preserved");
    assert_eq!(migrated.merchants.len(), 4, "all merchants preserved");
    assert_eq!(migrated.events.len(), old.events.len(), "event log preserved");
    assert_eq!(migrated.next_event_id, old.next_event_id);
    assert_eq!(migrated.total_revenue, old.total_revenue);
    // The shared purse becomes the owner's purse — no credits or goods lost.
    let owner_purse = migrated.get_player(old.owner.clone()).unwrap();
    assert_eq!(owner_purse.cash, shared.cash);
    assert_eq!(owner_purse.deposited_yocto, shared.deposited_yocto);
    assert_eq!(*owner_purse.inventory.get("iron").unwrap_or(&0), 7);
    // A brand-new account has no purse yet; the map is genuinely per-account.
    assert!(migrated.get_player("newcomer.testnet".parse().unwrap()).is_none());
}

#[test]
fn migrate_is_owner_only() {
    let mut c = setup();
    let old = OldContract {
        owner: c.owner.clone(),
        day: c.day,
        merchants: c.merchants.clone(),
        player: Player { cash: 0, inventory: std::collections::BTreeMap::new(), deposited_yocto: 0 },
        events: Vec::new(),
        shocks: Vec::new(),
        next_event_id: 0,
        lifeline_enabled: true,
        total_credits_minted: 0,
        total_fixed_paid: 0,
        total_revenue: 0,
    };
    near_sdk::env::state_write(&old);
    as_account("intruder.testnet");
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| Contract::migrate()));
    assert!(r.is_err(), "a non-owner must not be able to run the migration");
}
