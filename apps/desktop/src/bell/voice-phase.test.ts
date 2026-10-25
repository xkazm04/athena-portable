/** Tests for the Bell's mirror of her voice phase — README section 3.1, ADR 0026 and 0087. */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FacePhase, FaceSignal, FaceSource } from "@/avatar/types";

import { FACE_EVENT as LIB_FACE_EVENT } from "@/lib/face";

import { FACE_EVENT, STALE_MS, createVoicePhase } from "./voice-phase";

/** A hand-fed source, as `mainFaceSource()` is fed by `athena:face`. */
function fed() {
  const listeners = new Set<(s: FaceSignal) => void>();
  const source: FaceSource = {
    subscribe(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
  let level = 0;
  const send = (phase: FacePhase) => {
    level = (level + 0.13) % 1;
    for (const l of listeners) l({ phase, level, viseme: null, open: level, motion: null, generation: 1 });
  };
  return { source, send, listeners };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createVoicePhase", () => {
  it("case 6: tells its listener of a phase change only, never of every 30 Hz frame", () => {
    const { source, send } = fed();
    const seen: (FacePhase | null)[] = [];
    createVoicePhase(source, (p) => seen.push(p));
    send("idle");
    for (let i = 0; i < 30; i++) send("speaking");
    send("idle");
    expect(seen).toEqual(["idle", "speaking", "idle"]);
  });

  it("case 7: falls back to no phase when the frames stop while she speaks", () => {
    vi.useFakeTimers();
    const { source, send } = fed();
    const seen: (FacePhase | null)[] = [];
    createVoicePhase(source, (p) => seen.push(p));
    send("speaking");
    vi.advanceTimersByTime(STALE_MS - 1);
    expect(seen).toEqual(["speaking"]);
    vi.advanceTimersByTime(1);
    expect(STALE_MS).toBe(1500);
    expect(seen).toEqual(["speaking", null]);
  });

  it("keeps speaking while frames keep coming, holds a rest phase without a timer, and stops listening", () => {
    vi.useFakeTimers();
    const { source, send, listeners } = fed();
    const seen: (FacePhase | null)[] = [];
    const stop = createVoicePhase(source, (p) => seen.push(p));
    send("speaking");
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(STALE_MS / 2);
      send("speaking");
    }
    send("idle");
    vi.advanceTimersByTime(STALE_MS * 4);
    expect(seen).toEqual(["speaking", "idle"]);
    stop();
    expect(listeners.size).toBe(0);
    send("speaking");
    vi.advanceTimersByTime(STALE_MS * 2);
    expect(seen).toEqual(["speaking", "idle"]);
  });
});

it("listens on the event lib/face names, spelled once more so the first frame does not carry lib/face", () => {
  expect(FACE_EVENT).toBe(LIB_FACE_EVENT);
});
