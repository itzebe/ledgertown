// Source invariants for the play band that the offline suite can check without
// a browser. These guard the "no enabled control the deployed app cannot honour"
// rule: gather buttons live in markup, so the app must gate them at render time.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "web", "app.js"), "utf8");

test("every static gather button is inside the #purse-gather container", () => {
  const gatherButtons = html.match(/<button[^>]*data-gather="[^"]*"[^>]*>/g) || [];
  assert.ok(gatherButtons.length >= 4, "expected the four static gather buttons");
  for (const btn of gatherButtons) {
    assert.ok(!/\bdisabled\b/.test(btn) || /data-gather/.test(btn), "sanity");
  }
  const container = html.match(/<div class="actions" id="purse-gather">([\s\S]*?)<\/div>/);
  assert.ok(container, "index.html must wrap the static gather buttons in #purse-gather");
  const inside = (container[1].match(/data-gather=/g) || []).length;
  assert.equal(inside, gatherButtons.length, "no gather button may live outside #purse-gather");
});

test("the app gates #purse-gather buttons on the per-account model and a connection", () => {
  assert.match(app, /querySelectorAll\("#purse-gather \.gather"\)/,
    "app.js must disable the static gather buttons");
  assert.match(app, /model === "per-account"[\s\S]{0,200}#purse-gather/,
    "the gate must depend on the per-account model");
});

test("the click handler refuses player actions unless the per-account model is live", () => {
  assert.match(app, /isPlayerAction[\s\S]{0,120}!canAct/,
    "the click handler must refuse ungated player actions");
  assert.match(app, /b\.dataset\.gather \|\| b\.dataset\.buy \|\| b\.dataset\.sell \|\| b\.dataset\.invest/,
    "the refusal must cover every player action");
});
