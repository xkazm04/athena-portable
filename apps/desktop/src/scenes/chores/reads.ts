/**
 * The Chores depth's daemon reads, kept warm across a move — README section 3.5, ADR 0159.
 *
 * The stage mounts a fresh view at every move, so an answer kept in a component is gone when the
 * person comes back from the studio or the replay, and the page repaints from "Looking…". The
 * depth's reads (a chore's saved cases, a case's runs, every case for "Your chores") live here
 * instead, in module scope as `memory.ts` keeps the filters and the scroll:
 *
 * - a remount reads the last answer synchronously and paints it, then asks again behind it
 *   (stale-while-revalidate: one revalidation per warm paint);
 * - two asks for one key while the first is on its way share it (in-flight dedup);
 * - the client object is part of the key, so an answer one client gave is never shown for another;
 * - a failed revalidation keeps the last answer drawn and says it could not be refreshed: the state
 *   tells `found` fresh, refreshing and refresh-failed apart, so a stale answer never reads as fresh.
 *
 * The map is bounded by the depth's working set (cases per chore, runs per case, the daemon cuts at
 * 20); past `LIMIT` the oldest settled entry goes. `forgetReads()` is for tests (`forgetChores`).
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

/** What a read knows: nothing yet, an answer (perhaps being refreshed, perhaps not refreshable), or a cold failure. */
export type ReadState<T> =
  | { kind: "looking" }
  | { kind: "found"; value: T; refreshing: boolean; refreshFailed?: unknown }
  | { kind: "failed"; error: unknown };

interface Entry {
  /** The last answer, if one ever came. */
  readonly answer?: { value: unknown };
  /** The last attempt's rejection, cleared by the next answer. */
  readonly error?: { reason: unknown };
  readonly inflight: Promise<unknown> | null;
}

/** Past this many keys the oldest settled one is dropped (the depth's working set is far smaller). */
export const LIMIT = 64;

let entries = new Map<string, Entry>();
let generation = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object): number => {
  let id = ids.get(o);
  if (id === undefined) {
    id = nextId++;
    ids.set(o, id);
  }
  return id;
};

/** The cache key of `route` asked of `client` (and, when the read spans two clients, `also`). */
export function readKey(client: object, route: string, also?: object): string {
  return `${idOf(client)}${also ? `+${idOf(also)}` : ""}|${route}`;
}

function put(key: string, entry: Entry) {
  entries.delete(key);
  entries.set(key, entry);
  if (entries.size > LIMIT) {
    for (const [k, e] of entries) {
      if (entries.size <= LIMIT) break;
      if (k !== key && e.inflight === null) entries.delete(k);
    }
  }
  emit();
}

/**
 * Ask `key`, sharing an ask already on its way. The answer (or the rejection) is kept for the next
 * mount; an earlier answer survives a rejection.
 */
export function read<T>(key: string, fetch: () => Promise<T>): Promise<T> {
  const was = entries.get(key);
  if (was?.inflight) return was.inflight as Promise<T>;
  const gen = generation;
  let asked: Promise<T>;
  try {
    asked = fetch();
  } catch (error) {
    asked = Promise.reject(error);
  }
  const settle = (next: (e: Entry) => Entry) => {
    if (gen !== generation) return;
    const now = entries.get(key);
    if (now?.inflight !== asked) return;
    put(key, next(now));
  };
  asked.then(
    (value) => settle(() => ({ answer: { value }, inflight: null })),
    (reason: unknown) => settle((e) => ({ answer: e.answer, error: { reason }, inflight: null })),
  );
  put(key, { answer: was?.answer, error: was?.error, inflight: asked });
  return asked;
}

const COLD: ReadState<never> = { kind: "looking" };

/** What `key` knows now, without asking. */
export function peek<T>(key: string): ReadState<T> {
  return stateOf<T>(entries.get(key));
}

function stateOf<T>(e: Entry | undefined): ReadState<T> {
  if (!e) return COLD;
  if (e.answer) {
    const found = { kind: "found" as const, value: e.answer.value as T, refreshing: e.inflight !== null };
    return e.error && !e.inflight ? { ...found, refreshFailed: e.error.reason } : found;
  }
  // A retry after a cold failure is looking again, as a fresh mount always was.
  if (e.error && !e.inflight) return { kind: "failed", error: e.error.reason };
  return COLD;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/**
 * `key`'s answer for a component: the last one at once if there is one, asked again once per mount
 * (and whenever the key changes). `null` asks nothing and stays looking.
 */
export function useRead<T>(key: string | null, fetch: () => Promise<T>): ReadState<T> {
  // The newest fetch, for the ask below (refs are written in an effect, never during render).
  const latest = useRef(fetch);
  useEffect(() => {
    latest.current = fetch;
  });
  const entry = useSyncExternalStore(
    subscribe,
    () => (key === null ? undefined : entries.get(key)),
    () => (key === null ? undefined : entries.get(key)),
  );
  useEffect(() => {
    if (key === null) return;
    // A rejection is kept in the entry and drawn from there; nothing more to do with it here.
    read(key, () => latest.current()).catch(() => undefined);
  }, [key]);
  return stateOf<T>(entry);
}

/** For tests: start from nothing; an answer still on its way lands nowhere. */
export function forgetReads() {
  generation++;
  entries = new Map();
  emit();
}
