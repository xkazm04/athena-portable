/**
 * Her model, derived incrementally — ADR 0026 (the selector) and the ADR that records memo.ts.
 *
 * The plain functions (`buildContext`, `plainMessages`, `selectCompanion`) are the oracle: every
 * case here asserts the cached answer deep-equals theirs, and then that it did less work to get it
 * (a counter, or a reference kept).
 */
import { afterEach, expect, test, vi } from "vitest";

import { useRun, type TranscriptEntry } from "@/stores/run";

import { CARDS, TOOLS, machineAfter } from "./fixtures";
import { reduce } from "./machine";
import { NO_ACTIONS, plainMessages, selectCompanion, type CompanionInputs, type CompanionModel } from "./model";
import { createCompanionSelector, createTranscriptCache, pickRun, stableSlice } from "./memo";
import { buildContext } from "./translate";

// Every fixture is built through `selectCompanion`; this records the inputs it was given, so the
// memoized selector can be run on exactly those inputs.
const seen = vi.hoisted(() => ({ inputs: [] as unknown[] }));
vi.mock("./model", async (importOriginal) => {
  const real = await importOriginal<typeof import("./model")>();
  return {
    ...real,
    selectCompanion: (i: CompanionInputs) => {
      seen.inputs.push(i);
      return real.selectCompanion(i);
    },
  };
});

const user = (id: string, text: string): TranscriptEntry => ({ id, kind: "user", text });
const her = (id: string, text: string): TranscriptEntry => ({ id, kind: "assistant", text });
const row = (id: string, text: string, ok = true): TranscriptEntry => ({ id, kind: "tool", text, tier: 1, ok, at: `2026-09-30 09:41:${id.slice(-2).padStart(2, "0")}` });

const INBOX =
  'host.ledgerbox.read_inbox → {"items":[{"id":"inv_118","number":"INV-118","client":"Northwind Traders","contact_name":"Ana Ruiz","contact_email":"ap@northwind.example","balance":4800}],"of":1}';
const DRAFT =
  'host.ledgerbox.draft_reminder → {"ok":true,"draft":{"to":"ap@northwind.example","subject":"INV-118","body":"Hello Ana"}}';
const KESTREL =
  'host.ledgerbox.read_client → {"id":"cl_kestrel","client":"Kestrel & Co","contact_name":"Tom Hale","contact_email":"ap@kestrel.example"}';

const T: TranscriptEntry[] = [
  user("u1", "Which are overdue?"),
  her("a1", 'Let me read the inbox.\nOP: {"op": "propose_action", "action": "host.ledgerbox.read_inbox", "params": {"filter": "overdue"}}'),
  row("t01", INBOX),
  row("t02", DRAFT),
  her("a2", "One invoice is overdue."),
];

afterEach(() => {
  useRun.setState({ transcript: [], continuations: 0 });
});

test("transcript cache: one assistant delta folds exactly one new entry, and the context equals buildContext", () => {
  const cache = createTranscriptCache();
  cache.update(T);
  const before = cache.stats.visited;
  const next = [...T, her("a3", "It is INV-118.")];
  const out = cache.update(next);
  expect(cache.stats.visited - before).toBe(1);
  expect(out.turn).toEqual(buildContext(next));
});

test("transcript cache: after a delta the messages equal plainMessages, and only the last merged message is new", () => {
  const cache = createTranscriptCache();
  const first = cache.update(T).messages;
  const next = [...T, her("a3", "It is INV-118.")];
  const out = cache.update(next).messages;
  expect(out).toEqual(plainMessages(next));
  expect(out.length).toBe(first.length);
  for (let k = 0; k < out.length - 1; k++) expect(out[k]).toBe(first[k]);
  expect(out[out.length - 1]).not.toBe(first[first.length - 1]);
});

test("transcript cache: a tool entry naming a new contact re-translates, and still equals the plain functions", () => {
  const cache = createTranscriptCache();
  cache.update(T);
  const full = cache.stats.full;
  const next = [...T, row("t03", KESTREL)];
  const out = cache.update(next);
  expect(cache.stats.full).toBe(full + 1);
  expect(out.messages).toEqual(plainMessages(next));
  expect(out.turn).toEqual(buildContext(next));
});

test("transcript cache: a transcript that does not extend the cached one is rebuilt whole", () => {
  const cache = createTranscriptCache();
  const cases: TranscriptEntry[][] = [
    [], // Clear
    T.slice(0, 3), // shorter
    [T[0]!, T[1]!, { ...T[2]!, text: INBOX.replace("Ana Ruiz", "Ana Ruiz-Ortega") }, T[3]!, T[4]!], // amended in place
  ];
  for (const other of cases) {
    cache.update(T);
    const rebuilds = cache.stats.rebuilds;
    const out = cache.update(other);
    expect(cache.stats.rebuilds).toBe(rebuilds + 1);
    expect(out.messages).toEqual(plainMessages(other));
    expect(out.turn).toEqual(buildContext(other));
  }
});

function inputs(transcript: readonly TranscriptEntry[], over: Partial<CompanionInputs> = {}): CompanionInputs {
  return {
    machine: MACHINE,
    run: { ...RUN, transcript },
    voice: VOICE,
    daemonReady: true,
    origin: "https://ledgerbox.local",
    tools: TOOLS,
    held: null,
    known: KNOWN,
    ledger: null,
    decisions: DECISIONS,
    engine: "Claude Code",
    engineId: "claude_code",
    probes: PROBES,
    actions: NO_ACTIONS,
    ...over,
  };
}
const MACHINE = machineAfter({ t: "init", onboarded: true, cards: 0 }, { t: "cards", n: 2 });
const CALLS = T.filter((e) => e.kind === "tool");
const RUN: CompanionInputs["run"] = { phase: "running", transcript: [], cards: CARDS.slice(0, 2), summary: null, error: null, calls: CALLS };
const VOICE = { phase: "idle" as const, available: true, partial: "" };
const KNOWN = [{ origin: "https://ledgerbox.local", enabled: true, overrides: 0 }];
const DECISIONS = [{ id: "apr_1", action: "host.ledgerbox.send_reminder", origin: "host:ledgerbox", result: "approved" as const, reason: null, at: "2026-09-30 09:44:02" }];
const PROBES = [{ id: "claude_code", state: "found" as const, detail: "2.1.0" }];

test("memoized selector: one appended delta with no proposal keeps record, origins, welcome and cards", () => {
  const select = createCompanionSelector();
  const a = select(inputs(T));
  const b = select(inputs([...T, her("a3", "It is INV-118.")]));
  expect(b.record).toBe(a.record);
  expect(b.origins).toBe(a.origins);
  expect(b.welcome).toBe(a.welcome);
  expect(b.cards).toBe(a.cards);
  expect(b.talk.messages).not.toBe(a.talk.messages);
});

test("run slice picker used by Live: a write to a field the model never reads keeps the pick", () => {
  const select = stableSlice(pickRun);
  useRun.setState({ transcript: [...T] });
  const a = select(useRun.getState());
  useRun.setState({ continuations: 3 });
  expect(select(useRun.getState())).toBe(a);
  useRun.setState((s) => ({ transcript: [...s.transcript, her("a3", "more")] }));
  expect(select(useRun.getState())).not.toBe(a);
});

/** The model with its functions left out, for a deep comparison. */
const plain = (m: CompanionModel) => ({ ...m, actions: null });

test("guard: on every fixture's inputs the memoized selector equals selectCompanion", async () => {
  seen.inputs.length = 0;
  const { fixtures } = await import("./fixtures");
  for (const make of Object.values(fixtures)) make();
  // A copy: the oracle below is the recording one, and would grow the list it walks.
  const captured = [...seen.inputs] as CompanionInputs[];
  expect(captured.length).toBeGreaterThan(20);
  const select = createCompanionSelector();
  for (const i of captured) expect(plain(select(i))).toEqual(plain(selectCompanion(i)));
});

test("guard: through a 60-step scripted session the memoized selector equals selectCompanion at every step", () => {
  const select = createCompanionSelector();
  let transcript: TranscriptEntry[] = [];
  let run: CompanionInputs["run"] = { ...RUN, transcript, calls: [] };
  let machine = machineAfter({ t: "init", onboarded: true, cards: 0 });
  let held: CompanionInputs["held"] = null;
  // The store keeps a list it did not write as the same array, so a step changes only what it names.
  const TWO = CARDS.slice(0, 2);
  const ONE = CARDS.slice(1, 2);
  const steps: ((n: number) => void)[] = [
    (n) => (transcript = [...transcript, user(`u${n}`, `Question ${n}`)]),
    (n) => (transcript = [...transcript, her(`a${n}`, "Let me ")]),
    (n) => (transcript = [...transcript, her(`a${n}`, "look.")]),
    (n) => (transcript = [...transcript, her(`a${n}`, 'OP: {"op": "propose_action", "action": "host.ledgerbox.send_reminder", "params": {"id": "inv_118"}}')]),
    (n) => (transcript = [...transcript, row(`t${String(n).padStart(2, "0")}`, INBOX)]),
    (n) => (transcript = [...transcript, row(`t${String(n).padStart(2, "0")}`, "host.ledgerbox.read_client → boom", false)]),
    (n) => (transcript = [...transcript, row(`t${String(n).padStart(2, "0")}`, KESTREL)]),
    (n) => (transcript = [...transcript, row(`t${String(n).padStart(2, "0")}`, DRAFT)]),
    (n) => (transcript = [...transcript, { id: `d${n}`, kind: "tool", text: "declined: host.ledgerbox.send_reminder", tier: 1 }]),
    () => {
      run = { ...run, cards: TWO };
      machine = machineAfter({ t: "init", onboarded: true, cards: 0 }, { t: "cards", n: 2 });
    },
    () => {
      run = { ...run, cards: ONE };
      machine = machineAfter({ t: "init", onboarded: true, cards: 0 }, { t: "cards", n: 1 });
      held = null;
    },
    () => {
      // The head card is being stamped: the store has dropped it, the machine holds it.
      run = { ...run, cards: ONE };
      const stamp = machineAfter({ t: "init", onboarded: true, cards: 0 }, { t: "cards", n: 2 }, { t: "decide", kind: "approve", by: "click" });
      // The second time, only the stamp moves on: the answer was sent.
      machine = held ? reduce(stamp, { t: "sent", ok: true })[0] : stamp;
      held = CARDS[0]!;
    },
    (n) => (transcript = [...transcript, her(`a${n}`, '  TTS: "Done."')]),
  ];
  for (let n = 0; n < 60; n++) {
    if (n === 37) transcript = []; // Clear
    else if (n === 30 || n === 31) steps[11]!(n); // stamped, then sent: only the machine's stamp moves
    else if (n === 21 || n === 22) transcript = [...transcript, user(`u${n}`, `Then ${n}`)]; // two asks, no step between
    else if (n === 45 && transcript.length > 2) transcript = transcript.map((e, k) => (k === 1 ? { ...e, text: `${e.text} (amended)` } : e));
    else steps[(n * 7) % steps.length]!(n);
    const calls = transcript.filter((e) => e.kind === "tool");
    run = { ...run, transcript, phase: n % 5 === 0 ? "idle" : "running", calls: calls.length === run.calls?.length ? run.calls : calls };
    const i = inputs(transcript, { run, machine, held, toolsProblem: n % 9 === 4 ? "timeout" : null });
    expect(plain(select(i)), `step ${n}`).toEqual(plain(selectCompanion(i)));
  }
});
