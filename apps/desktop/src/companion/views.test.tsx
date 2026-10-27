/**
 * Every state and every fixture renders, as static markup — ADR 0026, README section 3.5.
 *
 * The view is a pure function of the model (no store, no shell), so `renderToStaticMarkup` is the
 * whole harness. The assertions are the ones a screenshot cannot make: what a person reads (plain
 * words, never a tool's JSON), what a screen reader is told, that a waiting card carries every
 * parameter, and that nothing runs until the person signs.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { ToolRow } from "@/lib/api";
import { SIZES } from "@/lib/companion";

import { CARDS, TOOLS, fixtureIds, fixtures } from "./fixtures";
import { modelFor, readQuery } from "./preview";
import { cardView } from "./model";
import { CaptureShown } from "./slip";
import CompanionView from "./views";

const html = (id: string) => renderToStaticMarkup(createElement(CompanionView, { model: fixtures[id]() }));

test("every fixture renders without throwing, and carries the state it is named for", () => {
  for (const id of fixtureIds) {
    const out = html(id);
    const form = fixtures[id]().form;
    expect(out, id).toContain(`data-form="${form}"`);
    expect(SIZES[form], id).toBeDefined();
  }
});

test("no fixture shows a person a tool's raw JSON, a proposal line or a tool's arrow", () => {
  for (const id of fixtureIds) {
    // The technical record is the one place raw text may live, and it is closed until asked.
    const shown = html(id).replace(/<pre class="d-raw">[\s\S]*?<\/pre>/g, "");
    expect(shown, id).not.toMatch(/\{&quot;|OP: |TTS: |→/);
  }
});

test("the seal is the anchor in every form but the docked tab, where it is the tab itself", () => {
  for (const form of ["seal", "tape", "hear", "face", "slip", "welcome", "ledger"]) {
    const out = html(form);
    expect(out, form).toContain('class="anchor"');
    expect(out, form).toContain('class="seal"');
  }
  expect(html("tab")).not.toContain('class="anchor"');
  expect(html("tab")).toContain('class="seal-tab"');
});

test("the face form draws her chosen face with what she heard or is doing under it; no other fixture draws a face", () => {
  const hearing = html("face");
  expect(hearing).toContain('data-avatar="b04-owl"');
  expect(hearing).toContain("Listening");
  expect(hearing).toContain("Find every invoice over 30 days and draft a chase");
  const speaking = html("face speaking");
  expect(speaking).toContain('data-avatar="d08-origami"');
  expect(speaking).toContain("Speaking");
  expect(speaking).toContain('data-seal="speaking"');
  for (const id of fixtureIds.filter((f) => !f.startsWith("face"))) expect(html(id), id).not.toContain("data-avatar");
});

test("the seal is one button with a label that says what is waiting, and a count only while something waits", () => {
  expect(html("seal")).toContain("Athena. Resting. Nothing is waiting on you.");
  expect(html("seal")).toContain('data-seal="rest"');
  const waiting = html("seal waiting");
  expect(waiting).toContain("2 decisions waiting on you");
  expect(waiting).toContain('data-seal="waiting" data-counted="1"');
  expect(waiting).toContain('<span class="seal-count" aria-hidden="true">2</span>');
  expect(html("tab waiting")).toContain("1 decision waiting on you");
  expect(html("tab waiting")).toContain('data-counted="1"');
  expect(html("seal quiet")).toContain('data-seal="quiet"');
  expect(html("tape thinking")).toContain('data-seal="working"');
});

test("the slip says what happens to whom in plain words, carries every parameter, and both keys", () => {
  const out = html("slip");
  expect(out).toContain("Send a reminder for INV-118");
  expect(out).toContain("Once it is sent it cannot be taken back.");
  expect(out).toContain(CARDS[0].rationale);
  // every parameter, uncut, on the back of the card ("Read it first")
  expect(out).toContain("inv_118");
  expect(out).toContain("ap@northwind.example");
  expect(out).toContain('data-act="read"');
  expect(out).toContain('data-act="approve"');
  expect(out).toContain('data-act="decline"');
  expect(out).toContain("<kbd>A</kbd>");
  expect(out).toContain("<kbd>D</kbd>");
  expect(out).toContain("Waiting on you");
  expect(out).toContain("Nothing runs until you sign");
  // the page capture is labelled as a sketch wherever it is shown
  expect(out).toContain("page capture, stylised");
});

test("several cards: a count, a stack behind the first, and the first one is the slip on show", () => {
  const out = html("slip many");
  expect(out).toContain("Waiting on you · 3 decisions");
  expect(out).toContain('data-stack="many"');
  expect(html("slip")).toContain('data-stack="1"');
});

test("while the answer is on its way nothing is stamped and the buttons say so", () => {
  const out = html("slip sending");
  expect(out).toMatch(/Signing…|Declining…/);
  expect(out).not.toContain("data-decision=");
  expect(out).toMatch(/data-act="approve"[^>]*disabled/);
  expect(out).toMatch(/data-act="decline"[^>]*disabled/);
  // the card is still the card: what it does and its parameters are on it
  expect(out).toContain("Send a reminder for INV-118");
  expect(out).toContain("inv_118");
  expect(out).toContain("Nothing runs until you sign");
});

test("a refused answer leaves the card with the buttons back on and one plain sentence on it", () => {
  const out = html("slip refused");
  expect(out).toContain("That answer was refused: this decision belongs to a different app");
  expect(out).toContain("Focus the app this decision is about and try again.");
  expect(out).not.toContain("data-decision=");
  expect(out).not.toMatch(/data-act="approve"[^>]*disabled/);
  expect(out).toContain("<kbd>A</kbd>");
  expect(out).toContain('role="alert"');
  expect(html("slip")).not.toContain("data-refusal");
});

test("a signed slip says so and its buttons are disabled, so it cannot be answered twice", () => {
  const approved = html("slip approved");
  expect(approved).toContain('data-decision="approved"');
  expect(approved).toContain("Signed.");
  expect(approved).toMatch(/data-act="approve"[^>]*disabled/);
  expect(approved).toContain('data-decided="stamped"');
  expect(approved).toContain('data-seal="signed"');
  const declined = html("slip declined");
  expect(declined).toContain('data-decision="declined"');
  expect(declined).toContain("Declined.");
  expect(declined).toContain("Nothing was changed.");
  expect(declined).toContain('data-seal="declined"');
  expect(html("slip tearing")).toContain('data-decided="tearing"');
  expect(html("slip")).not.toContain("data-decision=");
});

test("the tape says what she is doing in plain words, which step it is, and what came of it", () => {
  const out = html("tape");
  expect(out).toContain("Done · step 2");
  expect(out).toContain('data-beat="ok"');
  expect(out).toContain("Draft saved on INV-118 in Ledgerbox");
  expect(out).toContain('class="thread"');
  expect(out).not.toContain("draft_reminder");
  expect(html("tape thinking")).toContain("Thinking");
  const done = html("tape done");
  expect(done).toContain(">Done<");
  expect(done).toContain("tape-swap");
  expect(done).not.toContain('class="thread"');
});

test("the hear tape shows the words so far", () => {
  const out = html("hear");
  expect(out).toContain("Listening · release to send");
  expect(out).toContain("Find every invoice over 30 days and draft a chase");
  expect(out).toContain('data-seal="hearing"');
});

test("welcome: who she is, the three promises, the engine, and the two buttons with their keys", () => {
  const out = html("welcome");
  expect(out).toContain("Athena is here.");
  expect(out).toContain("She reads the page you are on.");
  expect(out).toContain("She asks first.");
  expect(out).toContain("It all runs on this machine.");
  expect(out).toContain("Engine: Claude Code, ready.");
  expect(out).toContain("She never asks for a key.");
  expect(out).toContain("Open your first app");
  expect(out).toContain("<kbd>Enter</kbd>");
  expect(out).toContain("Later");
  expect(out).toContain('data-seal="welcome"');
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

test("the ledger is one conversation with the waiting card at its foot, the Record and the apps a press away, and a composer", () => {
  const talk = html("ledger");
  expect(talk).toContain('class="rail"');
  expect(talk).toContain('class="gate decision"');
  expect(talk).toContain('aria-label="Message Athena"');
  expect(talk).toContain('data-act="record"');
  expect(talk).toContain('data-act="origins"');
  expect(talk).toContain("Keep Athena on top of other windows");
  expect(talk).toContain("Fold back into the seal");
  // every step opens one level down
  expect(talk).toContain('class="step"');
  expect(talk).toContain("Read 4 overdue invoices in Ledgerbox");
  // a level below that is not open is inert
  expect(talk).toMatch(/class="aw-depth"[^>]*inert/);
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
  const sentence = /<div class="txt">(Athena could not start[^<]*)<\/div>/.exec(degraded)?.[1] ?? "";
  expect(sentence).not.toMatch(/engine_error|FileNotFoundError|origin|manifest|session/);
});

test("Record has two labelled lists, each with its own (showing N of M), and the app, tool, class and clock on every row", () => {
  const out = html("ledger record");
  expect(out).toContain("This window");
  expect(out).toContain("Earlier (kept on this computer)");
  expect(out).not.toContain("This session");
  // what happened in plain words, the tool's name beside it for the technical eye
  expect(out).toContain("Read 4 overdue invoices in Ledgerbox");
  expect(out).toContain("host.ledgerbox.read_inbox");
  expect(out).toContain("approved");
  expect(out).toContain("refused");
  expect(out).toContain("ledgerbox");
  expect(out).toContain('class="rec-cls">GATED');
  expect(out).toMatch(/<span>\d{2}:\d{2}<\/span>/);
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
  expect(out).toContain('class="tag cls-gated">GATED');
  expect(out).toContain("ledgerbox.local");
  expect(out).toContain("calendar.example");
  expect(out).toContain("Enable");
  // the generic hands are listed beside the page's tools, and said to be hands
  expect(out).toContain("page_read");
  expect(out).toContain("hand, tier 2");
});

test("orientation is the model's: Rust seats the seal, the drawing follows", () => {
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
  expect(out).not.toContain('class="chip"');
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

test("a card names the app, whose tool it is and what its ref points at (ADR 0099)", () => {
  const ref = "ref_0_3fa9c1d2e4b5";
  const hand = {
    ...CARDS[0],
    action: "host.web_https_sledger_dtest.page_click",
    origin: "host:web_https_sledger_dtest",
    params: { ref },
  };
  const rows: ToolRow[] = [
    { name: "host.web_https_sledger_dtest.page_click", origin: "host:web_https_sledger_dtest", class: "GATED", tier: 2, description: "" },
  ];
  const described = cardView(hand, null, {
    tools: rows,
    targets: { ok: true, targets: { [ref]: { role: "button", label: "Send reminder" } } },
  });
  expect(described.app).toBe("ledger.test");
  expect(described.tier).toBe(2);
  expect(described.where).toBe("In ledger.test - Athena's generic hand, not the app's own tool");
  expect(described.params).toEqual([{ key: "ref", value: `button - Send reminder (${ref})` }]);
  expect(described.claimed).toBe(true);
  expect(described.targetNote).toBeNull();

  const model = fixtures.slip();
  const out = renderToStaticMarkup(createElement(CompanionView, { model: { ...model, cards: [{ ...model.cards[0], ...described }] } }));
  expect(out).toContain("In ledger.test - Athena&#x27;s generic hand, not the app&#x27;s own tool");
  expect(out).toContain(`button - Send reminder (${ref})`);
  expect(out).toContain("the page&#x27;s own labels");

  // A page's own tool says so, and the tier comes from the catalog's row.
  const own = cardView(CARDS[0], null, { tools: TOOLS });
  expect(own.tier).toBe(1);
  expect(own.where).toBe("In ledgerbox - the app's own tool");

  // The page could not be asked, or no longer holds the ref: the raw ref stays and the card says so.
  const failed = cardView(hand, null, { tools: rows, targets: { ok: false, why: "timeout" } });
  expect(failed.params).toEqual([{ key: "ref", value: ref }]);
  expect(failed.targetNote).toBe("The target could not be described: timeout.");
  expect(failed.claimed).toBe(false);
  const dead = cardView(hand, null, { tools: rows, targets: { ok: true, targets: {} } });
  expect(dead.params).toEqual([{ key: "ref", value: ref }]);
  expect(dead.targetNote).toContain(`the page no longer holds ${ref}`);
  // Not asked yet: raw, and nothing claimed either way.
  expect(cardView(hand, null, { tools: rows }).targetNote).toBeNull();
});

test("an empty list of apps she has seen says first sight asks, and does not say tools are off", () => {
  const model = fixtures["ledger origins"]();
  const out = renderToStaticMarkup(
    createElement(CompanionView, { model: { ...model, origins: { ...model.origins, known: [] } } }),
  );
  expect(out).toContain("waits for your answer");
  expect(out).not.toContain("tools are off");
});

test("Origins: a page that could not be read says so above her hands, and never as nothing read yet", () => {
  const model = fixtures["ledger origins"]();
  const draw = (origins: Partial<typeof model.origins>) =>
    renderToStaticMarkup(createElement(CompanionView, { model: { ...model, origins: { ...model.origins, ...origins } } }));
  const failed = draw({ pageProblem: "bridge_error: the webview went away" });
  expect(failed).toContain("This page could not be read: bridge_error: the webview went away");
  expect(failed).toContain("Only her own hands are listed.");
  const failedBare = draw({ pageProblem: "bridge_error: the webview went away", offers: [] });
  expect(failedBare).not.toContain("Nothing has been read from this page yet.");
  const silent = draw({ pageSilent: true, offers: [] });
  expect(silent).toContain("This page publishes no tools of its own.");
  expect(silent).not.toContain("could not be read");
});

test("welcome: a failed start shows the reason and a Try again button that restarts, not only Check again", () => {
  const model = fixtures["welcome"]();
  model.welcome.engineView = {
    state: "missing",
    text: "Athena could not start on Claude Code.",
    sub: "spawn exited with code 1",
    offer: { id: "codex", label: "Codex" },
    reason: "spawn exited with code 1",
    retry: { id: "claude_code", label: "Try again" },
    checking: false,
  };
  const out = renderToStaticMarkup(createElement(CompanionView, { model }));
  expect(out).toContain("Athena could not start on Claude Code.");
  expect(out).toContain("spawn exited with code 1");
  expect(out).toMatch(/<button[^>]*data-act="retry-engine"[^>]*>Try again</);
  expect(out).toContain("Use Codex");
  expect(out).not.toContain("Check again in a moment");
});

test("the engine line's live region announces the state, not the buttons beside it", () => {
  const model = fixtures["welcome"]();
  model.welcome.engineView = {
    state: "missing",
    text: "Athena could not start on Claude Code.",
    sub: "spawn exited with code 1",
    offer: { id: "codex", label: "Codex" },
    reason: "spawn exited with code 1",
    retry: { id: "claude_code", label: "Try again" },
    checking: false,
  };
  const out = renderToStaticMarkup(createElement(CompanionView, { model }));
  const status = /<span role="status">(.*?)<\/span>/s.exec(out);
  expect(status?.[1]).toContain("Athena could not start on Claude Code.");
  expect(status?.[1]).not.toContain("<button");
  expect(out).toContain('data-act="retry-engine"');
  expect(out).toContain('data-act="use-engine"');
});

test("each scrollable tab the keyboard can focus is a named region, as Talk's log is", () => {
  expect(html("ledger")).toContain('role="log" aria-label="Conversation"');
  // In the words on screen, and once: the section is not a second landmark of the same name.
  const record = html("ledger record");
  expect(record).toContain('role="region" aria-label="The record"');
  expect(record.match(/(?:role="region"|<section)[^>]*aria-label="The record"/g)).toHaveLength(1);
  expect(record).not.toContain('aria-label="Record"');
  const origins = html("ledger origins");
  expect(origins).toContain('role="region" aria-label="The apps she may act on"');
  expect(origins.match(/(?:role="region"|<section)[^>]*aria-label="The apps she may act on"/g)).toHaveLength(1);
  expect(origins).not.toContain('aria-label="Origins"');
});

test("each Enable or Disable button names its app and says its state once, in its name, not also as pressed", () => {
  const out = html("ledger origins");
  expect(out).toMatch(/aria-label="(Enable|Disable) calendar\.example"/);
  expect(out).toMatch(/aria-label="(Enable|Disable) ledgerbox\.local"/);
  expect(out).not.toMatch(/<button[^>]*aria-label="(Enable|Disable)[^"]*"[^>]*aria-pressed/);
});

test("the Speak button's accessible name contains its visible word, and says what holding it does", () => {
  const out = html("slip");
  expect(out).toContain('aria-label="Speak: hold and say approve or decline"');
  expect(out).toContain("<span>Speak</span>");
  expect(out).not.toContain('aria-label="Hold and say');
});

test("a card names the tab it was proposed on beside its app line, and offers the way back (ADR 0103)", () => {
  const tabs = [
    { id: 4, label: "page-4", url: "https://ledger.test/invoices", title: "Invoices", focused: false, nav: 3 },
    { id: 7, label: "page-7", url: "https://ledger.test/clients", title: "Clients", focused: true, nav: 1 },
  ];
  const bound = cardView({ ...CARDS[0], tab_id: 4, tab_nav: 3 }, null, { tools: TOOLS, tabs });
  expect(bound.bound).toEqual({ tabId: 4, label: "tab 1 of ledger.test - Invoices", open: true, focused: false, moved: false });

  const model = fixtures.slip();
  const out = renderToStaticMarkup(createElement(CompanionView, { model: { ...model, cards: [{ ...model.cards[0], ...bound }] } }));
  expect(out).toContain('data-bound-tab="4"');
  expect(out).toContain("Proposed on tab 1 of ledger.test - Invoices");
  expect(out).toContain('data-act="go-to-tab"');

  // One tab of the app is named by its title; the focused tab offers nothing; a reload says so.
  const alone = cardView({ ...CARDS[0], tab_id: 7, tab_nav: 2 }, null, { tabs: [tabs[1]] });
  expect(alone.bound).toEqual({ tabId: 7, label: "Clients", open: true, focused: true, moved: true });
  const moved = renderToStaticMarkup(createElement(CompanionView, { model: { ...model, cards: [{ ...model.cards[0], ...alone }] } }));
  expect(moved).toContain("Proposed on Clients (it has reloaded since)");
  expect(moved).not.toContain('data-act="go-to-tab"');

  // A closed tab is named as closed; an unbound card (old, connector, core) shows no tab line.
  expect(cardView({ ...CARDS[0], tab_id: 9 }, null, { tabs }).bound).toMatchObject({ open: false, label: "a tab that is closed now" });
  expect(cardView(CARDS[0], null, { tabs }).bound).toBeNull();
  expect(html("slip")).not.toContain("data-bound-tab");
});

// -- a turn's cards as one sheet (ADR 0104) --------------------------------------------------------

test("one turn's cards on one app are one sheet: every row whole, in order, each with its tick", () => {
  const out = html("slip sheet");
  expect(out).toContain('data-rows="3"');
  expect(out).toContain("3 requests in ledgerbox");
  for (const invoice of ["INV-200", "INV-201", "INV-202"]) expect(out).toContain(invoice);
  expect(out.indexOf("INV-200")).toBeLessThan(out.indexOf("INV-201"));
  expect(out.indexOf("INV-201")).toBeLessThan(out.indexOf("INV-202"));
  expect(out.match(/type="checkbox"/g)).toHaveLength(3);
  expect(out).toContain('data-card="apr_00000000r002" data-ticked="0"');
  // The press says how many rows it runs, and the other button declines them all.
  expect(out).toContain("Approve 2 of 3");
  expect(out).toContain("Decline all");
  expect(out).toContain("the app&#x27;s own tool");
  expect(out).not.toContain("(showing");
});

test("a sheet of thirteen shows twelve rows and says it cut one", () => {
  const out = html("slip sheet long");
  expect(out).toContain('data-rows="12"');
  expect(out).toContain("(showing 12 of 13)");
  expect(out).toContain("Approve 12 of 12");
  expect(out).not.toContain("INV-212");
});

test("a press that stopped early says what ran and why, on the rows still waiting", () => {
  const out = html("slip sheet stopped");
  expect(out).toContain("data-ran");
  expect(out).toContain("ran 3 of 5; stopped at row 4");
  expect(out).toContain("Approve 2 of 2");
});

test("one turn's cards in two apps are one checklist, labelled by app and tab in run order (ADR 0106)", () => {
  const out = html("slip sheet tabs");
  expect(out).toContain('data-rows="3"');
  expect(out).toContain("3 requests in ledgerbox and tidycrm");
  const groups = [...out.matchAll(/data-group="true">([^<]*)</g)].map((m) => m[1]);
  expect(groups).toEqual(["ledgerbox - Invoices", "tidycrm - Contacts"]);
  expect(out.indexOf("Send a reminder")).toBeLessThan(out.indexOf("Add a note"));
  expect(out).toContain("Approve 3 of 3");
});

test("a sheet all on one app and tab carries no group labels", () => {
  expect(html("slip sheet")).not.toContain("data-group");
});

test("a single card is still the card it always was", () => {
  const out = html("slip");
  expect(out).not.toContain("data-sheet");
  expect(out).not.toContain("Decline all");
});

test("Stop is offered wherever she is shown working, and nowhere else (ADR 0115)", () => {
  expect(html("tape")).toContain('data-act="stop"');
  expect(html("tape thinking")).toContain('data-act="stop"');
  expect(html("tape done")).not.toContain('data-act="stop"');
  expect(html("ledger")).not.toContain('data-act="stop"');
  expect(html("slip")).not.toContain('data-act="stop"');
  const ledger = fixtures.ledger();
  const working = renderToStaticMarkup(
    createElement(CompanionView, { model: { ...ledger, talk: { ...ledger.talk, working: true } } }),
  );
  expect(working).toContain('data-act="stop"');
  // A word a screen reader can act on, not an icon alone.
  expect(working).toMatch(/<button[^>]*data-act="stop"[^>]*>Stop<\/button>/);
  expect(html("tape")).toMatch(/<button[^>]*data-act="stop"[^>]*aria-label="Stop her working"/);
});

test("case 4: a connector card says who it acts as under its where line, in Gmail's name (ADR 0116)", () => {
  const out = html("slip connector");
  expect(out).toContain("In Gmail - a connector, not a page");
  expect(out).not.toContain("connector:gmail");
  expect(out).toContain("Acts as mira@example.com through Gmail.");
  expect(out).toContain("data-connector");
  expect(out).not.toContain("data-connector-warning");
});

test("guard 7: a connector line that warns never disables Approve or Decline; it offers the way to Main", () => {
  const out = html("slip connector reauth");
  expect(out).toContain("Gmail needs reconnecting, so approving now will be refused.");
  expect(out).toContain("data-connector-warning");
  expect(out).toContain('data-act="open-main"');
  expect(out).toMatch(/data-act="approve"/);
  expect(out).not.toMatch(/data-act="approve"[^>]*disabled/);
  expect(out).not.toMatch(/data-act="decline"[^>]*disabled/);
  // A page's card carries no connector line at all.
  expect(html("slip")).not.toContain("data-connector");
});
