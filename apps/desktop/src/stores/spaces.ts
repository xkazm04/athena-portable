/**
 * The person's projects and the one she is in — README section 3.5, ADR 0225.
 *
 * STUB with the final signatures (spark projects-layer): WP3 implements the bodies — the client,
 * the `active_space_id` settings row, the switch held while a turn runs. The Projects scene (WP4)
 * builds against this shape and nothing else.
 */
import { create } from "zustand";

import type {
  SpaceErased,
  SpaceInput,
  SpaceMemoryKind,
  SpaceMemoryPage,
  SpacePatch,
  SpaceSummary,
} from "@/lib/spaces";
import { CORE } from "@/lib/spaces";

export interface SpacesState {
  spaces: readonly SpaceSummary[];
  /** The first list has answered (even with none). */
  loaded: boolean;
  /** Why the list could not be read, verbatim; "" when it could. */
  problem: string;
  /** The space every turn is filed under; `CORE` ("") for Athena's core. */
  activeId: string;
  /** A switch asked for while a turn runs, applied when it ends; `null` when none waits. */
  pending: string | null;
  load: () => Promise<void>;
  create: (input: SpaceInput) => Promise<SpaceSummary>;
  update: (id: string, patch: SpacePatch) => Promise<SpaceSummary>;
  erase: (id: string) => Promise<SpaceErased>;
  /** Enter a space (or `CORE`). Held in `pending` while a turn runs. */
  setActive: (id: string) => void;
  memory: (id: string, kind?: SpaceMemoryKind) => Promise<SpaceMemoryPage>;
  promote: (id: string, memId: string) => Promise<void>;
  /** Link a chore case to a space, or `CORE` to unlink it. */
  linkCase: (caseId: string, spaceId: string) => Promise<void>;
}

const unbuilt = () => Promise.reject(new Error("spaces store not built yet"));

export const useSpaces = create<SpacesState>((set) => ({
  spaces: [],
  loaded: false,
  problem: "",
  activeId: CORE,
  pending: null,
  load: () => Promise.resolve(),
  create: unbuilt,
  update: unbuilt,
  erase: unbuilt,
  setActive: (id) => set({ activeId: id }),
  memory: unbuilt,
  promote: unbuilt,
  linkCase: unbuilt,
}));

/** The space a summary list names, or null. */
export const spaceById = (spaces: readonly SpaceSummary[], id: string): SpaceSummary | null =>
  spaces.find((s) => s.id === id) ?? null;
