/**
 * The spoken line's face timeline: its mouth shapes and its motion, held where the producer reads
 * them (ADR on Athena's face).
 *
 * `stores/voice.ts` writes it from `voice.visemes` and `voice.motion`; `lib/face-signal.ts` reads
 * it every frame against the player's clock. It is a module-level holder and never zustand state,
 * for the reason `lib/halo.ts` keeps the level out of a store: it is read 60 times a second and
 * nothing should re-render on it.
 *
 * One line at a time. An event for a newer generation starts a new timeline; one for an older
 * generation, or for a line that was dropped (barge-in), is ignored. A line that ended with
 * `done` is marked finished and kept until its last word has played, because synthesis runs ahead
 * of playback; a dropped line is forgotten at once.
 */
import type { FaceMotion, RigFrame, Viseme } from "@/avatar/types";
import { VISEMES } from "@/avatar/types";
import { floorClosures } from "@/avatar/visemes";
import type { VoiceMotion, VoiceVisemes } from "@/lib/events";

/** One sentence's mouth shapes, in samples from the line's first sample. */
export interface SentenceShapes {
  /** Where its first segment starts and its last one ends. */
  start: number;
  end: number;
  /** `[viseme, start, end]`, ordered, absolute (the event's offset added). */
  segments: Array<[Viseme, number, number]>;
}

/** One sentence's motion track: frames timed in seconds from `offset` (samples). */
export interface SentenceMotion {
  offset: number;
  frames: RigFrame[];
}

export interface FaceTimeline {
  generation: number;
  /** The line's sample rate, from `voice.speaking` or the first `voice.visemes`. */
  sampleRate: number;
  shapes: SentenceShapes[];
  motion: SentenceMotion[];
  /** `voice.stopped` with `done` arrived: forgotten once her voice stops sounding it. */
  finished: boolean;
}

export type { FaceMotion };

let current: FaceTimeline | null = null;
/** Generations dropped by a barge-in and not yet stopped: their late events are ignored. */
const dropped = new Set<number>();

const KNOWN = new Set<string>(VISEMES);

/** What the voice store feeds a line's face timeline with (`stores/voice.ts` `setFaceLineSink`). */
export interface FaceLineSink {
  beginLine(generation: number, sampleRate: number): void;
  addVisemes(event: VoiceVisemes): void;
  addMotion(event: VoiceMotion): void;
  dropLine(generation: number): void;
  stopLine(generation: number, reason: string): void;
  clearLine(generation?: number): void;
}

/** This module as the store's sink. */
export const FACE_LINE_SINK: FaceLineSink = {
  beginLine: (g, r) => beginLine(g, r),
  addVisemes: (e) => addVisemes(e),
  addMotion: (e) => addMotion(e),
  dropLine: (g) => dropLine(g),
  stopLine: (g, r) => stopLine(g, r),
  clearLine: (g) => clearLine(g),
};

/** The line being spoken, or `null`. */
export function faceTimeline(): FaceTimeline | null {
  return current;
}

/** The timeline of `generation`, made if it is newer than the one held; `null` when it is stale. */
function timelineFor(generation: number, sampleRate: number): FaceTimeline | null {
  if (dropped.has(generation)) return null;
  if (current && current.generation === generation) return current;
  if (current && current.generation > generation) return null;
  current = { generation, sampleRate, shapes: [], motion: [], finished: false };
  return current;
}

/** `voice.speaking`: a new line begins (a timeline its visemes may already have started). */
export function beginLine(generation: number, sampleRate: number): void {
  const line = timelineFor(generation, sampleRate);
  if (line) line.sampleRate = sampleRate;
}

/**
 * `voice.visemes`: one sentence's mouth shapes. Unknown shapes read as `sil`. Each closure is held
 * for at least `CLOSURE_FLOOR_S`, borrowed from its neighbours (`floorClosures`), once, here.
 */
export function addVisemes(event: VoiceVisemes): void {
  const line = timelineFor(event.generation, event.sample_rate);
  if (!line || event.visemes.length === 0) return;
  const segments = floorClosures(
    event.visemes.map(([v, start, end]): [Viseme, number, number] => [
      (KNOWN.has(v) ? v : "sil") as Viseme,
      event.offset + start,
      event.offset + end,
    ]),
    event.sample_rate,
  ).map(([v, start, end]): [Viseme, number, number] => [v, Math.round(start), Math.round(end)]);
  const sentence: SentenceShapes = {
    start: segments[0][1],
    end: segments[segments.length - 1][2],
    segments,
  };
  line.shapes = [...line.shapes.filter((s) => s.start !== sentence.start), sentence].sort((a, b) => a.start - b.start);
}

/** `voice.motion`: one sentence's head and eye track. */
export function addMotion(event: VoiceMotion): void {
  // The sample rate is not on `voice.motion`; a line it starts takes `voice.speaking`'s later.
  const line = timelineFor(event.generation, current?.sampleRate ?? 24_000);
  if (!line || event.frames.length === 0) return;
  const frames = [...event.frames].sort((a, b) => a.t - b.t);
  line.motion = [...line.motion.filter((m) => m.offset !== event.offset), { offset: event.offset, frames }].sort(
    (a, b) => a.offset - b.offset,
  );
}

/** A barge-in dropped `generation`: forget it now and ignore what arrives of it until it stops. */
export function dropLine(generation: number): void {
  dropped.add(generation);
  if (current?.generation === generation) current = null;
}

/** `voice.stopped`: `done` keeps the timeline for the tail still playing; anything else forgets it. */
export function stopLine(generation: number, reason: string): void {
  dropped.delete(generation);
  if (current?.generation !== generation) return;
  if (reason === "done") current.finished = true;
  else current = null;
}

/** Forget the line outright: its tail has played, or the socket closed. */
export function clearLine(generation?: number): void {
  if (generation === undefined || current?.generation === generation) current = null;
  if (generation === undefined) dropped.clear();
}

/**
 * The mouth shape at `sample`: the segment covering it, `sil` in a gap inside a sentence or
 * between two received ones, and `null` where no received sentence reaches (before the first,
 * after the last), so the face falls back to the level instead of holding a closed mouth over a
 * sentence whose shapes never came.
 */
export function visemeAt(line: FaceTimeline | null, sample: number): Viseme | null {
  if (!line || line.shapes.length === 0) return null;
  const first = line.shapes[0];
  const last = line.shapes[line.shapes.length - 1];
  if (sample < first.start || sample >= last.end) return null;
  // The last sentence that started by `sample`.
  let lo = 0;
  let hi = line.shapes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (line.shapes[mid].start <= sample) lo = mid;
    else hi = mid - 1;
  }
  const sentence = line.shapes[lo];
  if (sample >= sentence.end) {
    // Between two received sentences: silence, unless a sentence after it is missing its shapes.
    const next = line.shapes[lo + 1];
    return next ? "sil" : null;
  }
  const segments = sentence.segments;
  let a = 0;
  let b = segments.length - 1;
  while (a < b) {
    const mid = (a + b + 1) >> 1;
    if (segments[mid][1] <= sample) a = mid;
    else b = mid - 1;
  }
  const [v, , end] = segments[a];
  return sample < end ? v : "sil";
}

/**
 * The neural pose at `sample`, interpolated between the two frames around it; `null` outside every
 * received track, so the avatar's own procedural motion applies there. A channel the track omits
 * is `null` ("no say": her own motion keeps it), never rest; a track that drives no channel at all
 * is `null` whole.
 */
export function motionAt(line: FaceTimeline | null, sample: number): FaceMotion | null {
  if (!line || line.motion.length === 0 || line.sampleRate <= 0) return null;
  let found: SentenceMotion | null = null;
  for (const track of line.motion) {
    if (track.offset > sample) break;
    found = track;
  }
  if (!found) return null;
  const t = (sample - found.offset) / line.sampleRate;
  const frames = found.frames;
  if (t < frames[0].t || t > frames[frames.length - 1].t) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = poseOf(frames[lo]);
  const b = poseOf(frames[hi]);
  const span = frames[hi].t - frames[lo].t;
  const k = span > 0 ? Math.min(1, Math.max(0, (t - frames[lo].t) / span)) : 0;
  // A channel either frame leaves out has no say between them.
  const mix = (x: number | null, y: number | null) => (x === null || y === null ? null : x + (y - x) * k);
  const pose: FaceMotion = {
    yaw: mix(a.yaw, b.yaw),
    pitch: mix(a.pitch, b.pitch),
    roll: mix(a.roll, b.roll),
    blink: mix(a.blink, b.blink),
    gazeX: mix(a.gazeX, b.gazeX),
    gazeY: mix(a.gazeY, b.gazeY),
  };
  return Object.values(pose).every((v) => v === null) ? null : pose;
}

/** A finite number, or `null`: what the track did not send (or sent broken) is no say, not 0. */
const say = (v: number | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function poseOf(frame: RigFrame): FaceMotion {
  const left = say(frame.eyes?.blinkL);
  const right = say(frame.eyes?.blinkR);
  // One lid driven is both lids: the face draws one blink.
  const blink = left === null ? right : right === null ? left : (left + right) / 2;
  return {
    yaw: say(frame.head?.yaw),
    pitch: say(frame.head?.pitch),
    roll: say(frame.head?.roll),
    blink,
    gazeX: say(frame.eyes?.gazeX),
    gazeY: say(frame.eyes?.gazeY),
  };
}

/** Test seam: forget everything. */
export function resetFaceTimelineForTests(): void {
  current = null;
  dropped.clear();
}
