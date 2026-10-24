/**
 * The ledger while she works (fleet-surfaces, ADR 0141): the composer stays open, what the person
 * typed meanwhile waits in line on the rail with a way to take it back, a card a delegated task
 * filed says whose it is, and the task strip sits above the composer.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { fixtures } from "./fixtures";
import { Ledger } from "./ledger";
import type { CompanionModel } from "./model";

function working(over: Partial<CompanionModel["talk"]> = {}): CompanionModel {
  const base = fixtures.ledger();
  return { ...base, talk: { ...base.talk, working: true, ...over } };
}

const html = (model: CompanionModel) => renderToStaticMarkup(createElement(Ledger, { model }));

test("while a turn runs the composer and its send button are open", () => {
  const out = html(working());
  expect(out).toMatch(/<textarea[^>]*aria-label="Message Athena"[^>]*>/);
  expect(out).not.toMatch(/<textarea[^>]*disabled/);
  expect(out).not.toMatch(/<button type="submit"[^>]*disabled/);
  expect(out).not.toContain("already running");
});

test("messages waiting in line show in order under her work, each with a way to take it back", () => {
  const out = html(working({ queued: [{ id: "q1", text: "and the paid ones?" }, { id: "q2", text: "then email Ana" }] }));
  const first = out.indexOf('data-queued="q1"');
  const second = out.indexOf('data-queued="q2"');
  expect(first).toBeGreaterThan(out.indexOf('data-act="stop"'));
  expect(second).toBeGreaterThan(first);
  expect(out).toContain("You, in line · sent when she finishes");
  expect(out).toContain('aria-label="Take back: and the paid ones?"');
  expect(out).toContain('aria-label="Take back: then email Ana"');
  expect(out.match(/data-act="unqueue"/g)).toHaveLength(2);
  expect(html(working())).not.toContain("data-queued");
});

test("a card a task filed says so above its title", () => {
  const base = fixtures.ledger();
  const model = { ...base, cards: base.cards.map((c) => ({ ...c, task: "Chase March invoices" })) };
  expect(html(model)).toContain("Waiting on you · for the task &quot;Chase March invoices&quot;");
  expect(html(base)).not.toContain("for the task");
});

test("the task strip is mounted above the composer, and draws nothing while no task is shown", () => {
  const out = html(working());
  // No tasks in the store: the strip renders nothing, and the foot still opens with the composer.
  expect(out).not.toContain("aw-tasks");
  expect(out).toMatch(/<div class="lg-foot"><form class="lg-compose"/);
});
