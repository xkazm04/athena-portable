/**
 * Every module renders every fixture (README §3.5: the automation seam the first build lacked).
 *
 * A view here is a pure function from a view-model to an element, which makes "does this module
 * render?" a question a test can answer for *all* of them at once — including the empty state and
 * the failing state, which are the ones a person driving the app by hand never reaches twice.
 *
 * The assertions past "it rendered" are the promises the panel makes to the user: a card shows the
 * parameters the approval was filed for, a tool row shows the class the catalog decided, and a
 * check that is not healthy shows what to do about it.
 */

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { JSDOM } from "jsdom";

import { REGISTRY } from "../dist/modules/index.js";
import { inertActions } from "../dist/lib/module.js";

before(() => {
  const dom = new JSDOM("<!doctype html><body></body>");
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
});

function render(module, fixture) {
  return module.view(module.fixtures[fixture], inertActions());
}

function find(root, role) {
  return root.querySelector(`[data-role="${role}"]`);
}

// --- the contact sheet ---------------------------------------------------------------------------

test("every module declares an id, a glyph and at least an empty fixture", () => {
  for (const module of REGISTRY) {
    assert.ok(module.id, "a module needs an id");
    assert.ok(module.glyph, `${module.id} needs a glyph for the bar`);
    assert.ok("empty" in module.fixtures, `${module.id} must declare an 'empty' fixture`);
  }
});

test("every fixture of every module renders an element", () => {
  for (const module of REGISTRY) {
    for (const name of Object.keys(module.fixtures)) {
      const element = render(module, name);
      assert.ok(element instanceof globalThis.HTMLElement, `${module.id}/${name} rendered nothing`);
      assert.equal(element.dataset.module, module.id);
    }
  }
});

test("no module ids collide", () => {
  const ids = REGISTRY.map((module) => module.id);
  assert.equal(new Set(ids).size, ids.length);
});

// --- the decision card ---------------------------------------------------------------------------

const chat = () => REGISTRY.find((module) => module.id === "chat");

test("a card names its action and prints the parameters it was filed for", () => {
  // Approving "send a chase" without seeing which invoice is not consent to anything.
  const element = render(chat(), "a card is waiting");
  const card = find(element, "card");

  assert.equal(find(card, "action").textContent, "host.ledgerbox.chase");
  const params = find(card, "params").textContent;
  assert.match(params, /invoice/);
  assert.match(params, /INV-118/);
});

test("a card offers exactly the answers the daemon put on it", () => {
  const card = find(render(chat(), "a card is waiting"), "card");
  const choices = [...card.querySelectorAll('[data-role="answer"]')].map((b) => b.dataset.choice);

  assert.deepEqual(choices, ["approve", "decline"]);
});

test("two waiting cards both render, above the transcript", () => {
  const element = render(chat(), "two cards, one of them a write to memory");
  const cards = element.querySelectorAll('[data-role="card"]');
  const list = find(element, "cards");
  const transcript = find(element, "transcript");

  assert.equal(cards.length, 2);
  // A card that scrolled away with the conversation is a card answered late or not at all.
  assert.equal(list.compareDocumentPosition(transcript) & 4, 4, "cards must precede the transcript");
});

// --- the tool list -------------------------------------------------------------------------------

test("a tool row shows the class the catalog decided, not one the panel derived", () => {
  const element = render(chat(), "act 1: tools on first sight");
  const rows = [...element.querySelectorAll('[data-role="tool"]')];
  const byName = Object.fromEntries(
    rows.map((row) => [row.dataset.name, row.querySelector(".tool-class").textContent]),
  );

  assert.equal(byName["host.ledgerbox.chase"], "GATED");
  assert.equal(byName["host.ledgerbox.list_overdue"], "AUTO");
  assert.equal(byName["core.recall"], "READ");
});

test("a turn's cost is shown once it has one", () => {
  const summary = find(render(chat(), "finished, with its cost"), "summary").textContent;

  assert.match(summary, /claude-opus-5/);
  assert.match(summary, /2 rounds/);
  assert.match(summary, /\$0\.0312/);
});

test("the composer is disabled until the daemon says it is ready", () => {
  const notReady = find(render(chat(), "not ready yet"), "composer");
  const ready = find(render(chat(), "act 1: tools on first sight"), "composer");

  assert.ok(notReady.disabled);
  assert.ok(!ready.disabled);
});

// --- the browser ---------------------------------------------------------------------------------

const browser = () => REGISTRY.find((module) => module.id === "browser");

test("a page that has not answered and a page that registered nothing read differently", () => {
  // The distinction is what the generic hands exist to cover; rendering them the same hides it.
  const element = render(browser(), "two tabs, one silent");
  const rows = [...element.querySelectorAll('[data-role="tab"]')];
  const text = rows.map((row) => row.textContent);

  assert.ok(text.some((line) => line.includes("4 tools")));
  assert.ok(text.some((line) => line.includes("no tools yet")));
});

test("the empty browser says what to do rather than showing a blank column", () => {
  assert.match(find(render(browser(), "empty"), "empty").textContent, /open one/i);
});

// --- setup ---------------------------------------------------------------------------------------

const setup = () => REGISTRY.find((module) => module.id === "setup");

test("a broken check names its remediation and an unknown one does not claim to be broken", () => {
  const broken = render(setup(), "no engine on this machine");
  const unknown = render(setup(), "not probed yet");

  const engine = [...broken.querySelectorAll('[data-role="check"]')].find(
    (row) => row.dataset.name === "engine",
  );
  assert.equal(engine.dataset.state, "broken");
  assert.match(find(engine, "remediation").textContent, /install the Claude or Codex CLI/);

  const pending = [...unknown.querySelectorAll('[data-role="check"]')].find(
    (row) => row.dataset.name === "engine",
  );
  assert.equal(pending.dataset.state, "unknown");
});

test("setup says no key is stored, which is act 1's whole claim", () => {
  assert.match(render(setup(), "first launch, everything found").textContent, /No API key is stored/);
});
