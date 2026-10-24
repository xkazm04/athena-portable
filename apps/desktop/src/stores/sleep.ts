/**
 * Her sleep, as Main's window holds it - device-vitals (ADR 0142, `src/athena/core/sleep/`).
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
 * refuses it at once (the tasks store's rule, `stores/tasks.ts`).
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
import type { CycleStatus, CycleView, ProposalView, SleepRunAnswer, SleepView } from "@/lib/sleep";
import { endpoint, useDaemon } from "@/stores/daemon";

/** The least time between two reads a bus (re)connect asks for. */
export const REREAD_MIN_MS = 5000;
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
  /** What is in flight: `run`, or a proposal id. */
  busy: Readonly<Record<string, true>>;
  /** The last refusal per act (`run` or a proposal id), in one sentence. */
  errors: Readonly<Record<string, string>>;
  /** The daemon's answer to the last "Sleep now"; `null` before one. */
  answer: SleepRunAnswer | null;
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

let nudgesSinceRead = 0;
let reading: Promise<void> | null = null;
let lastRead = Number.NEGATIVE_INFINITY;

async function readOnce(client: DaemonApi): Promise<void> {
  nudgesSinceRead = 0;
  try {
    const [{ sleep }, { cycles }, { proposals }] = await Promise.all([
      client.sleep(),
      client.sleepCycles(CYCLES_SHOWN),
      client.sleepProposals(),
    ]);
    useSleep.setState((s) => ({
      view: sleep,
      cycles,
      proposals,
      loaded: true,
      missing: false,
      problem: null,
      journals: keptJournals(s.journals, cycles),
    }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) useSleep.setState({ ...EMPTY_SLEEP, loaded: true, missing: true });
    else useSleep.setState({ problem: sentenceOf("read her sleep", error) });
  }
}

/**
 * Read the three lists now. One read at a time: a call while one is out shares it, and a nudge
 * that arrived meanwhile reads again, since it may be newer than the answer.
 */
export function loadSleep(): Promise<void> {
  if (reading) return reading;
  const client = deps.api();
  if (!client) {
    useSleep.setState({ problem: "Could not read her sleep: Athena is not running here yet." });
    return Promise.resolve();
  }
  lastRead = deps.now();
  reading = (async () => {
    // A cycle moves through its phases in seconds, so nudges can keep landing; three reads in a
    // row is the most one call makes, and the bus's reconnect beat catches anything after it.
    for (let n = 0; n === 0 || (nudgesSinceRead > 0 && n < 3); n += 1) await readOnce(client);
  })().finally(() => {
    reading = null;
  });
  return reading;
}

/** One `sleep.changed`: read again, or once more after the read that is out. */
export function nudged(): void {
  nudgesSinceRead += 1;
  void loadSleep();
}

/** A bus (re)connect: read again, at most once per {@link REREAD_MIN_MS}. */
function reconnected(): void {
  if (deps.now() - lastRead >= REREAD_MIN_MS) void loadSleep();
}

// -- the count of who is showing it --------------------------------------------------------------

let holders = 0;
let unfollow: (() => void) | null = null;

/** Read her sleep and follow the bus until the returned stop is called. Counted, as the tasks are. */
export function startSleep(): () => void {
  holders += 1;
  if (holders === 1) {
    void loadSleep();
    unfollow = deps.follow?.(nudged, reconnected) ?? null;
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    holders -= 1;
    if (holders === 0) {
      unfollow?.();
      unfollow = null;
    }
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
  if (reading) await reading;
  await loadSleep();
}

/**
 * Keep or forget what a proposal offers. A contradiction's forget names the one of its two
 * memories that goes (`nodeId`); keep closes it with both kept.
 */
export async function decide(proposalId: string, action: "keep" | "forget", nodeId: string | null = null): Promise<void> {
  const client = deps.api();
  if (!client) {
    say(proposalId, "Could not answer it: Athena is not running here yet.");
    return;
  }
  mark(proposalId, true);
  say(proposalId, null);
  let refused: string | null = null;
  try {
    await client.sleepDecide(proposalId, action, nodeId);
  } catch (error) {
    refused = sentenceOf(action === "keep" ? "keep it" : "forget it", error);
  } finally {
    mark(proposalId, false);
  }
  if (reading) await reading;
  await loadSleep();
  if (refused) say(proposalId, refused);
}

export function resetSleepForTests(): void {
  unfollow?.();
  unfollow = null;
  holders = 0;
  reading = null;
  nudgesSinceRead = 0;
  lastRead = Number.NEGATIVE_INFINITY;
  deps = LIVE;
  useSleep.setState({ ...EMPTY_SLEEP });
}
