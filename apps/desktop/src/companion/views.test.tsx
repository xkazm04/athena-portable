/**
 * Every state and every fixture renders, as static markup — ADR 0026, README section 3.5.
 *
 * The view is a pure function of the model (no store, no shell), so `renderToStaticMarkup` is the
 * whole harness. The assertions are the ones a screenshot cannot make: what is on the paper, what
 * a screen reader is told, that a gate class is a word, that a waiting card shows every parameter.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { SIZES } from "@/lib/companion";

import { CARDS, fixtureIds, fixtures } from "./fixtures";
import { modelFor, readQuery } from "./preview";
import CompanionView from "./views";

const html = (id: string) => renderToStaticMarkup(createElement(CompanionView, { model: fixtures[id]() }));

test("every fixture renders without throwing, and carries the state it is named for", () => {
  for (const id of fixtureIds) {
    const out = html(id);
    const form = fixtures[id]().form;
    expect(out, id).toContain(`data-state="${form}"`);
    expect(SIZES[form], id).toBeDefined();
  }
});

test("the seal and the tab carry no paper; every other state does", () => {
  expect(html("seal")).not.toContain("aw-paper");
  expect(html("tab")).not.toContain("aw-paper");
  for (const form of ["tape", "hear", "slip", "welcome", "ledger"]) {
    expect(html(form)).toContain(`data-kind="${form}"`);
  }
});

test("the seal is one button with a label that says what is waiting", () => {
  expect(html("seal")).toContain("Athena. Resting. Nothing is waiting on you.");
  const waiting = html("seal waiting");
  expect(waiting).toContain("2 decisions waiting on you");
  expect(waiting).toContain('data-cards="2"');
  expect(waiting).toContain('data-tone="human"');
  expect(waiting).toContain(">2</span>");
  expect(html("tab waiting")).toContain("1 decision waiting on you");
});

test("the slip shows the action, the rationale, every parameter and both keys", () => {
  const out = html("slip");
  expect(out).toContain("host.ledgerbox.chase");
  expect(out).toContain(CARDS[0].rationale);
  expect(out).toContain("INV-118");
  expect(out).toContain("ap@northwind.example");
  expect(out).toContain('data-act="approve"');
  expect(out).toContain('data-act="decline"');
  expect(out).toContain("<kbd>A</kbd>");
  expect(out).toContain("1 waiting");
  expect(out).toContain("Nothing runs until you sign");
  // a gate class is a word in a box, never colour alone
  expect(out).toContain('class="chip chip-gated">GATED');
  // the page capture is labelled as a sketch wherever it is shown
  expect(out).toContain("page capture, stylised");
});

test("several cards: a count, a pip each, and the first one is the slip on show", () => {
  const out = html("slip many");
  expect(out).toContain("3 waiting");
  expect(out.match(/<i class="(cur)?"><\/i>/g)).toHaveLength(3);
});

test("a stamped slip carries the impression and its buttons are disabled, so it cannot be answered twice", () => {
  const approved = html("slip approved");
  expect(approved).toContain('data-decision="approved"');
  expect(approved).toContain("APPROVED");
  expect(approved).toContain("COUNTERSIGNED BY YOU");
  expect(approved).toMatch(/data-act="approve"[^>]*disabled/);
  expect(approved).toContain('data-decided="approve"');
  const declined = html("slip declined");
  expect(declined).toContain('data-decision="declined"');
  expect(declined).toContain("NOTHING WAS SENT");
  expect(html("slip tearing")).toContain('data-tear="1"');
  expect(html("slip")).not.toContain("sl-stamp");
});

test("the tape has the previous step dim and the current one live, each with its gate class", () => {
  const out = html("tape");
  expect(out).toContain("tp-line dim");
  expect(out).toContain("tp-line on in");
  expect(out).toContain('class="chip chip-auto">AUTO');
  expect(out).toContain("ledgerbox");
  expect(html("tape thinking")).toContain("thinking");
  const done = html("tape done");
  expect(done).toContain("done");
  expect(done).toContain("The record has every call");
});

test("the hear tape shows the words so far", () => {
  const out = html("hear");
  expect(out).toContain("listening · release to send");
  expect(out).toContain("Find every invoice over 30 days and draft a chase");
  expect(out).toContain('data-listening="1"');
});

test("welcome: the four tiers, the two promises, and the two buttons with their keys", () => {
  const out = html("welcome");
  expect(out).toContain("Athena is here.");
  expect(out).toContain("remembers");
  expect(out).toContain("reaches");
  expect(out).toContain("Engine: Claude Code.");
  expect(out).toContain("Open your first app");
  expect(out).toContain("<kbd>Enter</kbd>");
  expect(out).toContain("Later");
  expect(out).toContain("ASKS FIRST");
});

test("the ledger has three tabs, the waiting card inline in Talk, and a composer", () => {
  const talk = html("ledger");
  expect(talk).toContain('role="tablist"');
  expect(talk.match(/role="tab"/g)).toHaveLength(3);
  expect(talk).toContain('aria-selected="true"');
  expect(talk).toContain("slip slip-inline");
  expect(talk).toContain('aria-label="Message Athena"');
  expect(talk).toContain("Keep Athena on top of other windows");
  expect(talk).toContain("Put the ledger away");
});

test("the ledger says why the composer is off, and offers a question to ask otherwise", () => {
  const out = html("ledger empty");
  expect(out).toContain("Open a page first");
  expect(out).toContain("disabled");
  const degraded = html("ledger degraded");
  expect(degraded).toContain("daemon is not running yet");
  expect(degraded).toContain("engine_error");
  expect(degraded).toContain("The turn stopped");
});

test("Record lists this session's calls with their class and the daemon's, with (showing N of M)", () => {
  const out = html("ledger record");
  expect(out).toContain("This session");
  expect(out).toContain("host.ledgerbox.list_overdue");
  expect(out).toContain("approved");
  expect(out).toContain("(showing 2 of 14)");
  expect(out).toContain("engine_error");
});

test("Origins lists what the page offers with the gate's class, and the apps she has seen", () => {
  const out = html("ledger origins");
  expect(out).toContain("This page offers");
  expect(out).toContain('class="chip chip-gated">GATED');
  expect(out).toContain("ledgerbox.local");
  expect(out).toContain("calendar.example");
  expect(out).toContain("Enable");
});

test("the paper is keyed so it unrolls again, and orientation mirrors the drawing", () => {
  const left = html("slip");
  expect(left).toContain('data-side="left"');
  const flipped = renderToStaticMarkup(
    createElement(CompanionView, {
      model: modelFor(readQuery(new URLSearchParams("fixture=slip&side=right&valign=up"))),
    }),
  );
  expect(flipped).toContain('data-side="right"');
  expect(flipped).toContain('data-valign="up"');
});

test("the preview query falls back to the seal on anything it does not know", () => {
  expect(readQuery(new URLSearchParams("state=nonsense")).fixture).toBe("seal");
  expect(readQuery(new URLSearchParams("fixture=ledger+record")).fixture).toBe("ledger record");
  expect(readQuery(new URLSearchParams("scale=99")).scale).toBe(1);
  expect(readQuery(new URLSearchParams("scale=1.5")).scale).toBe(1.5);
  expect(modelFor(readQuery(new URLSearchParams("fixture=tab&dock=left"))).docked).toBe("left");
});
