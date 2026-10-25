/**
 * The projects at a glance, for the first frame — README section 3.1 and 3.5, ADR 0095 and 0225.
 *
 * What the first frame says of the projects is small: their names (the surface's Projects light
 * counts them, the breadcrumb names one), whether the list has answered or could not be read, and
 * which one every turn is filed under. The spaces store (`stores/spaces.ts`) knows all of it, but
 * it brings its client, its settings row and its rules, none of which the first frame needs to
 * draw a count. So the first frame reads this mirror, and the spaces store fills it on every change
 * once it is loaded: after first paint in Main (its root imports it lazily), at once in her window.
 * The same split as the due notice (`stores/due.ts` drawn, `stores/due-poll.ts` loaded later):
 * until the store is loaded the list has not answered, which the light says, and `enter` does
 * nothing, which no first-frame press asks of it.
 */
import { create } from "zustand";

import { CORE } from "@/lib/space-core";

export interface SpacesGlance {
  /** The projects' ids and names, newest first, as `GET /spaces` orders them. */
  names: readonly { id: string; name: string }[];
  /** The list has answered and could be read. */
  loaded: boolean;
  /** The list could not be read (its words are the spaces store's `problem`). */
  failed: boolean;
  /** The space every turn is filed under; `CORE` ("") for Athena's core. */
  activeId: string;
  /** A switch held until the running turn ends; `null` when none waits. */
  pending: string | null;
  /**
   * Enter a space, or `CORE`: the spaces store's `setActive`, held while a turn runs. A no-op until
   * the store is loaded and puts its own here.
   */
  enter: (id: string) => void;
}

export const useSpacesGlance = create<SpacesGlance>(() => ({
  names: [],
  loaded: false,
  failed: false,
  activeId: CORE,
  pending: null,
  enter: () => {},
}));

/** The name of the project the glance is in, "" for core; a project with no name is not core. */
export function activeName(g: Pick<SpacesGlance, "names" | "activeId">): string {
  if (g.activeId === CORE) return "";
  const found = g.names.find((s) => s.id === g.activeId);
  return found ? found.name || "Untitled project" : "";
}
