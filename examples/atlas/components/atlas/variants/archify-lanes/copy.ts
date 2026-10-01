/**
 * THE THREE FINISHES' COPY — what each one claims on the title band.
 *
 * Pure data, so `test/presets.test.ts` can pin it under `node --test` without loading a `.tsx`.
 * Chrome renders it; Drawing picks a row by `preset`.
 */
export type LanesPreset = "classic" | "signal" | "editorial";

/** Two arrangements of the same twelve boxes: the grid, and the grid with the turn told over it. */
export const VIEWS = ["lanes", "turn"] as const;

export const COPY: Record<LanesPreset, { title: string; subtitle: string }> = {
  classic: {
    title: "The turn, in lanes",
    subtitle:
      "Twelve stops of README §3.2 across four lanes, six columns and three phases. Position is the reading order; there is not one boundary frame.",
  },
  signal: {
    title: "The turn, as a signal",
    subtitle:
      "The same twelve stops. The main path is the brightest thing in the room: a glow, one scan, then the still frame carries the meaning.",
  },
  editorial: {
    title: "How a turn runs",
    subtitle:
      "Twelve sentences, in order, under the diagram they describe. The architecture is an argument; the drawing is the illustration.",
  },
};
