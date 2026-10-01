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

test("the seal says what it carries: a count when a card is put away, its caption otherwise", () => {
  const snoozed = selectCompanion(
    inputs({
      machine: machineAfter({ t: "init", onboarded: true, cards: 0 }, { t: "cards", n: 2 }, { t: "esc" }),
      run: { phase: "idle", transcript: [], cards: [CARDS[0], CARDS[1]], summary: null, error: null },
    }),
  );
  expect(snoozed.form).toBe("seal");
  expect(snoozed.caption).toBe("waiting");
  expect(snoozed.badge).toBe("2");
  expect(snoozed.tone).toBe("human");
  expect(snoozed.sealLabel).toMatch(/2 decisions waiting on you/);

  const rest = selectCompanion(inputs());
  expect(rest.caption).toBe("resting");
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
