/**
 * The shipped playbooks, once they have been fetched — README section 3.5, ADR 0089.
 *
 * A mirror of `loadShipped()`: `items` is `null` until the set has arrived, which is a different
 * fact from "this build ships none". Loaded once, on first ask, so the first frame never pays for
 * 2.7 MB of JSON; a scene that shows them, and the surface that counts them, ask on mount and read
 * the answer. A failure is kept as a sentence, not thrown, and asking again retries; while the
 * retry is on its way the sentence is cleared, so the set reads as loading rather than as failed.
 */
import { create } from "zustand";

import { loadShipped, type Playbook } from "@/lib/playbooks";

export interface PlaybooksState {
  items: readonly Playbook[] | null;
  problem: string | null;
  /** Fetch the set if it is not here or on its way. Safe to call from any number of places. */
  load: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

export const usePlaybooks = create<PlaybooksState>((set, get) => ({
  items: null,
  problem: null,
  load: () => {
    if (get().items !== null) return Promise.resolve();
    // A retry is on its way again: the old failure is no longer the state, "loading" is.
    if (inflight === null && get().problem !== null) set({ problem: null });
    inflight ??= loadShipped().then(
      (items) => {
        set({ items, problem: null });
        inflight = null;
      },
      (e: unknown) => {
        set({ problem: `the playbooks could not be read: ${String(e)}` });
        inflight = null;
      },
    );
    return inflight;
  },
}));
