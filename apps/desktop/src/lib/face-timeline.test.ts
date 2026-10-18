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

  it("reads an unpredicted head or gaze channel as rest, and unpredicted lids as no say (null)", () => {
    addMotion(motion(1, 5000, [{ t: 0, head: { yaw: 3 } }, { t: 1, head: { yaw: 3 } }]));
    expect(motionAt(faceTimeline(), 5500)).toEqual({ yaw: 3, pitch: 0, roll: 0, blink: null, gazeX: 0, gazeY: 0 });
  });
});
