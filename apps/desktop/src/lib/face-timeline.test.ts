/**
 * The spoken line's face timeline (lib/face-timeline.ts): which mouth shape covers a sample across
 * sentences, which pose a motion track gives between its frames, and which lines it forgets.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { VoiceMotion, VoiceVisemes } from "@/lib/events";

import {
  addMotion,
  addVisemes,
  beginLine,
  clearLine,
  dropLine,
  faceTimeline,
  motionAt,
  resetFaceTimelineForTests,
  stopLine,
  visemeAt,
} from "./face-timeline";

const visemes = (generation: number, sentence: number, offset: number, segments: Array<[string, number, number]>): VoiceVisemes => ({
  kind: "voice.visemes",
  generation,
  sentence,
  offset,
  sample_rate: 24_000,
  visemes: segments,
});

const motion = (generation: number, offset: number, frames: VoiceMotion["frames"]): VoiceMotion => ({
  kind: "voice.motion",
  generation,
  sentence: 0,
  offset,
  fps: 60,
  frames,
});

beforeEach(() => resetFaceTimelineForTests());

describe("the mouth shape at a sample", () => {
  beforeEach(() => {
    beginLine(4, 24_000);
    addVisemes(visemes(4, 0, 0, [["sil", 0, 100], ["aa", 100, 300], ["PP", 300, 400]]));
    // The second sentence starts 1000 samples into the line; its own times are relative to that.
    addVisemes(visemes(4, 1, 1000, [["E", 0, 200], ["sil", 250, 300]]));
  });

  it("finds the segment of the first sentence", () => {
    const line = faceTimeline();
    expect(visemeAt(line, 0)).toBe("sil");
    expect(visemeAt(line, 150)).toBe("aa");
    expect(visemeAt(line, 300)).toBe("PP");
  });

  it("adds the second sentence's offset to its segments", () => {
    const line = faceTimeline();
    expect(visemeAt(line, 1000)).toBe("E");
    expect(visemeAt(line, 1199)).toBe("E");
    // A gap inside a sentence is silence.
    expect(visemeAt(line, 1220)).toBe("sil");
  });

  it("is silent between two received sentences and null past the last, where the level takes over", () => {
    const line = faceTimeline();
    expect(visemeAt(line, 700)).toBe("sil");
    expect(visemeAt(line, 1300)).toBeNull();
    expect(visemeAt(line, 5000)).toBeNull();
    expect(visemeAt(null, 10)).toBeNull();
  });

  it("reads an unknown shape as silence rather than drawing a guess", () => {
    addVisemes(visemes(4, 2, 2000, [["zz", 0, 100]]));
    expect(visemeAt(faceTimeline(), 2050)).toBe("sil");
  });

  it("keeps sentences ordered whatever order they arrive in", () => {
    beginLine(5, 24_000);
    addVisemes(visemes(5, 1, 500, [["oh", 0, 100]]));
    addVisemes(visemes(5, 0, 0, [["ih", 0, 100]]));
    expect(visemeAt(faceTimeline(), 50)).toBe("ih");
    expect(visemeAt(faceTimeline(), 550)).toBe("oh");
  });
});

describe("which line it holds", () => {
  it("a newer generation replaces the line, and an older one's late events are ignored", () => {
    addVisemes(visemes(1, 0, 0, [["aa", 0, 100]]));
    beginLine(2, 24_000);
    expect(faceTimeline()?.generation).toBe(2);
    expect(faceTimeline()?.shapes).toEqual([]);
    addVisemes(visemes(1, 1, 100, [["E", 0, 100]]));
    expect(faceTimeline()?.generation).toBe(2);
    expect(faceTimeline()?.shapes).toEqual([]);
  });

  it("visemes that arrive before voice.speaking start the line, and voice.speaking keeps them", () => {
    addVisemes(visemes(3, 0, 0, [["aa", 0, 100]]));
    beginLine(3, 22_050);
    expect(faceTimeline()?.sampleRate).toBe(22_050);
    expect(visemeAt(faceTimeline(), 50)).toBe("aa");
  });

  it("a barge-in forgets the line at once and ignores what still arrives of it until it stops", () => {
    beginLine(6, 24_000);
    addVisemes(visemes(6, 0, 0, [["aa", 0, 100]]));
    dropLine(6);
    expect(faceTimeline()).toBeNull();
    addVisemes(visemes(6, 1, 100, [["E", 0, 100]]));
    addMotion(motion(6, 0, [{ t: 0, head: { yaw: 1 } }]));
    expect(faceTimeline()).toBeNull();
    stopLine(6, "barge_in");
    expect(faceTimeline()).toBeNull();
  });

  it("voice.stopped done keeps the line for its tail; barge_in and error forget it", () => {
    beginLine(7, 24_000);
    stopLine(7, "done");
    expect(faceTimeline()?.finished).toBe(true);
    clearLine(7);
    expect(faceTimeline()).toBeNull();
    beginLine(8, 24_000);
    stopLine(8, "error");
    expect(faceTimeline()).toBeNull();
  });

  it("a close forgets everything", () => {
    beginLine(9, 24_000);
    dropLine(10);
    clearLine();
    expect(faceTimeline()).toBeNull();
    beginLine(10, 24_000);
    expect(faceTimeline()?.generation).toBe(10);
  });
});

describe("the pose at a sample", () => {
  beforeEach(() => {
    beginLine(1, 1000);
    addMotion(
      motion(1, 2000, [
        { t: 0, head: { yaw: 0, pitch: 2, roll: 0 }, eyes: { blinkL: 0, blinkR: 0, gazeX: 0, gazeY: 0 } },
        { t: 0.5, head: { yaw: 10, pitch: 4, roll: -2 }, eyes: { blinkL: 1, blinkR: 0.5, gazeX: 0.5, gazeY: -0.5 } },
      ]),
    );
  });

  it("interpolates between the two frames around the instant, timed from the sentence's offset", () => {
    const pose = motionAt(faceTimeline(), 2250); // 0.25 s into the track at 1000 Hz
    expect(pose).toEqual({ yaw: 5, pitch: 3, roll: -1, blink: 0.375, gazeX: 0.25, gazeY: -0.25 });
  });

  it("is null before the track and after its last frame, where procedural motion applies", () => {
    expect(motionAt(faceTimeline(), 1999)).toBeNull();
    expect(motionAt(faceTimeline(), 2501)).toBeNull();
  });

  it("reads every channel a track omits as no say (null), never as rest", () => {
    addMotion(motion(1, 5000, [{ t: 0, head: { yaw: 3 } }, { t: 1, head: { yaw: 3 } }]));
    expect(motionAt(faceTimeline(), 5500)).toEqual({ yaw: 3, pitch: null, roll: null, blink: null, gazeX: null, gazeY: null });
  });

  it("keeps a gaze the track sends as 0: centred on purpose is a say", () => {
    addMotion(motion(1, 5000, [{ t: 0, eyes: { gazeX: 0, gazeY: 0 } }, { t: 1, eyes: { gazeX: 0, gazeY: 0 } }]));
    expect(motionAt(faceTimeline(), 5500)).toEqual({ yaw: null, pitch: null, roll: null, blink: null, gazeX: 0, gazeY: 0 });
  });

  it("is null where the track says nothing at all, so her own motion applies whole", () => {
    addMotion(motion(1, 5000, [{ t: 0, brow: { raise: 0.2 } }, { t: 1, brow: { raise: 0.1 } }]));
    expect(motionAt(faceTimeline(), 5500)).toBeNull();
  });
});

describe("a closure is held long enough to be seen", () => {
  const segmentsOf = () => faceTimeline()!.shapes[0].segments;
  const tiles = (segments: Array<[string, number, number]>) =>
    segments.every((s, i) => s[2] > s[1] && (i === 0 || segments[i - 1][2] === s[1]));

  it("a 40 ms PP grows to 60 ms, borrowing from its neighbours; the sentence keeps its ends and still tiles", () => {
    beginLine(7, 24_000);
    addVisemes(visemes(7, 0, 0, [["aa", 0, 2400], ["PP", 2400, 3360], ["oh", 3360, 6000]]));
    const segments = segmentsOf();
    expect(segments.map((s) => s[0])).toEqual(["aa", "PP", "oh"]);
    const [, pp] = segments;
    expect(pp[2] - pp[1]).toBeGreaterThanOrEqual(1440);
    // Borrowed from both sides: it starts earlier and ends later than it did.
    expect(pp[1]).toBeLessThan(2400);
    expect(pp[2]).toBeGreaterThan(3360);
    expect(segments[0][1]).toBe(0);
    expect(segments[2][2]).toBe(6000);
    expect(faceTimeline()!.shapes[0].start).toBe(0);
    expect(faceTimeline()!.shapes[0].end).toBe(6000);
    expect(tiles(segments)).toBe(true);
  });

  it("neighbours that cannot spare the time keep one 60 Hz frame each; the closure is never merged away", () => {
    const frame = 24_000 / 60; // 16.7 ms
    beginLine(8, 24_000);
    // kk 24 ms, PP 30 ms, DD 24 ms: each neighbour can spare 7.3 ms and no more.
    addVisemes(visemes(8, 0, 0, [["kk", 0, 576], ["PP", 576, 1296], ["DD", 1296, 1872]]));
    let segments = segmentsOf();
    expect(segments.map((s) => s[0])).toEqual(["kk", "PP", "DD"]);
    expect(segments[0][2] - segments[0][1]).toBeGreaterThanOrEqual(frame);
    expect(segments[2][2] - segments[2][1]).toBeGreaterThanOrEqual(frame);
    expect(segments[1][2] - segments[1][1]).toBe(1872 - 2 * frame);
    expect(segments[0][1]).toBe(0);
    expect(segments[2][2]).toBe(1872);
    expect(tiles(segments)).toBe(true);

    // kk 16 ms, PP 30 ms, DD 16 ms: nothing to spare, so nothing moves, and the PP stays.
    beginLine(9, 24_000);
    addVisemes(visemes(9, 0, 0, [["kk", 0, 384], ["PP", 384, 1104], ["DD", 1104, 1488]]));
    segments = segmentsOf();
    expect(segments).toEqual([["kk", 0, 384], ["PP", 384, 1104], ["DD", 1104, 1488]]);
  });
});
