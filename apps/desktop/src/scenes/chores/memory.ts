/**
 * What the Chores depth remembers across a move — README section 3.5, ADR 0090, 0093, 0096 and 0098.
 *
 * The stage mounts a fresh layer, so a fresh view, at every move (a dive to a topic, a rise back
 * to the catalogue). State kept in the view is therefore gone by the time the person comes back.
 * Three things must outlive that, as the replay's playing flag already does beside `replay.tsx`:
 * the catalogue's filters, order and last pick (coming back from a topic finds them as they
 * were), what the person said at the front door (it opens the studio the verdict leads to), and
 * where each topic page was scrolled (rising from its studio or its replay lands there again).
 */
import { useSyncExternalStore } from "react";

import type { CatalogueState } from "./catalogue";
import { EDGE_ORDER } from "./model";

export interface ChoresMemory {
  catalogue: CatalogueState;
  /** What the person said at the front door, for the one studio it opens (ADR 0098). */
  intro: { id: string; text: string } | null;
}

const fresh = (): ChoresMemory => ({
  catalogue: { category: "all", job: "all", sort: EDGE_ORDER, last: null },
  intro: null,
});

let memory = fresh();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/**
 * Where each topic page was left, by chore id. Written as the page scrolls and read when it
 * mounts, so it is a plain map: no render waits on it.
 */
export const scrolls = new Map<string, number>();

export function rememberCatalogue(patch: Partial<CatalogueState>) {
  memory = { ...memory, catalogue: { ...memory.catalogue, ...patch } };
  emit();
}

export function rememberIntro(intro: ChoresMemory["intro"]) {
  if (memory.intro === intro) return;
  memory = { ...memory, intro };
  emit();
}

/** For tests: start from nothing. */
export function forgetChores() {
  memory = fresh();
  scrolls.clear();
  emit();
}

export function useChoresMemory(): ChoresMemory {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => memory,
    () => memory,
  );
}
