/**
 * The four inks the scene draws with, and the generator that scatters its dust.
 *
 * The palette is the `law` direction's and is not renegotiated here: graphite on vellum,
 * redline for a deviation, gold for what only a person may settle. Held apart
 * from the geometry so that changing a colour and changing a shape are two
 * different edits to two different files.
 */

export const GRAPHITE = "#1d1c1a";
export const GRAPHITE_3 = "#7e7a72";
export const REDLINE = "#b3261e";
export const GOLDLINE = "#8a6a12";
/** The paper. A dot or a mote steps back by moving toward it, not by vanishing. */
export const SHEET = "#f4f1e9";

/**
 * A small deterministic generator.
 *
 * The particle field needs scatter, and `Math.random` in a memo is both impure
 * during render and non-reproducible. Seeding it means the dust lands in the
 * same place on every machine and in every screenshot, which is what the rest
 * of this repo already demands of its seeded data.
 */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
