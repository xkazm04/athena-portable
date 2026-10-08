/**
 * docs/demo.md section 5 — one segment's take: its video, its beat offsets, its waiting stretches.
 *
 * Every recorder of the Proving Ground film writes the same shape beside its video, and
 * `scripts/compose.mjs` reads nothing else: `beats` is what `tests/take.spec.ts` has always written
 * to `take.json` (so the journey's own take is a segment take with no `speedups`), and `speedups`
 * are the stretches a live segment spent waiting on something outside the film's control — a
 * Gauntlet call, an engine's turn. Compose plays those faster and labels them on screen; it never
 * speeds up a beat, so no narration is ever laid over footage that was not real time.
 */
import { writeFileSync } from "node:fs";

export interface Mark {
  readonly id: string;
  readonly start_ms: number;
  readonly end_ms: number;
  readonly caption: string;
  readonly error?: string;
}

/** A waiting stretch, in the segment video's own clock, and how much faster compose plays it. */
export interface Speedup {
  readonly start_ms: number;
  readonly end_ms: number;
  readonly factor: number;
  /** What it was waiting for, for the report; the on-screen label is compose's ("sped up 4x"). */
  readonly waiting_for: string;
}

export interface SegmentTake {
  readonly segment: "web" | "proving" | "desktop" | "card";
  /** The video file, relative to the take file. */
  readonly video: string;
  readonly width: number;
  readonly height: number;
  readonly script: string;
  readonly video_offset_uncertainty_ms: number;
  readonly beats: readonly Mark[];
  readonly speedups: readonly Speedup[];
  /** What the recorder saw that the operator should read before composing (a live run's verdict). */
  readonly notes?: readonly string[];
}

/** Waits shorter than this are left at real time: a speed-up label that flashes is noise. */
export const MIN_SPEEDUP_MS = 2_500;

export function writeSegmentTake(path: string, take: SegmentTake): void {
  writeFileSync(path, `${JSON.stringify(take, null, 2)}\n`, "utf8");
}
