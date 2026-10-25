/**
 * The ledger while she works (fleet-surfaces, ADR 0141): the composer stays open, what the person
 * typed meanwhile waits in line on the rail with a way to take it back, a card a delegated task
 * filed says whose it is, and the task strip sits above the composer.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { TranscriptEntry } from "@/stores/run";

import { fixtures } from "./fixtures";
import { Ledger } from "./ledger";
import type { CompanionModel } from "./model";
import { buildContext } from "./translate";
import { describeDecision } from "./translate/decision";
import sessionsData from "./translate/sessions.fixture.json";

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

// A card shows what the turn already read about its target, on the rail's Gate and on a sheet row.
const chase = (sessionsData as { sessions: { id: string; entries: Omit<TranscriptEntry, "id">[] }[] }).sessions.find((s) => s.id === "chase-overdue")!;
const chaseTurn = buildContext(chase.entries.map((e, i) => ({ ...e, id: `c-${i}` })));
const wordsAbout = (id: string) =>
  describeDecision({ action: "host.ledgerbox.send_reminder", params: { id } }, chaseTurn, "", { reversible: false, side_effects: "external" });

test("standing case 6: the Gate and a sheet row each show the note; a card with no standing shows none", () => {
  const base = fixtures.ledger();
  const gate = { ...base, cards: base.cards.map((c) => ({ ...c, words: wordsAbout("inv_137") })) };
  const gateOut = html(gate);
  expect(gateOut).toMatch(/<[^>]*data-standing-note[^>]*role="note"|<[^>]*role="note"[^>]*data-standing-note/);
  expect(gateOut).toContain("Client says the second revision was out of scope.");

  const sheeted = fixtures["slip sheet"]();
  const sheet = sheeted.sheet!;
  const rowed = {
    ...sheeted,
    cards: sheeted.cards.map((c, i) => (i === 0 ? { ...c, words: wordsAbout("inv_137") } : c)),
    sheet: { ...sheet, rows: sheet.rows.map((r, i) => (i === 0 ? { ...r, words: wordsAbout("inv_137") } : r)) },
  };
  const rowOut = html(rowed);
  const row = rowOut.slice(rowOut.indexOf('class="sh-row"'), rowOut.indexOf("</li>"));
  expect(row).toContain("data-standing-note");
  expect(row).toContain("Client says the second revision was out of scope.");

  const none = { ...base, cards: base.cards.map((c) => ({ ...c, words: wordsAbout("inv_999") })) };
  expect(html(none)).not.toContain("data-standing-note");
});
