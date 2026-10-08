/**
 * The companion's selector: what it derives from the stores, held still — ADR 0026, README 3.1.
 *
 * The first four tests moved here from the Panel module's `model.test.ts` with their subject
 * (`groupMessages`, `suggestionsFor`, the block reason, the voice pass-through); the view is a
 * pure function of the model, so everything the model *computes* is asserted here and nowhere else.
 */
import { expect, test } from "vitest";

import type { ToolRow } from "@/lib/api";
import type { TranscriptEntry } from "@/stores/run";

import { CARDS, TOOLS, fixtures, machineAfter } from "./fixtures";
import {
  DEFAULT_SUGGESTION,
  NO_ACTIONS,
  OFFERS_SHOWN,
  blockedBecause,
  groupMessages,
  hostOf,
  ledgerFrom,
  moodOf,
  selectCompanion,
  stepOf,
  suggestionsFor,
  type CompanionInputs,
} from "./model";

function tool(name: string, cls: ToolRow["class"], description = "", origin = "host:ledgerbox") {
  return { name, origin, class: cls, tier: 1, description };
}

function inputs(over: Partial<CompanionInputs> = {}): CompanionInputs {
  return {
    machine: machineAfter({ t: "init", onboarded: true, cards: 0 }),
    run: { phase: "idle", transcript: [], cards: [], summary: null, error: null },
    voice: { phase: "off", available: false, partial: "" },
    daemonReady: true,
    origin: "https://a.test",
    tools: [],
    held: null,
    known: [],
    ledger: null,
    decisions: [],
    engine: "Claude Code",
    actions: NO_ACTIONS,
    ...over,
  };
}

test("consecutive deltas are one message and consecutive tools are one stretch of activity", () => {
  const blocks = groupMessages([
    { id: "u1", kind: "user", text: "Which are overdue?" },
    { id: "a1", kind: "assistant", text: "Let me read the list." },
    { id: "t1", kind: "tool", text: "host.x.list → 3 rows", tier: 1, ok: true },
    { id: "t2", kind: "tool", text: "host.x.read → ok", tier: 1, ok: true },
    { id: "a2", kind: "assistant", text: "Three are late." },
    { id: "a3", kind: "assistant", text: "The oldest is INV-118." },
  ]);
  expect(blocks.map((b) => b.kind)).toEqual(["user", "assistant", "activity", "assistant"]);
  expect(blocks[2].kind === "activity" && blocks[2].steps.length).toBe(2);
  expect(blocks[3].kind === "assistant" && blocks[3].text).toBe("Three are late.\n\nThe oldest is INV-118.");
});

test("suggestions come from the page's own words, never from a gated tool, three at most", () => {
  const lines = suggestionsFor([
    tool("host.ledgerbox.list_overdue", "AUTO", "Invoices past their due date."),
    tool("host.ledgerbox.chase", "GATED", "Send a chase for one invoice."),
    tool("host.ledgerbox.read_client", "READ", ""),
    tool("host.ledgerbox.totals", "READ", "totals by month"),
    tool("host.ledgerbox.aging", "READ", "The aging report"),
    tool("core.recall", "READ", "Search memory", "core"),
  ]);
  expect(lines).toEqual(["Invoices past their due date", "Read client", "Totals by month"]);
});

test("a page with nothing to suggest still gets one question", () => {
  expect(suggestionsFor([])).toEqual([DEFAULT_SUGGESTION]);
  expect(suggestionsFor([tool("host.x.pay", "GATED", "Pay.")])).toEqual([DEFAULT_SUGGESTION]);
});

test("the host is the origin's host, and the block reason is one sentence at a time", () => {
  const ready = selectCompanion(inputs({ origin: "https://ledgerbox.local:3004" }));
  expect(ready.talk.host).toBe("ledgerbox.local:3004");
  expect(ready.talk.ready).toBe(true);
  expect(ready.talk.blocked).toBe("");

  expect(selectCompanion(inputs({ origin: null })).talk.blocked).toMatch(/Open a page first/);
  expect(selectCompanion(inputs({ daemonReady: false })).talk.blocked).toMatch(/not running yet/);
  expect(blockedBecause(true, "https://a.test", true)).toMatch(/already running/);
  expect(hostOf(null)).toBeNull();
});

test("voice is carried through: the partial is what the hear tape shows, and the mic follows the daemon", () => {
  const off = selectCompanion(inputs());
  expect(off.micAvailable).toBe(false);
  const held = selectCompanion(
    inputs({ voice: { phase: "listening", available: true, partial: "what is" } }),
  );
  expect(held.heard).toBe("what is");
  expect(held.micAvailable).toBe(true);
});

test("a waiting card is drawn with every parameter, none cut", () => {
  const m = selectCompanion(
    inputs({
      machine: machineAfter({ t: "init", onboarded: true, cards: 0 }, { t: "cards", n: 1 }),
      run: {
        phase: "idle",
        transcript: [],
        cards: [{ ...CARDS[0], params: { to: "x@y.test", body: "a".repeat(500), n: 3, nested: { a: [1, 2] } } }],
        summary: null,
        error: null,
      },
    }),
  );
  const params = Object.fromEntries(m.cards[0].params.map((p) => [p.key, p.value]));
  expect(params.body).toHaveLength(500);
  expect(params.n).toBe("3");
  expect(params.nested).toBe('{"a":[1,2]}');
});

test("while the stamp lands the answered card is still the first waiting one, then it is gone", () => {
  const events = [
    { t: "init", onboarded: true, cards: 0 },
    { t: "cards", n: 2 },
    { t: "decide", kind: "approve", by: "click" },
    { t: "cards", n: 1 },
  ] as const;
  const stamping = selectCompanion(
    inputs({
      machine: machineAfter(...events),
      run: { phase: "idle", transcript: [], cards: [CARDS[1]], summary: null, error: null },
      held: CARDS[0],
    }),
  );
  expect(stamping.cards.map((c) => c.id)).toEqual([CARDS[0].id, CARDS[1].id]);
  expect(stamping.decision).toMatchObject({ kind: "approve", tearing: false });
  expect(stamping.tone).toBe("human");

  const settled = selectCompanion(
    inputs({
      machine: machineAfter(...events, { t: "settle" }),
      run: { phase: "idle", transcript: [], cards: [CARDS[1]], summary: null, error: null },
      held: null,
    }),
  );
  expect(settled.cards.map((c) => c.id)).toEqual([CARDS[1].id]);
  expect(settled.decision).toBeNull();
});

test("the seal says what it carries by its mood: a count and a pink ripple for a card, sleep at rest", () => {
  const snoozed = selectCompanion(
    inputs({
      machine: machineAfter({ t: "init", onboarded: true, cards: 0 }, { t: "cards", n: 2 }, { t: "esc" }),
      run: { phase: "idle", transcript: [], cards: [CARDS[0], CARDS[1]], summary: null, error: null },
    }),
  );
  expect(snoozed.form).toBe("seal");
  expect(snoozed.mood).toBe("wait");
  expect(snoozed.caption).toBe("");
  expect(snoozed.badge).toBe("2");
  expect(snoozed.tone).toBe("human");
  expect(snoozed.sealLabel).toMatch(/2 decisions waiting on you/);

  const rest = selectCompanion(inputs());
  expect(rest.mood).toBe("sleep");
  expect(rest.caption).toBe("");
  expect(rest.sealLabel).toMatch(/Resting/);
  expect(rest.badge).toBe("");
  expect(rest.tone).toBe("idle");
});

test("a step's class is the catalog's answer when the page offers the tool, and absent when it does not", () => {
  const offered = stepOf({ id: "1", kind: "tool", text: "host.ledgerbox.chase → refused", ok: false }, TOOLS);
  expect(offered).toMatchObject({ cls: "GATED", app: "ledgerbox", what: "chase: refused", ok: false });
  const core = stepOf({ id: "2", kind: "tool", text: "core.recall → 2 facts", ok: true }, []);
  expect(core.cls).toBeNull();
  expect(core.app).toBe("core");
});

test("the tape shows the last two steps of the turn in progress, and what she was asked before any", () => {
  const transcript: TranscriptEntry[] = [
    { id: "u0", kind: "user", text: "an earlier question" },
    { id: "t0", kind: "tool", text: "host.x.old → ok", ok: true },
    { id: "u1", kind: "user", text: "Chase the oldest." },
  ];
  const machine = machineAfter({ t: "init", onboarded: true, cards: 0 }, { t: "work", on: true });
  const fresh = selectCompanion(inputs({ machine, run: { phase: "running", transcript, cards: [], summary: null, error: null } }));
  expect(fresh.tape.prev).toBeNull();
  expect(fresh.tape.note).toBe("acting on “Chase the oldest.”");
  expect(fresh.tape.cur.what).toBe("thinking");

  const two = [
    ...transcript,
    { id: "t1", kind: "tool" as const, text: "host.x.list → 3 rows", ok: true },
    { id: "t2", kind: "tool" as const, text: "host.x.read → ok", ok: true },
  ];
  const busy = selectCompanion(inputs({ machine, run: { phase: "acting", transcript: two, cards: [], summary: null, error: null } }));
  expect(busy.tape.prev?.what).toBe("list: 3 rows");
  expect(busy.tape.cur.what).toBe("read: ok");
  expect(busy.lit).toBe(7);
});

test("the Origins tab says when it cut the list", () => {
  const many = Array.from({ length: OFFERS_SHOWN + 3 }, (_, i) => tool(`host.x.t${i}`, "READ", `Tool ${i}`));
  const m = selectCompanion(inputs({ tools: many }));
  expect(m.origins.offers).toHaveLength(OFFERS_SHOWN);
  expect(m.origins.offersFooter).toBe(`(showing ${OFFERS_SHOWN} of ${OFFERS_SHOWN + 3})`);
  expect(selectCompanion(inputs({ tools: many.slice(0, 2) })).origins.offersFooter).toBe("");
});

test("the daemon's ledger reply is read defensively and its footer is kept verbatim", () => {
  const snap = ledgerFrom({
    rows: [
      { row_id: "r1", created_at: "2026-09-30T09:41:12+00:00", model: "m", rounds: 2, cost_usd: 0.5, cost_estimated: true, is_error: false },
      { row_id: 7, is_error: true, error_reason: "engine_error" },
    ],
    footer: "(showing 2 of 9)",
  });
  expect(snap.rows[0]).toMatchObject({ id: "r1", cost: "~$0.5000", rounds: 2, isError: false });
  expect(snap.rows[1]).toMatchObject({ id: "", isError: true, reason: "engine_error", cost: "no cost" });
  expect(snap.footer).toBe("(showing 2 of 9)");
  expect(ledgerFrom({}).rows).toEqual([]);
});

test("every fixture is a model the machine can reach, and the seven names are the ADR's forms", () => {
  const forms = Object.fromEntries(Object.keys(fixtures).map((id) => [id, fixtures[id]().form]));
  expect(forms.seal).toBe("seal");
  expect(forms.tape).toBe("tape");
  expect(forms.hear).toBe("hear");
  expect(forms.slip).toBe("slip");
  expect(forms.welcome).toBe("welcome");
  expect(forms.ledger).toBe("ledger");
  expect(forms.tab).toBe("tab");
  expect(forms["seal waiting"]).toBe("seal");
  expect(forms["tab waiting"]).toBe("tab");
  expect(forms["slip approved"]).toBe("slip");
});

// -- the Record (UAT backlog B6) ---------------------------------------------------------------------

import { clockOf } from "@/lib/time";
import type { EarlierRecord } from "@/stores/run";

import { activityRow, decisionRow, engineView, recordView, showingOf, type LedgerSnapshot } from "./model";

const WHOLE_LEDGER: LedgerSnapshot = { rows: [], footer: "", showing: 0, total: 0, problem: null };
const WHOLE_EARLIER: EarlierRecord = { rows: [], showing: 0, total: 0, problem: null };
const view = (over: Partial<Parameters<typeof recordView>[0]> = {}) =>
  recordView({ calls: [], decisions: [], tools: [], earlier: WHOLE_EARLIER, ledger: WHOLE_LEDGER, ...over });

test("the header says nothing is missing only when every list is whole", () => {
  const whole = view();
  expect(whole.complete).toBe(true);
  expect(whole.header).toContain("Nothing is missing from this list");

  const cutEarlier = view({ earlier: { ...WHOLE_EARLIER, showing: 50, total: 80 } });
  expect(cutEarlier.complete).toBe(false);
  expect(cutEarlier.header).not.toContain("Nothing is missing");
  expect(cutEarlier.header).toContain("(showing 50 of 80)");

  const cutLedger = view({ ledger: { ...WHOLE_LEDGER, footer: "(showing 20 of 90)", showing: 20, total: 90 } });
  expect(cutLedger.complete).toBe(false);
  expect(cutLedger.header).toContain("(showing 20 of 90)");

  // both cut: the figures add up across the lists
  const both = view({
    decisions: [{ id: "a", action: "x", origin: "host:y", result: "approved", reason: null, at: "2026-10-01 10:00:00" }],
    earlier: { ...WHOLE_EARLIER, showing: 50, total: 80 },
    ledger: { ...WHOLE_LEDGER, showing: 20, total: 90 },
  });
  expect(both.header).toContain("(showing 71 of 171)");
});

test("a list that has not answered, or could not be read, is not whole", () => {
  expect(view({ earlier: null }).complete).toBe(false);
  expect(view({ earlier: { ...WHOLE_EARLIER, problem: "locked" } }).complete).toBe(false);
  expect(view({ ledger: null }).complete).toBe(false);
  expect(view({ ledger: { ...WHOLE_LEDGER, problem: "refused" } }).complete).toBe(false);
  expect(view({ ledger: null }).header).not.toContain("Nothing is missing");
});

test("every list carries shown-of-total, and a decision row names the app, the tool, the class and the local clock", () => {
  expect(showingOf(3, 7)).toBe("(showing 3 of 7)");
  const row = decisionRow({
    id: "apr_1",
    action: "host.ledgerbox.chase",
    origin: "host:ledgerbox",
    result: "user_denied",
    reason: "user_denied",
    at: "2026-10-01 10:08:07",
  });
  expect(row).toMatchObject({ tool: "host.ledgerbox.chase", app: "ledgerbox", cls: "GATED", result: "declined" });
  // the stamp is UTC: the clock is read through lib/time, never as the viewer's local time
  expect(row.clock).toBe(clockOf("2026-10-01 10:08:07"));
  expect(decisionRow({ id: "b", action: "a", origin: "", result: "refused", reason: "foreign_origin", at: "" }).result).toBe("refused");
});

test("a decision kept from an earlier window reads back with its site, tool, outcome and when", () => {
  const row = activityRow(
    { id: 9, ts: "2026-10-01 09:00:00", tab_id: null, origin: "host:ledgerbox", tool: "host.ledgerbox.chase", tier: 1, class: "GATED", outcome: "approved", ms: 0, reason: null, approval_id: "apr_old" },
    Date.parse("2026-10-01T10:00:00Z"),
  );
  expect(row).toMatchObject({ id: "apr_old", app: "ledgerbox", cls: "GATED", result: "approved" });
  expect(row.clock).toContain(clockOf("2026-10-01 09:00:00"));
  expect(row.clock).toContain("1 h ago");
});

test("the window's own list merges decisions and calls, newest first", () => {
  const v = view({
    calls: [{ id: "c1", kind: "tool", text: "host.ledgerbox.list_overdue → 3", ok: true, at: "2026-10-01 10:00:00" }],
    decisions: [{ id: "a", action: "host.ledgerbox.chase", origin: "host:ledgerbox", result: "approved", reason: null, at: "2026-10-01 10:05:00" }],
  });
  expect(v.session.map((r) => r.id)).toEqual(["a", "c1"]);
  expect(v.session[1].clock).toBe(clockOf("2026-10-01 10:00:00"));
});

test("the ledger reply's figures come from its footer, or its own totals, or the rows", () => {
  expect(ledgerFrom({ rows: [{}], footer: "(showing 1 of 9)" })).toMatchObject({ showing: 1, total: 9 });
  expect(ledgerFrom({ rows: [{}, {}], showing: 2, total: 2, footer: "" })).toMatchObject({ showing: 2, total: 2 });
  expect(ledgerFrom({ rows: [{}] })).toMatchObject({ showing: 1, total: 1 });
  const dated = ledgerFrom({ rows: [{ row_id: "r", created_at: "2026-10-01T10:08:07" }] });
  expect(dated.rows[0].clock).toBe(clockOf("2026-10-01T10:08:07"));
});

// -- the welcome's engine line (UAT backlog B4) --------------------------------------------------------

test("the engine line is what a probe found, and there is no tick before one has answered", () => {
  expect(engineView("claude_code", null, null, false)).toMatchObject({ state: "looking", text: "Looking for your engine…" });
  expect(engineView("claude_code", null, "no daemon", false).state).toBe("missing");
  const ready = engineView("claude_code", [{ id: "claude_code", state: "found", detail: "2.1" }], null, false);
  expect(ready).toMatchObject({ state: "ready", text: "Engine: Claude Code, ready.", sub: "She never asks for a key." });
});

test("a missing or signed-out engine names the plain remedy; the other one is offered when it is found", () => {
  const missing = engineView("claude_code", [{ id: "claude_code", state: "not_found", detail: "" }], null, false);
  expect(missing).toMatchObject({ state: "missing", offer: null });
  expect(missing.text).toBe("Claude Code is not on this computer yet.");
  expect(missing.sub).toContain("Install it");

  const signedOut = engineView("claude_code", [{ id: "claude_code", state: "not_logged_in", detail: "" }], null, true);
  expect(signedOut.text).toBe("Claude Code is installed but not signed in.");
  expect(signedOut.checking).toBe(true);

  const other = engineView(
    "claude_code",
    [
      { id: "claude_code", state: "not_found", detail: "" },
      { id: "codex", state: "found", detail: "" },
    ],
    null,
    false,
  );
  expect(other.offer).toEqual({ id: "codex", label: "Codex" });
  expect(other.sub).toContain("Codex is ready on this computer");
  for (const v of [missing, signedOut, other]) expect(`${v.text} ${v.sub}`).not.toMatch(/PATH|probe|daemon|not_found/);
});

// -- the card while its answer is on its way (UAT backlog B1) -----------------------------------------

test("a card whose answer is on its way stays first, marked sending; a refused one carries its sentence", () => {
  const machine = machineAfter(
    { t: "init", onboarded: true, cards: 0 },
    { t: "cards", n: 2 },
    { t: "decide", kind: "approve", by: "click" },
  );
  const m = selectCompanion(
    inputs({
      machine,
      run: {
        phase: "idle",
        transcript: [],
        cards: [CARDS[0], CARDS[1]],
        summary: null,
        error: null,
        answering: { [CARDS[0].id]: "approve" },
        refusals: { [CARDS[1].id]: "That answer was refused: x." },
      },
    }),
  );
  expect(m.cards.map((c) => [c.id, c.sending, c.refusal])).toEqual([
    [CARDS[0].id, true, null],
    [CARDS[1].id, false, "That answer was refused: x."],
  ]);
  expect(m.decision).toMatchObject({ kind: "approve", sending: true });
});

test("a pending row with no rationale still gets a card that says so, with its action and parameters", () => {
  const m = selectCompanion(
    inputs({
      machine: machineAfter({ t: "init", onboarded: true, cards: 0 }, { t: "cards", n: 1 }),
      run: { phase: "idle", transcript: [], cards: [{ ...CARDS[0], rationale: "" }], summary: null, error: null },
    }),
  );
  expect(m.cards[0].rationale).toMatch(/No reason was filed/);
  expect(m.cards[0].params.length).toBeGreaterThan(0);
});

test("a stopped turn reads as a plain sentence, with the technical detail kept apart", () => {
  const m = selectCompanion(
    inputs({
      run: { phase: "error", transcript: [], cards: [], summary: null, error: { reason: "engine_error", detail: "FileNotFoundError: claude" } },
    }),
  );
  expect(m.talk.error?.sentence).toBe("Athena could not start Claude Code on this computer. Check Setup.");
  expect(m.talk.error?.detail).toBe("FileNotFoundError: claude");
  expect(m.talk.error?.sentence).not.toMatch(/FileNotFoundError|engine_error/);
});

test("Main is reported hidden only while the welcome has not been answered", () => {
  expect(selectCompanion(inputs({ onboarded: false })).talk.mainHidden).toBe(true);
  expect(selectCompanion(inputs({ onboarded: true })).talk.mainHidden).toBe(false);
  expect(selectCompanion(inputs()).talk.mainHidden).toBe(false);
});

test("the mood is one precedence: a card, then the person, then her voice, then work, then sleep", () => {
  expect(moodOf("seal", 1, true, "speaking", true)).toBe("wait");
  expect(moodOf("seal", 0, true, "speaking", true)).toBe("hear");
  expect(moodOf("hear", 0, false, "idle", false)).toBe("hear");
  expect(moodOf("seal", 0, false, "speaking", true)).toBe("speak");
  expect(moodOf("seal", 0, false, "thinking", false)).toBe("work");
  expect(moodOf("tape", 0, false, "idle", false)).toBe("work");
  expect(moodOf("seal", 0, false, "idle", false)).toBe("sleep");
  expect(moodOf("ledger", 0, false, "idle", false)).toBe("none");
  expect(moodOf("welcome", 0, false, "off", false)).toBe("none");
});

test("an open form keeps its word; a speaking seal is named for a screen reader", () => {
  const speaking = selectCompanion(inputs({ voice: { phase: "speaking", available: true, partial: "" } }));
  expect(speaking.mood).toBe("speak");
  expect(speaking.sealLabel).toBe("Athena. Speaking.");
});

test("a collapse to the seal keeps drawing the ledger to fold it, but not a slip that already tore", () => {
  const folding = selectCompanion(
    inputs({ machine: machineAfter({ t: "init", onboarded: true, cards: 0 }, { t: "seal" }, { t: "seal" }) }),
  );
  expect(folding.form).toBe("seal");
  expect(folding.exit?.form).toBe("ledger");
  expect(folding.mood).toBe("sleep");

  const settled = selectCompanion(inputs());
  expect(settled.exit).toBeNull();
});

test("a command Main offers becomes the composer's draft, and nothing is sent (ADR 0040)", () => {
  expect(selectCompanion(inputs()).talk.draft).toEqual({ n: 0, text: "" });
  const offered = selectCompanion(inputs({ offer: { n: 2, text: "It's reimbursement day." } }));
  expect(offered.talk.draft).toEqual({ n: 2, text: "It's reimbursement day." });
  expect(offered.talk.blocks).toEqual([]);
});

test("the active playbook is named above the composer, and absent when there is none (ADR 0044)", () => {
  expect(selectCompanion(inputs()).talk.project).toBeNull();
  const working = selectCompanion(inputs({ project: { title: "Amazon FBA reimbursements" } }));
  // Without an id this build ships, the title rides alone and the plan is empty.
  expect(working.talk.project).toEqual({
    title: "Amazon FBA reimbursements",
    steps: [],
    portals: [],
    stops: [],
  });
});

test("a project's plan comes from the bundled playbook by id, and an unknown one has none", async () => {
  const { fixtures } = await import("./fixtures");
  const known = fixtures["ledger playbook"]().talk.project;
  expect(known?.steps.length).toBeGreaterThan(0);
  expect(known?.portals).toContain("Seller Central");
  const plain = fixtures.ledger().talk.project;
  expect(plain).toBeNull();
});
