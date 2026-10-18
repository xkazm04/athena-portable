/**
 * The face across windows (lib/face.ts): the mirror call, Main's listener and the preview face.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RESTING, type FaceSignal } from "@/avatar/types";

const ipc = vi.hoisted(() => ({
  shell: true,
  call: vi.fn<(command: string, args: unknown) => Promise<unknown>>(async () => undefined),
}));

vi.mock("@/lib/ipc", () => ({
  hasShell: () => ipc.shell,
  call: (command: string, args: unknown) => ipc.call(command, args),
  on: vi.fn(),
}));

import {
  FACE_COMMAND,
  athenaFace,
  createMainFaceSource,
  faceMirrorFailures,
  isFaceSignal,
  localFaceSource,
  previewFaceSource,
  publishLocalFace,
  resetFaceForTests,
  type FaceListen,
} from "./face";
import { createPreviewFaceSource, mouthTarget, smoothOpen } from "./face-preview";

const SPEAKING: FaceSignal = {
  phase: "speaking",
  level: 0.5,
  viseme: "aa",
  open: 0.6,
  motion: { yaw: 1, pitch: 0, roll: 0, blink: 0, gazeX: 0, gazeY: 0 },
  generation: 3,
};

beforeEach(() => {
  resetFaceForTests();
  ipc.shell = true;
  ipc.call.mockReset();
  ipc.call.mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("athenaFace", () => {
  it("calls athena_face with the signal spelled as wire", async () => {
    await athenaFace(SPEAKING);
    expect(ipc.call).toHaveBeenCalledWith(FACE_COMMAND, { signal: SPEAKING });
  });

  it("swallows and counts a refusal, saying it once per run of failures", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    ipc.call.mockRejectedValue(new Error("command athena_face not found"));
    await athenaFace(SPEAKING);
    await athenaFace(SPEAKING);
    expect(faceMirrorFailures()).toBe(2);
    expect(error).toHaveBeenCalledTimes(1);
    ipc.call.mockResolvedValue(undefined);
    await athenaFace(SPEAKING);
    ipc.call.mockRejectedValue(new Error("again"));
    await athenaFace(SPEAKING);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("calls nothing without a shell", async () => {
    ipc.shell = false;
    await athenaFace(SPEAKING);
    expect(ipc.call).not.toHaveBeenCalled();
  });
});

describe("Main's face source", () => {
  function fakeListen() {
    let handler: ((payload: unknown) => void) | null = null;
    const unlisten = vi.fn();
    const listen: FaceListen = vi.fn(async (f) => {
      handler = f;
      return unlisten;
    });
    return { listen, unlisten, emit: (payload: unknown) => handler?.(payload) };
  }

  it("hands each whole signal to every subscriber and ignores malformed payloads", async () => {
    const fake = fakeListen();
    const source = createMainFaceSource(fake.listen);
    const a: FaceSignal[] = [];
    const b: FaceSignal[] = [];
    source.subscribe((s) => a.push(s));
    source.subscribe((s) => b.push(s));
    await Promise.resolve();
    expect(fake.listen).toHaveBeenCalledTimes(1);
    for (const bad of [
      null,
      "speaking",
      { ...SPEAKING, phase: "dancing" },
      { ...SPEAKING, viseme: "zz" },
      { ...SPEAKING, level: "loud" },
      { ...SPEAKING, open: Number.NaN },
      { ...SPEAKING, generation: 1.5 },
      { ...SPEAKING, motion: { yaw: 1 } },
      { phase: "idle", level: 0, open: 0, motion: null, generation: 0 },
    ]) {
      fake.emit(bad);
    }
    expect(a).toEqual([]);
    fake.emit(SPEAKING);
    fake.emit({ ...RESTING });
    expect(a).toEqual([SPEAKING, RESTING]);
    expect(b).toEqual(a);
  });

  it("gives a late subscriber the last signal, and stops listening when the last one leaves", async () => {
    const fake = fakeListen();
    const source = createMainFaceSource(fake.listen);
    const off = source.subscribe(() => {});
    await Promise.resolve();
    fake.emit(SPEAKING);
    const late: FaceSignal[] = [];
    const offLate = source.subscribe((s) => late.push(s));
    expect(late).toEqual([SPEAKING]);
    off();
    expect(fake.unlisten).not.toHaveBeenCalled();
    offLate();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
  });

  it("accepts every shape a well-formed signal takes", () => {
    expect(isFaceSignal(SPEAKING)).toBe(true);
    expect(isFaceSignal(RESTING)).toBe(true);
    expect(isFaceSignal({ ...SPEAKING, viseme: null, motion: null })).toBe(true);
  });
});

describe("the athena window's own source", () => {
  it("hands the producer's signals to every subscriber, the last one first", () => {
    publishLocalFace(SPEAKING);
    const seen: FaceSignal[] = [];
    const off = localFaceSource().subscribe((s) => seen.push(s));
    publishLocalFace(RESTING);
    off();
    publishLocalFace(SPEAKING);
    expect(seen).toEqual([SPEAKING, RESTING]);
  });
});

describe("the preview face", () => {
  /** A preview player with `watch`, and a loop the test steps one frame at a time. */
  function rig(withWatch = true) {
    let playing = false;
    let level = 0;
    const watchers = new Set<() => void>();
    const player = {
      level: () => level,
      playing: () => playing,
      ...(withWatch
        ? {
            watch: (f: () => void) => {
              watchers.add(f);
              return () => void watchers.delete(f);
            },
          }
        : {}),
    };
    let fn: ((time: number, delta: number) => boolean | void) | null = null;
    let starts = 0;
    const loop = (f: (time: number, delta: number) => boolean | void) => {
      starts += 1;
      fn = f;
      return () => {
        fn = null;
      };
    };
    let probe: (() => void) | null = null;
    const every = (_ms: number, f: () => void) => {
      probe = f;
      return () => {
        probe = null;
      };
    };
    const source = createPreviewFaceSource(player, loop, every);
    return {
      source,
      starts: () => starts,
      running: () => fn !== null,
      probing: () => probe !== null,
      probe: () => probe?.(),
      play: (next: boolean) => {
        playing = next;
        watchers.forEach((f) => f());
      },
      level: (next: number) => {
        level = next;
      },
      frame: (delta = 16) => {
        if (fn && fn(0, delta) === false) fn = null;
      },
    };
  }

  it("runs its loop only while the player plays, then sends one idle signal and stops", () => {
    const r = rig();
    const seen: FaceSignal[] = [];
    r.source.subscribe((s) => seen.push(s));
    expect(r.running()).toBe(false);
    r.play(true);
    expect(r.running()).toBe(true);
    r.level(0.8);
    r.frame();
    r.frame();
    expect(seen.map((s) => s.phase)).toEqual(["speaking", "speaking"]);
    expect(seen[1].level).toBe(0.8);
    expect(seen[1].open).toBeGreaterThan(seen[0].open);
    expect(seen[1].viseme).toBeNull();
    expect(seen[1].motion).toBeNull();
    r.play(false);
    r.frame();
    expect(seen.at(-1)).toEqual(RESTING);
    expect(r.running()).toBe(false);
    const count = seen.length;
    r.frame();
    expect(seen.length).toBe(count);
    r.play(true);
    expect(r.starts()).toBe(2);
  });

  it("starts nothing for a player that plays with nobody watching, and stops when the last face leaves", () => {
    const r = rig();
    r.play(true);
    expect(r.running()).toBe(false);
    const off = r.source.subscribe(() => {});
    expect(r.running()).toBe(true);
    off();
    expect(r.running()).toBe(false);
  });

  it("previewFaceSource loads the preview face on first subscribe and hands its signals on", async () => {
    const unwatch = vi.fn();
    const watch = vi.fn(() => unwatch);
    const source = previewFaceSource({ level: () => 0, playing: () => false, watch } as never);
    const off = source.subscribe(() => {});
    expect(watch).not.toHaveBeenCalled();
    await vi.dynamicImportSettled();
    await Promise.resolve();
    expect(watch).toHaveBeenCalledTimes(1);
    off();
    expect(unwatch).toHaveBeenCalledTimes(1);
  });

  it("probes a player without watch while a face subscribes, and only then", () => {
    const r = rig(false);
    const off = r.source.subscribe(() => {});
    expect(r.probing()).toBe(true);
    r.play(true);
    expect(r.running()).toBe(false);
    r.probe();
    expect(r.running()).toBe(true);
    off();
    expect(r.probing()).toBe(false);
    expect(r.running()).toBe(false);
  });
});

describe("the mouth", () => {
  it("opens with the shape, wider when louder, and shuts on a closure", () => {
    expect(mouthTarget("aa", 0.7)).toBeGreaterThan(mouthTarget("aa", 0.3));
    expect(mouthTarget("aa", 0.7)).toBeGreaterThan(mouthTarget("E", 0.7));
    expect(mouthTarget("PP", 1)).toBe(0);
    expect(mouthTarget("sil", 1)).toBe(0);
  });

  it("without a timeline follows the level above a floor", () => {
    expect(mouthTarget(null, 0.1)).toBe(0);
    expect(mouthTarget(null, 0.8)).toBeCloseTo(1);
  });

  it("moves toward the target with inertia, closing faster than it opens", () => {
    const opening = smoothOpen(0, 1, 16);
    const closing = 1 - smoothOpen(1, 0, 16);
    expect(opening).toBeGreaterThan(0);
    expect(opening).toBeLessThan(1);
    expect(closing).toBeGreaterThan(opening);
    expect(smoothOpen(0.4, 1, 0)).toBe(0.4);
  });
});
