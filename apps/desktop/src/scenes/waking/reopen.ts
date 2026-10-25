/**
 * Showing the first act again — README section 3.5, ADR 0085, 0087 and 0223.
 *
 * "Show the welcome again" must put the first act back on the surface **without touching the rows**:
 * the machine stays set up and onboarded, and the act is only shown. The module bar kept that as
 * React state inside its own hook; the console needs it where the surface can read it, so it is one
 * small store. Waking her clears it (`finish`), and nothing else sets it but the Mind depth.
 *
 * It also keeps the step the person was on (ADR 0223), so leaving the act (Later, the voice studio)
 * and coming back lands where they were. Session-only, as the flag is: a restart forgets both.
 * Showing the act again from Mind walks it from the start, so it puts the step back on Mind.
 */
import { create } from "zustand";

import type { Step } from "./steps";

export interface ReopenState {
  on: boolean;
  set: (on: boolean) => void;
  /** The step the person was last on this session, or null when they have not moved. */
  step: Step | null;
  keep: (step: Step) => void;
}

export const useReopened = create<ReopenState>((set) => ({
  on: false,
  set: (on) => set(on ? { on, step: 0 } : { on }),
  step: null,
  keep: (step) => set({ step }),
}));
