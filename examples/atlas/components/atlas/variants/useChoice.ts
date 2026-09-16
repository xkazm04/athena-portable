"use client";

/**
 * ONE ORTHOGONAL CHOICE, IN THE URL, REMEMBERED — the fifth copy of a hook the kit does not have.
 *
 * Round 3's gap 4 named `useChoice(key, param, values)` as "a hook that exists in three copies";
 * round 4's `canvas/useView.ts` was the fourth, and round 5 needs a second axis (which VARIANT is
 * mounted) that is exactly the same shape. So the fourth copy was generalised into this one and
 * both axes read it. That is the honest way to log a kit gap: write it once in the app, name it,
 * and let the count of copies be the measurement.
 *
 * THE FIDDLY PART, unchanged from round 4 and the reason this is not three lines: the value is not
 * knowable on the server. The URL is, but `localStorage` is not, so a lazy `useState` initialiser
 * renders one thing on the server and another on the client and React throws the tree away.
 * `useSyncExternalStore` is the sanctioned answer — a server snapshot of the default, a client
 * snapshot of the real choice, and React reconciles the difference itself.
 *
 * THE STORE IS MODULE-LEVEL AND THE HOOK NEVER HOLDS IT. The choice is a fact about the page, not
 * about one component: two components reading the same axis must never disagree, and a `useState`
 * in each of them would. Every function below is keyed by the PARAM — a string — because the
 * compiler's immutability rule is right that a mutable object passed into a hook and then written
 * to is a bug waiting to happen, and the fix is to pass the key instead of the object.
 *
 * `history.replaceState`, not `push`: a variant or a view is not a place, it is a way of looking at
 * the place you are already standing in. The level model owns Back's meaning through Escape and
 * nothing orthogonal to it may compete.
 */
import { useCallback, useSyncExternalStore } from "react";

interface Store {
  current: string | null;
  listeners: Set<() => void>;
  param: string;
  storage: string;
  fallback: string;
  values: readonly string[];
  subscribe: (cb: () => void) => () => void;
  snapshot: () => string;
  server: () => string;
}

const STORES = new Map<string, Store>();

function storeFor(
  param: string,
  storage: string,
  values: readonly string[],
  fallback: string,
): Store {
  const hit = STORES.get(param);
  if (hit) return hit;
  const made: Store = {
    current: null,
    listeners: new Set(),
    param,
    storage,
    fallback,
    values,
    subscribe: (cb) => {
      made.listeners.add(cb);
      return () => made.listeners.delete(cb);
    },
    snapshot: () => {
      if (made.current === null) made.current = fromEnvironment(made);
      return made.current;
    },
    server: () => made.fallback,
  };
  STORES.set(param, made);
  return made;
}

function fromEnvironment(store: Store): string {
  const is = (v: unknown): v is string => typeof v === "string" && store.values.includes(v);
  const asked = new URLSearchParams(window.location.search).get(store.param);
  if (is(asked)) return asked;
  try {
    const kept = window.localStorage.getItem(store.storage);
    if (is(kept)) return kept;
  } catch {
    /* Private mode, or storage disabled. The default is a perfectly good answer. */
  }
  return store.fallback;
}

/** Commit a choice. Module-level, so no hook ever receives the thing that gets written to. */
function commit(param: string, next: string): void {
  const store = STORES.get(param);
  if (!store || !store.values.includes(next) || next === store.current) return;
  store.current = next;
  try {
    window.localStorage.setItem(store.storage, next);
  } catch {
    /* see above */
  }
  const url = new URL(window.location.href);
  url.searchParams.set(param, next);
  window.history.replaceState(null, "", url);
  for (const cb of store.listeners) cb();
}

export interface ChoiceOptions<T extends string> {
  /** The query-string parameter. Also the store's identity. */
  param: string;
  /** The `localStorage` key. */
  storage: string;
  values: readonly T[];
  fallback: T;
}

export function useChoice<T extends string>(options: ChoiceOptions<T>): [T, (next: T) => void] {
  const { param, storage, values, fallback } = options;
  const store = storeFor(param, storage, values, fallback);

  const value = useSyncExternalStore(store.subscribe, store.snapshot, store.server) as T;

  const choose = useCallback(
    (next: T) => {
      commit(param, next);
    },
    [param],
  );

  return [value, choose];
}
