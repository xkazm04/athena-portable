/**
 * Her sleep, as Main's window holds it - device-vitals (ADR 0143, `src/athena/core/sleep/`).
 *
 * A mirror of `GET /sleep`, `GET /sleep/cycles` and `GET /sleep/proposals`, and nothing more: the
 * daemon admits a cycle, runs it, writes its journal and keeps the proposals it left; this store
 * only shows them and carries a person's three acts back (sleep now, keep, forget). It is read by
 * one surface, the Sleep section of Mind > Brain, and only while that level is open, so it lives in
 * the Mind depth's lazy chunk: no first-frame file imports it (`console/graph.test.ts`).
 *
 * The bus is a nudge and the reads are the state, as for the devices: a `sleep.changed` carries no
 * row, so each one reads the three lists again. One read at a time, a nudge that lands while one is
 * out reads once more after it, and a bus (re)connect reads again at most once per
 * {@link REREAD_MIN_MS} - the daemon ends a quiet stream every 15 s, and a daemon with no bus
 * refuses it at once (the tasks store's rule, `stores/tasks.ts`). That discipline is the shared
 * mirror reader's (`lib/mirror.ts`, which the devices store reads through too); an act's read
 * supersedes the one out, and an answer older than one already issued is never applied.
 *
 * A person's answers are staged, not sent ({@link stage}, {@link stageAll}): a forget retires the
 * memory and closes the proposal in one call with no way back, so each answer waits
 * {@link COMMIT_MS} behind one Undo before it goes. One batch is pending at a time (a second answer
 * sends the first), the rows it holds stay out of the drawn list whatever a re-read says
 * ({@link openProposals}), it is sent 2 at a time with one read after, and the last holder letting
 * go sends it rather than dropping it: leaving the section is not a cancel. Keep all keeps every
 * open forget offer; a forget is never staged in bulk, and a contradiction always asks which goes.
 *
 * A cycle's journal is read when a person opens its row and kept by id; a cycle whose status moved
 * since its journal was read (it was running, now it is done) is read again on the next opening.
 *
 * An older daemon has no `/sleep`: its 404 is `missing`, which the section shows as nothing at all
 * rather than a fault, as the task strip does for `/tasks`.
 */
import { create } from "zustand";

import { ApiError, DaemonApi } from "@/lib/api";
import { followBus } from "@/lib/fleet";
import { createMirror } from "@/lib/mirror";
import type { CycleStatus, CycleView, ProposalView, SleepRunAnswer, SleepView } from "@/lib/sleep";
import { endpoint, useDaemon } from "@/stores/daemon";

/** The least time between two reads a bus (re)connect asks for. */
export const REREAD_MIN_MS = 5000;
/** How long a staged answer waits behind its Undo before it is sent. */
export const COMMIT_MS = 6000;
/** The most answers a batch has in flight at once. */
export const COMMIT_FANOUT = 2;
/** How many cycles the journal list reads. */
export const CYCLES_SHOWN = 20;

/** One cycle's journal as read: the markdown, `null` when none was written, or why it could not be read. */
export interface Journal {
  /** The cycle's status when the journal was read; a different one now means read it again. */
  status: CycleStatus;
  loading: boolean;
  text: string | null;
  problem: string | null;
}

/** Answers a person gave that wait behind one Undo: one action, for one or more proposals. */
export interface StagedBatch {
  ids: readonly string[];
  action: "keep" | "forget";
  /** The memory a contradiction's forget names, per proposal; absent or `null` for any other. */
  nodeIds: Readonly<Record<string, string | null>>;
  /** When it was staged, and when it is sent, on the store's clock. */
  at: number;
  until: number;
}

export interface SleepState {
  view: SleepView | null;
  cycles: CycleView[];
  proposals: ProposalView[];
  /** True once the three reads answered once. */
  loaded: boolean;
  /** This daemon has no `/sleep` (an older one): nothing to show, and no fault to tell. */
  missing: boolean;
  /** Why the last read failed, in one sentence; `null` when it did not. */
  problem: string | null;
  journals: Readonly<Record<string, Journal>>;
  /** What is in flight: `run` (a staged answer being sent is in `committing`). */
  busy: Readonly<Record<string, true>>;
  /** The last refusal per act (`run` or a proposal id), in one sentence. */
  errors: Readonly<Record<string, string>>;
  /** The daemon's answer to the last "Sleep now"; `null` before one. */
  answer: SleepRunAnswer | null;
  /** The answers waiting behind the Undo; `null` when none are. */
  staged: StagedBatch | null;
  /** The proposals whose staged answer is being sent: drawn nowhere until the read after it. */
  committing: Readonly<Record<string, true>>;
}

export interface SleepDeps {
  api: () => DaemonApi | null;
  now: () => number;
  /** Follow the bus: `onChange` per `sleep.changed`, `onConnected` per (re)connect. Returns its stop. */
  follow?: (onChange: () => void, onConnected: () => void) => () => void;
}

const LIVE: SleepDeps = {
  api: () => {
    const found = endpoint(useDaemon.getState());
    return found ? new DaemonApi(found) : null;
  },
  now: () => Date.now(),
  follow: (onChange, onConnected) =>
    followBus(
      () => LIVE.api(),
      (event) => {
        if (event.kind === "sleep.changed") onChange();
      },
      onConnected,
    ),
};

let deps: SleepDeps = LIVE;

export function setSleepDeps(next: SleepDeps): void {
  deps = next;
}

export const EMPTY_SLEEP: SleepState = {
  view: null,
  cycles: [],
  proposals: [],
  loaded: false,
  missing: false,
  problem: null,
  journals: {},
  busy: {},
  errors: {},
  answer: null,
  staged: null,
  committing: {},
};

export const useSleep = create<SleepState>(() => ({ ...EMPTY_SLEEP }));

/** A failed read or act in one plain sentence. */
export function sentenceOf(doing: string, error: unknown): string {
  if (error instanceof ApiError && error.status === 0) return `Could not ${doing}: Athena is not running here yet.`;
  const why = error instanceof ApiError ? error.message || error.reason : error instanceof Error ? error.message : String(error);
  return `Could not ${doing}: ${why}`;
}

/** The journals still good for `cycles`: one whose cycle changed status, or left the list, is dropped. */
export function keptJournals(journals: Readonly<Record<string, Journal>>, cycles: readonly CycleView[]): Record<string, Journal> {
  const next: Record<string, Journal> = {};
  for (const cycle of cycles) {
    const kept = journals[cycle.id];
    if (kept && (kept.loading || kept.status === cycle.status)) next[cycle.id] = kept;
  }
  return next;
}

// -- the reads -----------------------------------------------------------------------------------

type SleepAnswer = [{ sleep: SleepView }, { cycles: CycleView[] }, { proposals: ProposalView[] }];

/**
 * One read is the three lists together. A cycle moves through its phases in seconds, so nudges can
 * keep landing; three reads in a row is the most one flight makes, and the bus's reconnect beat
 * catches anything after it.
 */
const reader = createMirror<SleepAnswer>({
  read: () => {
    const client = deps.api();
    if (!client) {
      useSleep.setState({ problem: "Could not read her sleep: Athena is not running here yet." });
      return null;
    }
    return Promise.all([client.sleep(), client.sleepCycles(CYCLES_SHOWN), client.sleepProposals()]);
  },
  apply: ([{ sleep }, { cycles }, { proposals }]) =>
    useSleep.setState((s) => ({
      view: sleep,
      cycles,
      proposals,
      loaded: true,
      missing: false,
      problem: null,
      journals: keptJournals(s.journals, cycles),
    })),
  onFail: (error) => {
    if (error instanceof ApiError && error.status === 404) useSleep.setState({ ...EMPTY_SLEEP, loaded: true, missing: true });
    else useSleep.setState({ problem: sentenceOf("read her sleep", error) });
  },
  now: () => deps.now(),
  rereadMinMs: REREAD_MIN_MS,
  maxReads: 3,
  follow: () => deps.follow,
});

/**
 * Read the three lists now. One read at a time: a call while one is out shares it, and a nudge
 * that arrived meanwhile reads again, since it may be newer than the answer.
 */
export function loadSleep(): Promise<void> {
  return reader.load();
}

/** One `sleep.changed`: read again, or once more after the read that is out. */
export function nudged(): void {
  reader.nudge();
}

// -- the count of who is showing it --------------------------------------------------------------

/**
 * Read her sleep and follow the bus until the returned stop is called. Counted, as the tasks are;
 * the last stop sends a staged batch at once.
 */
export function startSleep(): () => void {
  const stop = reader.hold();
  return () => {
    stop();
    if (reader.holders() === 0) void commitNow();
  };
}

// -- the acts ------------------------------------------------------------------------------------

function mark(key: string, on: boolean): void {
  useSleep.setState((s) => {
    const busy = { ...s.busy };
    if (on) busy[key] = true;
    else delete busy[key];
    return { busy };
  });
}

function say(key: string, sentence: string | null): void {
  useSleep.setState((s) => {
    const errors = { ...s.errors };
    if (sentence) errors[key] = sentence;
    else delete errors[key];
    return { errors };
  });
}

/** Read one cycle's journal, unless it is already read for the status the cycle has now. */
export async function readJournal(cycleId: string): Promise<void> {
  const state = useSleep.getState();
  const status = state.cycles.find((c) => c.id === cycleId)?.status ?? "completed";
  const kept = state.journals[cycleId];
  if (kept && (kept.loading || (kept.status === status && kept.problem === null))) return;
  const put = (journal: Journal) => useSleep.setState((s) => ({ journals: { ...s.journals, [cycleId]: journal } }));
  const client = deps.api();
  if (!client) {
    put({ status, loading: false, text: null, problem: "Could not read the journal: Athena is not running here yet." });
    return;
  }
  put({ status, loading: true, text: null, problem: null });
  try {
    const { cycle, journal } = await client.sleepCycle(cycleId);
    put({ status: cycle.status, loading: false, text: journal, problem: null });
  } catch (error) {
    put({ status, loading: false, text: null, problem: sentenceOf("read the journal", error) });
  }
}

/** "Sleep now": ask for a cycle with `force`, keep the answer, then read what it did. */
export async function sleepNow(): Promise<void> {
  const client = deps.api();
  if (!client) {
    say("run", "Could not ask her to sleep: Athena is not running here yet.");
    return;
  }
  mark("run", true);
  say("run", null);
  useSleep.setState({ answer: null });
  try {
    useSleep.setState({ answer: await client.sleepRun(true) });
  } catch (error) {
    say("run", sentenceOf("ask her to sleep", error));
  } finally {
    mark("run", false);
  }
  await reader.refresh();
}

/** The open proposals a person is asked about: the staged and the sending ones left out. */
export function openProposals(state: Pick<SleepState, "proposals" | "staged" | "committing">): ProposalView[] {
  const held = new Set(state.staged?.ids ?? []);
  return state.proposals.filter((p) => p.status === "open" && !held.has(p.id) && !state.committing[p.id]);
}

let timer: ReturnType<typeof setTimeout> | null = null;

function disarm(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function open(ids: readonly string[], action: "keep" | "forget", nodeIds: Record<string, string | null>): void {
  void commitNow();
  useSleep.setState((s) => {
    const errors = { ...s.errors };
    for (const id of ids) delete errors[id];
    const at = deps.now();
    return { errors, staged: { ids, action, nodeIds, at, until: at + COMMIT_MS } };
  });
  timer = setTimeout(() => void commitNow(), COMMIT_MS);
}

/**
 * Keep or forget what a proposal offers, after the Undo window. A contradiction's forget names the
 * one of its two memories that goes (`nodeId`); keep closes it with both kept. A batch already
 * staged is sent first, so one Undo never covers two decisions.
 */
export function stage(proposalId: string, action: "keep" | "forget", nodeId: string | null = null): void {
  open([proposalId], action, { [proposalId]: nodeId });
}

/** Keep every open forget offer, as one batch behind one Undo. A contradiction is left to ask. */
export function stageAll(action: "keep"): void {
  const ids = openProposals(useSleep.getState())
    .filter((p) => p.kind === "forget")
    .map((p) => p.id);
  if (ids.length > 0) open(ids, action, {});
}

/** Take the staged batch back: nothing of it is sent. */
export function undo(): void {
  disarm();
  useSleep.setState({ staged: null });
}

/**
 * Send the staged batch now, {@link COMMIT_FANOUT} at a time, then read once. A refused answer comes
 * back under its proposal, which the read shows open again.
 */
export async function commitNow(): Promise<void> {
  disarm();
  const batch = useSleep.getState().staged;
  if (!batch) return;
  const { ids, action, nodeIds } = batch;
  useSleep.setState((s) => {
    const committing = { ...s.committing };
    for (const id of ids) committing[id] = true;
    return { staged: null, committing };
  });
  const refused: Record<string, string> = {};
  const client = deps.api();
  if (client) {
    let next = 0;
    const lane = async () => {
      while (next < ids.length) {
        const id = ids[next++]!;
        try {
          await client.sleepDecide(id, action, nodeIds[id] ?? null);
        } catch (error) {
          refused[id] = sentenceOf(action === "keep" ? "keep it" : "forget it", error);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(COMMIT_FANOUT, ids.length) }, lane));
    await reader.refresh();
  } else {
    for (const id of ids) refused[id] = "Could not answer it: Athena is not running here yet.";
  }
  useSleep.setState((s) => {
    const committing = { ...s.committing };
    for (const id of ids) delete committing[id];
    return { committing, errors: { ...s.errors, ...refused } };
  });
}

export function resetSleepForTests(): void {
  reader.reset();
  disarm();
  deps = LIVE;
  useSleep.setState({ ...EMPTY_SLEEP });
}
