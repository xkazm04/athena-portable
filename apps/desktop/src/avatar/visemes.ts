/**
 * Mouth shapes for Athena's face - ADR 0120 ("Athena has a face"), the speech drive.
 *
 * The daemon's timeline speaks in the Oculus 15 visemes; a glow form has no lips, only a seam or a
 * hinged aperture, so all it needs from a viseme is how far it opens and whether it is a closure.
 * The figures are the spike's (spikes/avatar/web/src/visemes.js), where they were tuned by eye on
 * both forms. Pure.
 */
import type { Viseme } from "./types";

/** How far a viseme opens (0..1) and how hard it presses closed (0..1, the bilabials). */
export const VISEME_SHAPES: Readonly<Record<Viseme, { open: number; press: number }>> = Object.freeze({
  sil: { open: 0, press: 0 },
  PP: { open: 0, press: 1 },
  FF: { open: 0.12, press: 0 },
  TH: { open: 0.2, press: 0 },
  DD: { open: 0.28, press: 0 },
  kk: { open: 0.33, press: 0 },
  CH: { open: 0.26, press: 0 },
  SS: { open: 0.14, press: 0 },
  nn: { open: 0.2, press: 0 },
  RR: { open: 0.24, press: 0 },
  aa: { open: 0.9, press: 0 },
  E: { open: 0.55, press: 0 },
  ih: { open: 0.38, press: 0 },
  oh: { open: 0.62, press: 0 },
  ou: { open: 0.32, press: 0 },
});

/** The open vowels: a stressed syllable lands on one of these, so a nod may follow it. */
export const VOWELS: ReadonlySet<Viseme> = new Set<Viseme>(["aa", "E", "ih", "oh", "ou"]);

/** The closures: lips together (`PP`) or lip to teeth (`FF`). Speech reads as speech when these are seen. */
export const CLOSURES: ReadonlySet<Viseme> = new Set<Viseme>(["PP", "FF"]);

/** Her speaking voice's usual level on `rms`'s scale: the loudness a shape opens to its table value at. */
export const SPEECH_LEVEL = 0.7;

/** Jaw inertia: opening follows in 22 ms (the spike's), closing faster so a closure reads. */
export const OPEN_TAU_MS = 22;
export const CLOSE_TAU_MS = 12;

/** How long a closure is held at the least, and how much of a 60 Hz frame a neighbour keeps. */
export const CLOSURE_FLOOR_S = 0.06;
export const FRAME_FLOOR_S = 1 / 60;

/**
 * Where the mouth is heading - the one rule, used by the producer (`lib/face-signal.ts`), the
 * preview face and the fixtures: the shape's opening scaled by how loud she is against
 * `SPEECH_LEVEL` (a stressed syllable opens wider, a trailing one less), or, without a timeline,
 * the level alone above a small floor, so the breath between words keeps it shut.
 */
export function mouthTarget(viseme: Viseme | null, level: number): number {
  const lv = clamp01(level);
  if (viseme !== null) return clamp01(VISEME_SHAPES[viseme].open * (0.6 + 0.55 * Math.min(1.2, lv / SPEECH_LEVEL)));
  return clamp01((lv - 0.2) / 0.6);
}

/** One step of the jaw toward `target` over `dtMs`. */
export function smoothOpen(previous: number, target: number, dtMs: number): number {
  if (!(dtMs > 0)) return previous;
  const tau = target < previous ? CLOSE_TAU_MS : OPEN_TAU_MS;
  return previous + (target - previous) * (1 - Math.exp(-Math.min(dtMs, 250) / tau));
}

/**
 * A sentence's segments with every closure held for `CLOSURE_FLOOR_S` where it can be: the time is
 * borrowed from the touching neighbours, each keeping `FRAME_FLOOR_S` (a neighbouring closure its
 * own floor), so the sentence keeps its ends, still tiles, and no sound is merged away. `rate` is
 * units per second (samples: the sample rate). Pure; returns new segments.
 */
export function floorClosures(segments: ReadonlyArray<readonly [Viseme, number, number]>, rate: number): Array<[Viseme, number, number]> {
  const out = segments.map(([v, a, b]): [Viseme, number, number] => [v, a, b]);
  const floor = CLOSURE_FLOOR_S * rate;
  const spare = (s: [Viseme, number, number] | null) =>
    s ? Math.max(0, s[2] - s[1] - (CLOSURES.has(s[0]) ? floor : FRAME_FLOOR_S * rate)) : 0;
  out.forEach((seg, i) => {
    const need = floor - (seg[2] - seg[1]);
    if (!CLOSURES.has(seg[0]) || need <= 0) return;
    const prev = i > 0 && out[i - 1][2] === seg[1] ? out[i - 1] : null;
    const next = i + 1 < out.length && out[i + 1][1] === seg[2] ? out[i + 1] : null;
    let before = Math.min(spare(prev), need / 2);
    const after = Math.min(spare(next), need - before);
    before = Math.min(spare(prev), need - after);
    if (prev) prev[2] = seg[1] = seg[1] - before;
    if (next) next[1] = seg[2] = seg[2] + after;
  });
  return out;
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0;
}
