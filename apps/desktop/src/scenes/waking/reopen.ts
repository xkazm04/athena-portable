/**
 * Showing the first act again — README section 3.5, ADR 0085 and 0087.
 *
 * "Show the welcome again" must put the first act back on the surface **without touching the rows**:
 * the machine stays set up and onboarded, and the act is only shown. The module bar kept that as
 * React state inside its own hook; the console needs it where the surface can read it, so it is one
 * small store. Waking her clears it (`finish`), and nothing else sets it but the Mind depth.
 */
import { create } from "zustand";

export interface ReopenState {
  on: boolean;
  set: (on: boolean) => void;
}

export const useReopened = create<ReopenState>((set) => ({
  on: false,
  set: (on) => set({ on }),
}));
