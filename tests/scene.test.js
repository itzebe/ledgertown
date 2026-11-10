import { test } from "node:test";
import assert from "node:assert/strict";
import { sceneModel, townSvg, townTiles, buildingState, stateLabel, TOWN_ORDER } from "../web/scene.js";

// A snapshot shaped exactly like /api/state. Values are the real live town
// (day 51) so the scene model is exercised against realistic numbers.
function town(over = {}) {
  const base = {
    day: 51,
    merchants: [
      { id: "brewer", name: "Brewer", specialty: "ale", account: "brewer.ledgertown.testnet",
        fixed_cost: 25, cash: 816, inventory: { ale: 11 }, cost_basis: { ale: 132 },
        list_price: { ale: 15 }, bid_price: { ale: 11 }, state: "open", reopened_count: 0, bankrupt_days: 0 },
      { id: "miller", name: "Miller", specialty: "grain", account: "miller.ledgertown.testnet",
        fixed_cost: 25, cash: 697, inventory: { grain: 16 }, cost_basis: { grain: 160 },
        list_price: { grain: 12 }, bid_price: { grain: 10 }, state: "open", reopened_count: 0, bankrupt_days: 0 },
      { id: "smith", name: "Smith", specialty: "iron", account: "smith.ledgertown.testnet",
        fixed_cost: 25, cash: 744, inventory: { iron: 9 }, cost_basis: { iron: 153 },
        list_price: { iron: 21 }, bid_price: { iron: 15 }, state: "open", reopened_count: 1, bankrupt_days: 0 },
      { id: "weaver", name: "Weaver", specialty: "cloth", account: "weaver.ledgertown.testnet",
        fixed_cost: 25, cash: 1179, inventory: { cloth: 6 }, cost_basis: { cloth: 162 },
        list_price: { cloth: 33 }, bid_price: { cloth: 31 }, state: "open", reopened_count: 0, bankrupt_days: 0 },
    ],
  };
  return { ...base, ...over };
}

test("sceneModel lays the four shops in the fixed town order, evenly spaced", () => {
  const model = sceneModel(town());
  assert.deepEqual(model.map((b) => b.id), TOWN_ORDER);
  // centres strictly increase and are symmetric about the town width
  for (let i = 1; i < model.length; i++) assert.ok(model[i].cx > model[i - 1].cx);
  const first = model[0].cx, last = model[model.length - 1].cx;
  assert.equal(first, 1000 - last); // symmetric layout
});

test("a well-funded open shop is thriving and lit", () => {
  const model = sceneModel(town());
  for (const b of model) {
    assert.equal(b.state, "thriving");
    assert.equal(b.window, "lit");
    assert.equal(b.label, "thriving");
  }
});

test("buildingState follows the contract's real thresholds, most severe first", () => {
  assert.equal(buildingState({ state: "closed", cash: -5, bankrupt_days: 0 }, { reserve: 50 }), "closed");
  assert.equal(buildingState({ state: "open", cash: -1, bankrupt_days: 0 }, { reserve: 50 }), "insolvent");
  assert.equal(buildingState({ state: "open", cash: 100, bankrupt_days: 2 }, { reserve: 50 }), "recovering");
  assert.equal(buildingState({ state: "open", cash: 10, fixed_cost: 25, bankrupt_days: 0 }, { reserve: 50 }), "distressed");
  assert.equal(buildingState({ state: "open", cash: 40, fixed_cost: 25, bankrupt_days: 0 }, { reserve: 50 }), "strained");
  assert.equal(buildingState({ state: "open", cash: 400, fixed_cost: 25, bankrupt_days: 0 }, { reserve: 50 }), "thriving");
});

test("window treatment maps condition to a distinct, legible treatment", () => {
  const at = (cash, bankrupt_days = 0, state = "open") =>
    sceneModel(town({ merchants: [{ ...town().merchants[0], cash, bankrupt_days, state }] }))[0];
  assert.equal(at(400).window, "lit");
  assert.equal(at(40).window, "dim");        // strained
  assert.equal(at(10).window, "dark");       // distressed (cash < fixed cost)
  assert.equal(at(-3).window, "dark");       // insolvent
  assert.equal(at(-3, 0, "closed").window, "boarded");
});

test("a revived shop carries the revival count and a recovering roof", () => {
  const m = { ...town().merchants[0], reopened_count: 2, bankrupt_days: 1, cash: 100 };
  const b = sceneModel(town({ merchants: [m] }))[0];
  assert.equal(b.reopened, 2);
  assert.equal(b.state, "recovering");
  const svg = townSvg([b]);
  assert.match(svg, /b-revived/);
  assert.match(svg, /bld--recovering/);
});

test("townSvg is self-contained SVG: no scripts, no external references", () => {
  const svg = townSvg(sceneModel(town()));
  assert.match(svg, /^<svg id="town-svg"/);
  assert.doesNotMatch(svg, /<script/i);
  assert.doesNotMatch(svg, /xlink:href|href\s*=\s*"http/i);
  // every building is a labelled, focusable control
  const labels = svg.match(/role="button"/g) || [];
  assert.equal(labels.length, 4);
});

test("every window carries its condition class — the scene must show state", () => {
  // Regression: the window state must reach the SVG. A building whose windows
  // render with no win--* class is a scene that shows nothing about the shop.
  const at = (over) => townSvg(sceneModel(town({ merchants: [{ ...town().merchants[0], ...over }] })));
  assert.match(at({ cash: 400 }), /win win--lit/);
  assert.match(at({ cash: 40 }), /win win--dim/);            // strained
  assert.match(at({ cash: 10 }), /win win--dark/);           // distressed
  assert.match(at({ cash: -3 }), /win win--dark/);           // insolvent
  assert.match(at({ cash: -3, state: "closed" }), /win win--boarded/);
  // and no window is ever left untyped
  for (const over of [{ cash: 400 }, { cash: 40 }, { cash: 10 }, { cash: -3 }, { cash: -3, state: "closed" }])
    assert.doesNotMatch(at(over), /win--undefined/);
});

test("townTiles is the narrow-screen form: four tappable shops carrying condition", () => {
  const model = sceneModel(town());
  const html = townTiles(model, { selected: "smith" });
  const btns = html.match(/<button/g) || [];
  assert.equal(btns.length, 4);
  assert.match(html, /data-merchant="smith"/);
  assert.match(html, /class="tile tile--thriving tile--sel"/);
  assert.match(html, /aria-pressed="true"/);
  assert.equal((html.match(/aria-pressed="false"/g) || []).length, 3);
  // numbers a player can read without a drawing
  assert.match(html, /697<\/span> cr/);
});

test("townTiles escapes merchant-supplied text", () => {
  const html = townTiles(sceneModel({ merchants: [{ id: "x", name: "<b>x</b>", specialty: "grain" }] }));
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(html, /&lt;b&gt;/);
});

test("sceneModel tolerates an empty or malformed town without throwing", () => {
  assert.deepEqual(sceneModel({}), []);
  assert.deepEqual(sceneModel({ merchants: [] }), []);
  assert.doesNotThrow(() => sceneModel({ merchants: [{ id: "x", name: "X", specialty: "grain" }] }));
  assert.doesNotThrow(() => townSvg(sceneModel({ merchants: [{}] })));
});

test("stateLabel never returns an empty string for a real state", () => {
  for (const s of ["thriving", "strained", "recovering", "distressed", "insolvent", "closed"])
    assert.ok(stateLabel(s).length > 0);
});
