/**
 * Semantic zoom: camera distance IS the level. `docs/kit-camera-contract.md` §3, the pure half.
 *
 * The three-level model has always had two ways in — a click and a tool — and round 2's four
 * apps added a third by hand: get close enough to a group and you are, for every purpose the
 * reader cares about, inside it. Each app then had to decide when "close enough" had happened,
 * and each got the same thing wrong in the same place: a bare threshold flaps. A wheel is not a
 * smooth input, a trackpad emits a dozen events per flick, and a zoom that lands within a
 * rounding error of the band opens and closes the group several times in one gesture — which
 * bumps the nav's flight counter several times, which starts several level changes, each of
 * which aborts the last.
 *
 * So the rule takes the level it is CURRENTLY on as an argument, and the threshold moves with
 * it: a band is harder to cross in the direction that would change the answer. That is the whole
 * of `hysteresis`, and it is why this is a pure function with the current level in its signature
 * rather than a comparison inlined at the call site.
 *
 * `test/semantic.test.ts` pins it; `useSemanticZoom.ts` is the wiring to the nav.
 */
import type { Level } from "./state";

/** The kit's default: a band has to be overshot by 8% before the level follows. */
export const SEMANTIC_HYSTERESIS = 0.08;

/**
 * The level this zoom implies, given the level it is on now.
 *
 * `bands` is `[l1, l2]`: at or above `l1` the camera is inside a group, at or above `l2` inside
 * an item. `hysteresis` is a FRACTION OF THE BAND — 0.08 of a band at 2.4 is ±0.19 — so the same
 * number reads the same on a surface whose bands are 1.5/4 and on one whose bands are 40/400.
 *
 * `current` is the level the nav is on. Passing it is what makes the answer stable; passing 0
 * every time (the default) is a plain threshold and will flap.
 */
export function levelForZoom(
  zoom: number,
  bands: readonly [l1: number, l2: number],
  hysteresis = SEMANTIC_HYSTERESIS,
  current: Level = 0,
): Level {
  const z = Number.isFinite(zoom) ? zoom : 0;
  const [l1, l2] = bands;
  const h = Math.max(0, Number.isFinite(hysteresis) ? hysteresis : 0);

  // Entering a level costs an overshoot; leaving it costs an undershoot. A camera sitting
  // exactly on a band therefore stays where it is, whichever side it arrived from.
  const enter1 = l1 * (1 + h);
  const leave1 = l1 * (1 - h);
  const enter2 = l2 * (1 + h);
  const leave2 = l2 * (1 - h);

  if (current >= 2) {
    if (z >= leave2) return 2;
    return z >= leave1 ? 1 : 0;
  }
  if (current === 1) {
    if (z >= enter2) return 2;
    return z >= leave1 ? 1 : 0;
  }
  if (z >= enter2) return 2;
  return z >= enter1 ? 1 : 0;
}

/**
 * Where the level is in the band, 0..1 — how far the camera has come into the level it is in.
 *
 * Not part of the contract's behaviour and nothing depends on it; it is here because every
 * surface that stages ink against distance (rule 3, box then ink) otherwise re-derives it from
 * the same two numbers, and a second derivation of a band is a second opinion about where a
 * level starts.
 */
export function bandProgress(zoom: number, bands: readonly [number, number], level: Level): number {
  const [l1, l2] = bands;
  const z = Number.isFinite(zoom) ? zoom : 0;
  const span = (lo: number, hi: number) => (hi <= lo ? 1 : Math.min(1, Math.max(0, (z - lo) / (hi - lo))));
  if (level === 0) return span(0, l1);
  if (level === 1) return span(l1, l2);
  return span(l2, l2 * 2);
}
