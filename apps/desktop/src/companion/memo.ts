/**
 * Her model, derived from what changed — ADR 0185, README section 3.1.
 *
 * `selectCompanion` (model.ts) derives everything from scratch, which is right for a fixture and
 * wrong for a live window: every streamed delta is a new transcript entry, and from scratch means
 * walking the whole session to read one more sentence. A session would cost the square of its
 * length. This file keeps what holds still:
 *
 * - `createTranscriptCache` folds the transcript entry by entry. The run store only appends to it
 *   (`push` spreads a new array and leaves every earlier entry as it was), so a new entry is
 *   folded into the turn context and the plain messages without reading the ones before. Anything
 *   else (Clear, a shorter list, an entry amended in place) is rebuilt whole.
 * - `createCompanionSelector` keeps each part of the model (`CompanionParts`) while the inputs
 *   that part reads hold still, so a delta that proposes nothing leaves the cards, the Record, the
 *   Origins tab and the welcome as the very objects they were.
 * - `pickRun` and `stableSlice` let Live subscribe to the run fields the model reads, so a store
 *   write it never reads does not render her at all.
 *
 * The plain functions stay the oracle: `memo.test.ts` holds every answer here deep-equal to theirs,
 * on every fixture and at every step of a scripted session. The public shape is the selector's:
 * `createCompanionSelector()` returns `(inputs: CompanionInputs) => CompanionModel`, the signature
 * of `selectCompanion`, so a new input is added to `CompanionInputs` and to the keys of the part
 * that reads it, and nowhere else.
 */
import type { RunState, TranscriptEntry } from "@/stores/run";

import {
  assembleCompanion,
  cardsPart,
  joinProse,
  lastUserOf,
  originsPart,
  recordPart,
  sheetPart,
  stepsOfTurn,
  suggestionsFor,
  tapePart,
  welcomePart,
  type CompanionInputs,
  type CompanionModel,
} from "./model";
import { buildContext, translate, type PlainMessage, type TurnContext } from "./translate";

// -- the transcript ----------------------------------------------------------------------------

type Ctx = TurnContext;
type MapKey = keyof Ctx;

export interface TranscriptView {
  /** `buildContext(transcript)`: kept as the same object while no entry changes it. */
  turn: TurnContext;
  /** `plainMessages(transcript)`: a message no entry changed is the same object it was. */
  messages: readonly PlainMessage[];
}

export interface TranscriptCache {
  update(entries: readonly TranscriptEntry[]): TranscriptView;
  /** Raw entries folded, whole re-translations (the context a message reads changed), and whole rebuilds. */
  readonly stats: { visited: number; full: number; rebuilds: number };
}

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * `into` with `from`'s keys laid over it, later wins, as `buildContext` assigns them. Returns
 * `into` itself when nothing would change, else a copy: a context handed out is never mutated.
 */
function overlay<V>(into: Record<string, V>, from: Record<string, V>): Record<string, V> {
  let out = into;
  for (const [k, v] of Object.entries(from)) {
    if (k in out && same(out[k], v)) continue;
    if (out === into) out = { ...into };
    out[k] = v;
  }
  return out;
}

/** Those keys of `ctx` with `add` laid over; `ctx` itself when nothing changed. */
function fold(ctx: Ctx, add: Ctx, keys: readonly MapKey[]): Ctx {
  let out = ctx;
  for (const key of keys) {
    const next = overlay(ctx[key] as Record<string, unknown>, add[key] as Record<string, unknown>);
    if (next !== ctx[key]) out = { ...out, [key]: next };
  }
  return out;
}

const ALL: readonly MapKey[] = ["byId", "byEmail", "drafts", "proposals"];
const PAGE: readonly MapKey[] = ["byId", "byEmail", "drafts"];
const empty = (): Ctx => ({ byId: {}, byEmail: {}, drafts: {}, proposals: {} });

/**
 * A transcript, folded once. `buildContext` reads tool rows into `byId`, `byEmail` and `drafts`
 * and assistant text into `proposals`, each later-wins, so folding one entry's own context over
 * the running one is the same as reading every entry again. Messages are translated against the
 * merged transcript (a run of deltas is one message), whose proposals are read from the joined
 * text and may differ from the raw deltas', so those are kept apart.
 */
export function createTranscriptCache(): TranscriptCache {
  const stats = { visited: 0, full: 0, rebuilds: 0 };
  let entries: readonly TranscriptEntry[] = [];
  let turn: Ctx = empty();
  /** The merged transcript, its proposals up to (not including) an assistant tail, and the context messages read. */
  let merged: TranscriptEntry[] = [];
  let settled: Ctx["proposals"] = {};
  let said: Ctx = empty();
  /** Each merged entry translated, recovered failures marked. */
  let shown: PlainMessage[] = [];
  let view: TranscriptView = { turn, messages: [] };

  const reset = () => {
    entries = [];
    turn = empty();
    merged = [];
    settled = {};
    said = empty();
    shown = [];
  };

  const extends_ = (next: readonly TranscriptEntry[]) =>
    next.length >= entries.length && entries.every((e, k) => next[k] === e);

  const recover = (from: number) => {
    // A failed step is recovered by a later ok step of the same tool (translateAll); only the
    // steps at `from` and after are new, so only they can recover an earlier one.
    for (let j = from; j < shown.length; j++) {
      const ok = shown[j]!;
      if (ok.role !== "step" || ok.tone !== "ok") continue;
      for (let k = 0; k < j; k++) {
        const m = shown[k]!;
        if (m.role === "step" && m.tone === "fail" && !m.recovered && m.tool === ok.tool) shown[k] = { ...m, recovered: true };
      }
    }
  };

  const update = (next: readonly TranscriptEntry[]): TranscriptView => {
    if (next === entries && stats.visited > 0) return view;
    if (!extends_(next)) {
      stats.rebuilds++;
      reset();
    }
    let dirty = merged.length;
    let pageChanged = false;
    for (let k = entries.length; k < next.length; k++) {
      const e = next[k]!;
      stats.visited++;
      const own = buildContext([e]);
      const before = turn;
      turn = fold(turn, own, ALL);
      if (turn !== before && PAGE.some((key) => turn[key] !== before[key])) pageChanged = true;
      const tail = merged[merged.length - 1];
      if (e.kind === "assistant" && tail?.kind === "assistant") {
        merged[merged.length - 1] = { ...tail, text: joinProse(tail.text, e.text) };
        dirty = Math.min(dirty, merged.length - 1);
      } else {
        if (tail?.kind === "assistant") settled = overlay(settled, buildContext([tail]).proposals);
        merged.push(e);
      }
    }
    entries = next;

    const tail = merged[merged.length - 1];
    const proposals = tail?.kind === "assistant" ? overlay(settled, buildContext([tail]).proposals) : settled;
    const ctxChanged = pageChanged || !sameKeys(proposals, said.proposals);
    if (ctxChanged) {
      said = { byId: turn.byId, byEmail: turn.byEmail, drafts: turn.drafts, proposals };
      stats.full++;
      dirty = 0;
    }
    shown.length = dirty;
    for (let k = dirty; k < merged.length; k++) shown[k] = translate(merged[k]!, said);
    recover(dirty);
    view = { turn, messages: shown.filter((m) => m.role !== "her" || m.title !== "") };
    return view;
  };

  return { update, stats };
}

/** Two proposal maps that read the same: the same keys, each the same proposal. */
function sameKeys(a: Ctx["proposals"], b: Ctx["proposals"]): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => k in b && same(a[k], b[k]));
}

// -- the selector ------------------------------------------------------------------------------

/** One remembered answer: kept while every key is the same value it was. */
function memo<R>(): (keys: readonly unknown[], compute: () => R) => R {
  let last: readonly unknown[] | null = null;
  let value: R;
  return (keys, compute) => {
    if (last && last.length === keys.length && keys.every((k, n) => Object.is(k, last![n]))) return value;
    value = compute();
    last = keys;
    return value;
  };
}

/** The same entries as `prev`, element for element: then `prev`, so what reads the steps holds still. */
function steady<T>(prev: readonly T[] | null, next: readonly T[]): readonly T[] {
  return prev && prev.length === next.length && prev.every((x, k) => x === next[k]) ? prev : next;
}

/**
 * `selectCompanion`, remembering. One per window: it holds that window's transcript cache and
 * last parts. The answer deep-equals `selectCompanion(inputs)` for every input.
 */
export function createCompanionSelector(): (i: CompanionInputs) => CompanionModel {
  const transcript = createTranscriptCache();
  const cards = memo<ReturnType<typeof cardsPart>>();
  const sheet = memo<ReturnType<typeof sheetPart>>();
  const tape = memo<ReturnType<typeof tapePart>>();
  const suggestions = memo<string[]>();
  const record = memo<ReturnType<typeof recordPart>>();
  const origins = memo<ReturnType<typeof originsPart>>();
  const welcome = memo<ReturnType<typeof welcomePart>>();
  let steps: readonly TranscriptEntry[] | null = null;

  return (i) => {
    const r = i.run;
    const { turn, messages } = transcript.update(r.transcript);
    const c = i.connectors;
    const cardList = cards(
      [r.cards, i.held, i.machine.decided, r.answering, r.refusals, r.captureWhy, i.tools, r.targets, i.drifts, i.tabs, c === undefined, c?.items, c?.loaded, c?.notice, turn, r.taskCards],
      () => cardsPart(i, turn),
    );
    steps = steady(steps, stepsOfTurn(r.transcript));
    const lastUser = lastUserOf(r.transcript);
    const m = i.machine;
    return assembleCompanion(i, {
      turn,
      messages,
      cards: cardList,
      sheet: sheet([r.cards, r.slots, r.unticked, r.ran, cardList], () => sheetPart(i, cardList)),
      steps,
      tape: tape([steps, turn, lastUser, r.phase, r.error, r.summary, i.tools, m.working, m.lingering, i.engine], () =>
        tapePart(i, steps!, turn, lastUser),
      ),
      suggestions: suggestions([i.tools], () => suggestionsFor(i.tools)),
      record: record([r.calls ?? r.transcript, i.decisions, i.tools, r.earlier, i.ledger, i.nowMs], () => recordPart(i)),
      origins: origins([i.origin, i.tools, i.toolsProblem, i.known], () => originsPart(i)),
      welcome: welcome(
        [i.engine, i.engineId, i.probes, i.probeProblem, i.probing, i.runningEngineId, i.daemonHealth, i.daemonLoaded, i.daemonError],
        () => welcomePart(i),
      ),
    });
  };
}

// -- Live's subscription -----------------------------------------------------------------------

/** The run store's fields her window reads: what `CompanionInputs.run` takes, and the record and playbook. */
export function pickRun(s: RunState) {
  return {
    phase: s.phase,
    transcript: s.transcript,
    cards: s.cards,
    summary: s.summary,
    error: s.error,
    answering: s.answering,
    refusals: s.refusals,
    captureWhy: s.captureWhy,
    targets: s.targets,
    calls: s.calls,
    slots: s.slots,
    unticked: s.unticked,
    ran: s.ran,
    earlier: s.earlier,
    setup: s.setup,
    queued: s.queued,
    taskCards: s.taskCards,
    answered: s.answered,
    project: s.project,
  };
}

const shallowSame = (a: object, b: object): boolean => {
  const ka = Object.keys(a);
  return (
    ka.length === Object.keys(b).length &&
    ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
};

/**
 * A store selector that returns its last pick while the new one is shallow-equal to it, so a
 * subscription re-renders only when a picked field changed. One per subscriber.
 */
export function stableSlice<S, R extends object>(pick: (s: S) => R): (s: S) => R {
  let last: R | null = null;
  return (s) => {
    const next = pick(s);
    if (last && shallowSame(last, next)) return last;
    last = next;
    return next;
  };
}
