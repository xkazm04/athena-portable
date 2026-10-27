/**
 * Scripted face signals for the preview harness and the perf gate - ADR 0120, ADR 0087.
 *
 * `calm` is the spike's "calm" line (Kokoro af_heart, "Good morning. I read the three invoices that
 * came in overnight, and two of them are ready for you.") as its viseme timeline, with no audio: the
 * level is made up from each segment's shape so the face moves as it would while she speaks it,
 * and `open` is what the producer's rule (`mouthTarget`) makes of the two.
 * `level` is the same line with no timeline (the level-only drive), `blink` is a neural track that
 * holds her eyes shut, and `none` is a face at rest in whatever phase the page names.
 */
import type { FacePhase, FaceSignal, Viseme } from "./types";
import { floorClosures, mouthTarget, VISEME_SHAPES, VOWELS } from "./visemes";

/** [viseme, start s, end s], ordered and covering 0..CALM_DURATION (the timeline's own numbers). */
export const CALM_VISEMES: readonly (readonly [Viseme, number, number])[] = [
  ["sil", 0.0, 0.069], ["ou", 0.069, 0.2], ["DD", 0.2, 0.275], ["PP", 0.275, 0.325], ["oh", 0.325, 0.425],
  ["RR", 0.425, 0.475], ["nn", 0.475, 0.55], ["ih", 0.55, 0.625], ["kk", 0.625, 0.798], ["sil", 0.798, 0.918],
  ["aa", 0.918, 1.001], ["ih", 1.001, 1.057], ["RR", 1.057, 1.107], ["ih", 1.107, 1.332], ["E", 1.332, 1.382],
  ["sil", 1.382, 1.482], ["TH", 1.482, 1.532], ["ih", 1.532, 1.832], ["nn", 1.832, 1.907], ["FF", 1.907, 1.982],
  ["oh", 1.982, 2.072], ["ih", 2.072, 2.132], ["SS", 2.132, 2.232], ["ih", 2.232, 2.357], ["SS", 2.357, 2.432],
  ["TH", 2.432, 2.557], ["sil", 2.557, 2.607], ["E", 2.607, 2.722], ["ih", 2.722, 2.78], ["PP", 2.78, 2.82],
  ["nn", 2.82, 2.894], ["oh", 2.894, 2.977], ["ou", 2.977, 3.032], ["FF", 3.032, 3.082], ["RR", 3.082, 3.132],
  ["nn", 3.132, 3.182], ["aa", 3.182, 3.302], ["ih", 3.302, 3.382], ["DD", 3.382, 3.488], ["sil", 3.488, 3.529],
  ["DD", 3.529, 3.704], ["ou", 3.704, 3.828], ["FF", 3.828, 3.868], ["E", 3.868, 3.953], ["PP", 3.953, 3.993],
  ["aa", 3.993, 4.054], ["RR", 4.054, 4.154], ["E", 4.154, 4.229], ["DD", 4.229, 4.279], ["ih", 4.279, 4.329],
  ["FF", 4.329, 4.404], ["oh", 4.404, 4.454], ["RR", 4.454, 4.504], ["ih", 4.504, 4.604], ["ou", 4.604, 4.809],
  ["sil", 4.809, 4.855],
];
export const CALM_DURATION = 4.855;

export const FIXTURES = ["none", "calm", "level", "blink"] as const;
export type Fixture = (typeof FIXTURES)[number];

export function isFixture(value: unknown): value is Fixture {
  return typeof value === "string" && (FIXTURES as readonly string[]).includes(value);
}

/** How long a fixture plays, seconds (0: it is a held state, not a line). */
export function fixtureDuration(f: Fixture): number {
  return f === "calm" || f === "level" ? CALM_DURATION : 0;
}

/**
 * The line as her face draws it: the producer holds each closure for `CLOSURE_FLOOR_S`
 * (`lib/face-timeline.ts` floors every sentence it receives), so the harness does too. The raw
 * timeline above is what the daemon sends; the tests feed that to the producer.
 */
const CALM_DRAWN = floorClosures(CALM_VISEMES, 1);

function segmentAt(t: number, line: readonly (readonly [Viseme, number, number])[] = CALM_VISEMES): readonly [Viseme, number, number] | null {
  for (const s of line) if (t >= s[1] && t < s[2]) return s;
  return null;
}

/** A made-up playback level for the line at `t`: vowels loud, consonants softer, silence none. */
export function calmLevel(t: number): number {
  const s = segmentAt(t);
  if (!s || s[0] === "sil") return 0;
  const base = VOWELS.has(s[0]) ? 0.5 + 0.45 * VISEME_SHAPES[s[0]].open : 0.32;
  const within = (t - s[1]) / Math.max(0.01, s[2] - s[1]);
  const swell = Math.sin(Math.PI * Math.min(1, Math.max(0, within)));
  return Math.min(1, base * (0.75 + 0.25 * swell) + 0.04 * Math.sin(t * 23));
}

/** The signal fixture `f` gives at `t` seconds into it; `phase` is the page's phase for held fixtures. */
export function fixtureSignal(f: Fixture, t: number, phase: FacePhase): FaceSignal {
  const rest: FaceSignal = { phase, level: 0, viseme: null, open: 0, motion: null, generation: 0 };
  if (f === "blink") return { ...rest, motion: { yaw: 0, pitch: 0, roll: 0, blink: 1, gazeX: 0, gazeY: 0 } };
  if (f === "none") return rest;
  if (t >= CALM_DURATION) return { ...rest, phase: "idle", generation: 1 };
  const level = calmLevel(t);
  const seg = segmentAt(t, CALM_DRAWN);
  const viseme = f === "calm" && seg ? seg[0] : null;
  return {
    phase: "speaking",
    level,
    viseme,
    // The producer's opening, from the one table (unsmoothed: the face's jaw smooths it).
    open: mouthTarget(viseme, level),
    motion: null,
    generation: 1,
  };
}
