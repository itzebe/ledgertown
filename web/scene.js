// The town scene: a pure, presentation-only reading of the four merchant
// buildings. Every value here is derived from real contract state (see
// economy.js) — the building's shape is fixed art, but its *condition* (lit
// windows, smoke, boarding, a revival flag) comes from the shop's actual cash,
// stock and lifecycle state. Nothing is fabricated.
//
// Dependency-free and I/O-free so the scene can be unit-tested offline
// (tests/town.test.js) and rendered identically by any surface.

import { GOODS, merchantRead } from "./economy.js";

export const TOWN_W = 1000;
export const TOWN_H = 400;
export const GROUND_Y = 322;

/** Fixed town order — the four shops as they stand along the high street. */
export const TOWN_ORDER = ["miller", "smith", "weaver", "brewer"];

/** One-word condition of a shop, from its real numbers. Ordered by severity so
 *  the town reads at a glance: thriving → strained → recovering → distressed →
 *  insolvent → closed. */
export function buildingState(m, r) {
  if (m.state === "closed") return "closed";
  if ((m.cash ?? 0) < 0) return "insolvent";
  if ((m.bankrupt_days ?? 0) > 0) return "recovering";
  if ((m.cash ?? 0) < (m.fixed_cost ?? 0)) return "distressed";
  if ((m.cash ?? 0) < (r?.reserve ?? 0)) return "strained";
  return "thriving";
}

const STATE_LABEL = {
  thriving: "thriving",
  strained: "under pressure",
  recovering: "recovering",
  distressed: "distressed",
  insolvent: "insolvent",
  closed: "closed",
};

export function stateLabel(state) {
  return STATE_LABEL[state] || state;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/** Which window treatment a shop's condition earns. A thriving shop is lit; a
 *  shop under pressure is dim; an insolvent one is dark; a closed one is
 *  boarded. This is the whole point of the scene: the state is visible. */
function windowState(state) {
  if (state === "closed") return "boarded";
  if (state === "insolvent" || state === "distressed") return "dark";
  if (state === "strained") return "dim";
  return "lit";
}

/** Pure scene model: the four buildings with the numbers a scene needs.
 *  `read` is the derived economic read from marketRead(); it is recomputed per
 *  merchant when absent so the model is safe to call on its own. */
export function sceneModel(state = {}, read = null) {
  const merchants = state.merchants || [];
  const byId = Object.fromEntries(merchants.map((m) => [m.id, m]));
  const known = TOWN_ORDER.filter((id) => byId[id]);
  const extra = merchants.map((m) => m.id).filter((id) => !TOWN_ORDER.includes(id));
  const order = [...known, ...extra];
  const n = Math.max(1, order.length);
  const slot = TOWN_W / n;

  return order.map((id, i) => {
    const m = byId[id];
    const r = read?.merchants?.[id] || merchantRead(m);
    const bstate = buildingState(m, r);
    return {
      id,
      name: m.name,
      specialty: m.specialty,
      account: m.account,
      cx: Math.round(slot * i + slot / 2),
      slotW: Math.round(slot),
      state: bstate,
      label: stateLabel(bstate),
      window: windowState(bstate),
      health: r.health,
      cash: m.cash ?? 0,
      fixedCost: m.fixed_cost ?? 0,
      reserve: r.reserve ?? 0,
      inv: r.inv ?? 0,
      target: r.target ?? 0,
      list: r.list ?? null,
      bid: r.bid ?? null,
      reopened: m.reopened_count ?? 0,
      bankruptDays: m.bankrupt_days ?? 0,
    };
  });
}

// -- fixed building art (hand-authored SVG; no external assets) -------------
//
// Each shop has its own silhouette so the four are distinguishable at a glance:
//   miller  — a barn with a grain silo
//   smith   — a squat forge with a tall chimney
//   weaver  — a tall workshop with a wide loom window
//   brewer  — a two-storey inn with a hanging sign
// All shapes are drawn centred on x = 0; the scene translates each into place.

function windows(kind, win) {
  const cls = `win win--${win}`;
  switch (kind) {
    case "miller":
      return `<rect class="${cls}" x="-6" y="248" width="28" height="28" rx="1"/>
              <rect class="b-door" x="46" y="272" width="32" height="50"/>`;
    case "smith":
      return `<rect class="${cls}" x="-46" y="250" width="30" height="30" rx="1"/>
              <rect class="${cls}" x="14" y="250" width="30" height="30" rx="1"/>`;
    case "weaver":
      return `<rect class="${cls} win--wide" x="-38" y="222" width="76" height="60" rx="2"/>
              <rect class="b-door" x="-14" y="292" width="28" height="30"/>`;
    case "brewer":
      return `<rect class="${cls}" x="-52" y="244" width="28" height="28" rx="1"/>
              <rect class="${cls}" x="22" y="244" width="28" height="28" rx="1"/>`;
    default:
      return `<rect class="${cls}" x="-24" y="248" width="48" height="30" rx="1"/>`;
  }
}

function buildingArt(kind, win) {
  switch (kind) {
    case "miller":
      return `
        <rect class="b-body" x="-80" y="176" width="48" height="146" rx="4"/>
        <path class="b-roof" d="M-80 178 q24 -34 48 0 z"/>
        <path class="b-body" d="M-24 322 v-104 h108 v104 z"/>
        <path class="b-roof" d="M-32 220 l16 -36 h96 l16 36 z"/>
        ${windows("miller", win)}`;
    case "smith":
      return `
        <rect class="b-chimney" x="34" y="146" width="28" height="78"/>
        <path class="b-body" d="M-72 322 v-92 h144 v92 z"/>
        <path class="b-roof" d="M-82 232 l16 -32 h132 l16 32 z"/>
        ${windows("smith", win)}`;
    case "weaver":
      return `
        <path class="b-body" d="M-66 322 v-124 h132 v124 z"/>
        <path class="b-roof" d="M-76 200 l10 -34 h132 l10 34 z"/>
        ${windows("weaver", win)}`;
    case "brewer":
      return `
        <path class="b-body" d="M-74 322 v-100 h148 v100 z"/>
        <path class="b-roof" d="M-84 224 l10 -40 l60 -24 l60 24 l10 40 z"/>
        <line class="b-arm" x1="74" y1="238" x2="98" y2="238"/>
        <circle class="b-sign" cx="98" cy="248" r="10"/>
        ${windows("brewer", win)}`;
    default:
      return `
        <path class="b-body" d="M-60 322 v-96 h120 v96 z"/>
        <path class="b-roof" d="M-70 228 l10 -30 h120 l10 30 z"/>
        ${windows("other", win)}`;
  }
}

/** SVG for one building, positioned at its slot centre. `selected` draws the
 *  focus ring; `canAct` is surfaced as data so a surface can style affordances
 *  without guessing. */
export function buildingSvg(b, { selected = false } = {}) {
  const kind = b.specialty;
  return `
  <g class="bld bld--${b.state}${selected ? " bld--sel" : ""}"
     transform="translate(${b.cx} 0)"
     data-merchant="${esc(b.id)}" role="button" tabindex="0"
     aria-label="${esc(b.name)}, ${esc(b.specialty)} shop, ${esc(b.label)}${b.reopened ? `, revived ${b.reopened} time(s)` : ""}"
     aria-pressed="${selected ? "true" : "false"}">
    <ellipse class="b-shadow" cx="0" cy="${GROUND_Y + 4}" rx="86" ry="10"/>
    ${buildingArt(kind, b.window)}
    <g class="b-signplate" transform="translate(0 ${GROUND_Y + 26})">
      <rect x="-62" y="-13" width="124" height="26" rx="4"/>
      <text class="b-name" x="0" y="-1">${esc(b.name)}</text>
      <text class="b-spec" x="0" y="10">${esc(b.specialty)} · ${esc(b.label)}</text>
    </g>
    ${b.reopened ? `<g class="b-revived" transform="translate(-58 150)">
      <circle cx="0" cy="0" r="11"/><text x="0" y="4">↻</text></g>` : ""}
    ${b.state === "thriving" ? `<g class="b-smoke" transform="translate(${kind === "smith" ? 48 : 0} 0)">
      <circle cx="0" cy="140" r="6"/><circle cx="6" cy="126" r="7"/><circle cx="0" cy="112" r="8"/></g>` : ""}
  </g>`;
}

/** The whole town as one SVG string. */
export function townSvg(model, { selected = null } = {}) {
  const sky = `
    <rect class="sky" x="0" y="0" width="${TOWN_W}" height="${GROUND_Y}"/>
    <circle class="sky-sun" cx="840" cy="96" r="34"/>
    <path class="sky-hill" d="M0 ${GROUND_Y - 40} q180 -54 360 -10 q200 50 420 -18 q120 -40 220 -6 v74 H0 z"/>
    <rect class="ground" x="0" y="${GROUND_Y}" width="${TOWN_W}" height="${TOWN_H - GROUND_Y}"/>
    <path class="road" d="M0 ${GROUND_Y + 34} H${TOWN_W}"/>`;
  const buildings = model.map((b) => buildingSvg(b, { selected: b.id === selected })).join("");
  return `<svg id="town-svg" viewBox="0 0 ${TOWN_W} ${TOWN_H}" role="group"
    aria-label="The town: four merchant shops" preserveAspectRatio="xMidYMid meet">
    ${sky}${buildings}</svg>`;
}

/** The town as a compact row of tiles — the narrow-screen form of the scene.
 *  The drawing cannot stay legible on a phone (its labels would render at a few
 *  pixels), so below the wide breakpoint the same four shops are shown as
 *  tappable tiles carrying the same condition. Same model, same controls. */
export function townTiles(model, { selected = null } = {}) {
  const tiles = model.map((b) => `
    <button class="tile tile--${b.state}${b.id === selected ? " tile--sel" : ""}"
      data-merchant="${esc(b.id)}" aria-pressed="${b.id === selected ? "true" : "false"}"
      aria-label="${esc(b.name)}, ${esc(b.specialty)} shop, ${esc(b.label)}${b.reopened ? `, revived ${b.reopened} time(s)` : ""}">
      <span class="tile-top"><span class="tile-sw"></span><span class="tile-name">${esc(b.name)}</span></span>
      <span class="tile-cond">${esc(b.label)}</span>
      <span class="tile-nums"><span class="num">${b.cash}</span> cr · <span class="num">${b.inv}</span> ${esc(b.specialty)}</span>
    </button>`).join("");
  return `<div class="tiles">${tiles}</div>`;
}
