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
import { cardView } from "./model";
import CompanionView, { CaptureShown } from "./views";

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

test("while the answer is on its way nothing is stamped and the buttons say Sending", () => {
  const out = html("slip sending");
  expect(out).toContain("Sending…");
  expect(out).not.toContain("sl-stamp");
  expect(out).not.toContain("data-decision=");
  expect(out).not.toContain("APPROVED");
  expect(out).toMatch(/data-act="approve"[^>]*disabled/);
  expect(out).toMatch(/data-act="decline"[^>]*disabled/);
  // the card is still the card: the action and the parameters are on it
  expect(out).toContain("host.ledgerbox.chase");
  expect(out).toContain("INV-118");
  expect(out).toContain("Nothing runs until you sign");
});

test("a refused answer leaves the card with the buttons back on and one plain sentence under them", () => {
  const out = html("slip refused");
  expect(out).toContain("That answer was refused: this decision belongs to a different app");
  expect(out).toContain("Focus the app this decision is about and try again.");
  expect(out).not.toContain("sl-stamp");
  expect(out).not.toMatch(/data-act="approve"[^>]*disabled/);
  expect(out).toContain("<kbd>A</kbd>");
  // the refusal sits after the buttons
  expect(out.indexOf('data-act="decline"')).toBeLessThan(out.indexOf("data-refusal"));
  expect(html("slip")).not.toContain("data-refusal");
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
  expect(out).toContain("Engine: Claude Code, ready.");
  expect(out).toContain("She never asks for a key.");
  expect(out).toContain("Open your first app");
  expect(out).toContain("<kbd>Enter</kbd>");
  expect(out).toContain("Later");
  expect(out).toContain("ASKS FIRST");
});

test("welcome: no tick until the probe has answered, and nothing in it is jargon", () => {
  const looking = html("welcome looking");
  expect(looking).toContain("Looking for your engine…");
  expect(looking).not.toContain("Engine: Claude Code");
  expect(looking).not.toContain("check-engines");
  expect(looking).not.toMatch(/PATH|probe|daemon/);
});

test("welcome: a missing engine is an amber mark, the plain remedy and a button that looks again", () => {
  const out = html("welcome missing");
  expect(out).toContain('data-engine="missing"');
  expect(out).toContain("Claude Code is not on this computer yet.");
  expect(out).toContain("Install it, then press Check again.");
  expect(out).toContain('data-act="check-engines"');
  expect(out).toContain("Check again");
  expect(out).not.toContain('data-act="use-engine"');
  expect(out).not.toMatch(/PATH|probe|daemon/);
  expect(out).not.toContain("Engine: Claude Code, ready");
  // the button is a real button, so the keyboard reaches it
  expect(out).toMatch(/<button[^>]*data-act="check-engines"/);
});

test("welcome: when the other engine is ready it is offered, not assumed", () => {
  const out = html("welcome missing other");
  expect(out).toContain("Codex is ready on this computer");
  expect(out).toContain('data-act="use-engine"');
  expect(out).toContain("Use Codex");
});

test("after Later the empty Talk says Main is hidden and offers the way back", () => {
  const out = html("ledger later");
  expect(out).toContain("Main is hidden. Click here or use the tray to open it.");
  expect(out).toContain('data-act="open-main"');
  expect(html("ledger empty")).not.toContain("Main is hidden");
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
  expect(degraded).toContain("Athena is not running yet");
  // the sentence is the plain one; the code and the detail are in the expanded record
  expect(degraded).toContain("Athena could not start Claude Code on this computer. Check Setup.");
  expect(degraded).toContain("The turn stopped");
  expect(degraded).toContain("<details");
  expect(degraded).toContain("engine_error");
  const sentence = /<p>(Athena could not start[^<]*)<\/p>/.exec(degraded)?.[1] ?? "";
  expect(sentence).not.toMatch(/engine_error|FileNotFoundError|origin|manifest|session/);
});

test("Record has two labelled lists, each with its own (showing N of M), and the app, tool, class and clock on every row", () => {
  const out = html("ledger record");
  expect(out).toContain("This window");
  expect(out).toContain("Earlier (kept on this computer)");
  expect(out).not.toContain("This session");
  expect(out).toContain("host.ledgerbox.list_overdue");
  expect(out).toContain("approved");
  expect(out).toContain("refused");
  // the app (origin host) and the gate class on a decision row
  expect(out).toContain("ledgerbox");
  expect(out).toContain('class="chip chip-gated">GATED');
  // a clock on every row that carries a time
  expect(out).toMatch(/class="rec-c">\d{2}:\d{2}</);
  // every list says how much of itself it shows
  expect(out).toContain("(showing 4 of 4)");
  expect(out).toContain("(showing 2 of 5)");
  expect(out).toContain("(showing 2 of 14)");
  expect(out).toContain("engine_error");
});

test("the Record's header claims completeness only when every list is whole", () => {
  const cut = html("ledger record");
  expect(cut).not.toContain("Nothing is missing from this list");
  expect(cut).toContain('data-complete="0"');
  expect(cut).toMatch(/Some are not shown here \(showing \d+ of \d+\)/);
  const whole = html("ledger record whole");
  expect(whole).toContain("Nothing is missing from this list");
  expect(whole).toContain('data-complete="1"');
});

test("Origins lists what the page offers with the gate's class, and the apps she has seen", () => {
  const out = html("ledger origins");
  expect(out).toContain("This page offers");
  expect(out).toContain('class="chip chip-gated">GATED');
  expect(out).toContain("ledgerbox.local");
  expect(out).toContain("calendar.example");
  expect(out).toContain("Enable");
  // the generic hands are listed beside the page's tools, and said to be hands
  expect(out).toContain("page_read");
  expect(out).toContain("hand, tier 2");
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

test("a handed-over playbook shows her plan before the first turn: steps, tabs, stops", () => {
  const out = html("ledger playbook");
  expect(out).toContain("The plan for Amazon FBA reimbursements");
  expect(out).toContain('class="lg-plan__steps"');
  expect(out).toContain("Seller Central");
  expect(out).toContain("Open a reimbursement case");
  expect(out).toContain("Working on");
  // The generic suggestions give way to the plan.
  expect(out).not.toContain("aw-btn-sugg");
});

test("a card that carries a capture draws that capture, and a missing one says why", () => {
  const filed = cardView({ ...CARDS[0], capture_id: "cap_0123456789ab" });
  expect(filed.capture).toEqual({ kind: "shot", id: "cap_0123456789ab" });

  const shown = renderToStaticMarkup(
    createElement(CaptureShown, { id: "cap_0123456789ab", read: { src: "data:image/png;base64,AAAA", problem: null } }),
  );
  expect(shown).toContain('src="data:image/png;base64,AAAA"');
  expect(shown).toContain("page capture cap_0123456789ab");
  expect(shown).not.toContain("stylised");

  const gone = renderToStaticMarkup(
    createElement(CaptureShown, { id: "cap_0123456789ab", read: { src: null, problem: "the capture is no longer kept" } }),
  );
  expect(gone).toContain("the capture is no longer kept");
});

test("a card without a capture says no capture was taken, and why when it is known", () => {
  const model = fixtures.slip();
  const card = (why: string | null) => ({ ...model, cards: [{ ...model.cards[0], capture: { kind: "none" as const, why } }] });
  const render = (m: typeof model) => renderToStaticMarkup(createElement(CompanionView, { model: m }));

  expect(render(card(null))).toContain("No capture was taken for this request.");
  expect(render(card("the screenshot took longer than 8 seconds"))).toContain(
    "No capture was taken: the screenshot took longer than 8 seconds.",
  );
  expect(cardView(CARDS[0], "no shell").capture).toEqual({ kind: "none", why: "no shell" });
});

test("an empty list of apps she has seen says first sight asks, and does not say tools are off", () => {
  const model = fixtures["ledger origins"]();
  const out = renderToStaticMarkup(
    createElement(CompanionView, { model: { ...model, origins: { ...model.origins, known: [] } } }),
  );
  expect(out).toContain("waits for your answer");
  expect(out).not.toContain("tools are off");
});
