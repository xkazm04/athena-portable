/**
 * The halo's producer (lib/halo.ts) — ADR 0027, decisions 2 and 7.
 *
 * The producer against a fake source, a fake command and a fake clock. What is asserted is what
 * the overlays would receive: a change at once, level frames no faster than 30 a second and only
 * while there is a level to show, never the same frame twice, and nothing at all without a shell.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FaceSignal } from "@/avatar/types";
import { startFace, type FaceDeps, type FaceInputs } from "@/lib/face-signal";
import type { HaloSignal } from "@/lib/halo-signal";

import {
  LEVEL_FRAME_MS,
  captionOf,
  signalOf,
  startHalo,
  wireOf,
  type HaloDeps,
  type HaloInputs,
  type HaloOverride,
} from "./halo";

const REST: HaloInputs = { voice: "idle", run: "idle", cards: 0, partial: "", speakingText: "", heard: "" };

function fake(over: Partial<HaloDeps> = {}) {
  let inputs: HaloInputs = { ...REST };
  let override: HaloOverride | null = null;
  let level = 0;
  const listeners = new Set<() => void>();
  const sent: HaloSignal[] = [];
  const deps: HaloDeps = {
    shell: () => true,
    invoke: async (signal) => void sent.push(signal),
    inputs: () => inputs,
    override: () => override,
    subscribe: (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    level: () => level,
    every: (ms, f) => {
      const timer = setInterval(f, ms);
      return () => clearInterval(timer);
    },
    ...over,
  };
  const changed = () => listeners.forEach((f) => f());
  return {
    deps,
    sent,
    listeners,
    set: (next: Partial<HaloInputs>) => {
      inputs = { ...inputs, ...next };
      changed();
    },
    drive: (next: HaloOverride | null) => {
      override = next;
      changed();
    },
    level: (next: number) => {
      level = next;
    },
  };
}

let stop: () => void = () => {};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe("one frame", () => {
  it("follows the shared precedence and spells every absent value", () => {
    expect(signalOf(REST, null, 0.7)).toEqual({ phase: "idle", level: 0, cards: 0, caption: null });
    expect(signalOf({ ...REST, cards: 2 }, null, 0.7)).toEqual({ phase: "gate", level: 0, cards: 2, caption: null });
    expect(signalOf({ ...REST, voice: "speaking", speakingText: "Two are late.", cards: 1 }, null, 0.456)).toEqual({
      phase: "speaking",
      level: 0.46,
      cards: 1,
      caption: { who: "athena", text: "Two are late." },
    });
  });

  it("captions the partial while listening, and the heard words only in the pause after a spoken turn", () => {
    expect(captionOf("listening", { ...REST, voice: "listening", partial: "what is" })).toEqual({ who: "you", text: "what is" });
    expect(captionOf("listening", { ...REST, voice: "listening", partial: "  " })).toBeNull();
    expect(captionOf("thinking", { ...REST, voice: "thinking", heard: "what is overdue" })).toEqual({
      who: "you",
      text: "what is overdue",
    });
    // A typed turn's thinking has no words of the person's to show.
    expect(captionOf("thinking", { ...REST, run: "running", heard: "stale" })).toBeNull();
  });

  it("lets an override win over the stores, but never hides the cards", () => {
    const signal = signalOf({ ...REST, cards: 1 }, { phase: "speaking", caption: { who: "athena", text: "r" } }, 2);
    expect(signal).toEqual({ phase: "speaking", level: 1, cards: 1, caption: { who: "athena", text: "r" } });
  });

  it("goes on the wire with every key present", () => {
    expect(wireOf({ phase: "idle", level: 0, cards: 0, caption: null })).toEqual({
      phase: "idle",
      level: 0,
      cards: 0,
      caption: null,
    });
  });
});

describe("the producer", () => {
  it("sends the resting frame at start and a phase change the moment it happens", () => {
    const f = fake();
    stop = startHalo(f.deps);
    expect(f.sent).toEqual([{ phase: "idle", level: 0, cards: 0, caption: null }]);
    f.set({ voice: "thinking" });
    expect(f.sent.at(-1)?.phase).toBe("thinking");
    f.set({ cards: 1, voice: "idle" });
    expect(f.sent.at(-1)).toEqual({ phase: "gate", level: 0, cards: 1, caption: null });
    expect(f.sent).toHaveLength(3);
  });

  it("drops a frame identical to the last one sent", () => {
    const f = fake();
    stop = startHalo(f.deps);
    f.set({ run: "idle" });
    f.set({ heard: "nothing shown at idle" });
    expect(f.sent).toHaveLength(1);
  });

  it("polls the level no faster than 30 frames a second, only while listening or speaking", () => {
    const f = fake();
    stop = startHalo(f.deps);
    f.set({ voice: "listening" });
    const before = f.sent.length;
    // A level that changes on every read, so dedupe cannot hide the rate.
    let n = 0;
    f.deps.level = () => ((n += 1) % 2 ? 0.2 : 0.8);
    vi.advanceTimersByTime(1000);
    const frames = f.sent.length - before;
    expect(LEVEL_FRAME_MS).toBeGreaterThanOrEqual(1000 / 30);
    expect(frames).toBeGreaterThan(20);
    expect(frames).toBeLessThanOrEqual(30);
    expect(f.sent.slice(before).every((s) => s.phase === "listening")).toBe(true);

    f.set({ voice: "thinking" });
    const resting = f.sent.length;
    vi.advanceTimersByTime(1000);
    expect(f.sent.length).toBe(resting);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sends nothing while a steady level holds steady", () => {
    const f = fake();
    f.level(0.5);
    stop = startHalo(f.deps);
    f.set({ voice: "speaking", speakingText: "Hello." });
    const after = f.sent.length;
    vi.advanceTimersByTime(500);
    expect(f.sent.length).toBe(after);
    expect(f.sent.at(-1)).toEqual({ phase: "speaking", level: 0.5, cards: 0, caption: { who: "athena", text: "Hello." } });
  });

  it("follows an override's level and phase, and gives the halo back when it is cleared", () => {
    const f = fake();
    stop = startHalo(f.deps);
    f.drive({ phase: "speaking", caption: null, level: () => 0.3 });
    expect(f.sent.at(-1)).toEqual({ phase: "speaking", level: 0.3, cards: 0, caption: null });
    f.drive(null);
    expect(f.sent.at(-1)?.phase).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sends a refused frame again on the next change, rather than remembering it as sent", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let refuse = false;
    const f = fake();
    f.deps.invoke = async (signal) => {
      if (refuse) throw new Error("ipc down");
      f.sent.push(signal);
    };
    stop = startHalo(f.deps);
    f.set({ voice: "thinking" });
    refuse = true;
    f.set({ voice: "idle" }); // the frame that hides the halo is refused
    await Promise.resolve();
    await Promise.resolve();
    refuse = false;
    f.set({ heard: "a change that leaves the frame as it was" });
    expect(f.sent.at(-1)?.phase).toBe("idle");
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });

  it("does nothing at all without a shell", () => {
    const f = fake({ shell: () => false });
    stop = startHalo(f.deps);
    f.set({ voice: "listening" });
    vi.advanceTimersByTime(1000);
    expect(f.sent).toEqual([]);
    expect(f.listeners.size).toBe(0);
  });

  it("starts once, and stopping it unsubscribes and stops the loop", () => {
    const f = fake();
    stop = startHalo(f.deps);
    expect(startHalo(f.deps)).toBe(stop);
    f.set({ voice: "listening" });
    stop();
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the tail of her line: the halo follows her audible voice, as her face does", () => {
  /** A fake whose player still sounds the generations in `playing`. */
  function tail() {
    const playing = new Set<number>();
    const f = fake({ sounding: (generation: number) => playing.has(generation) });
    return { ...f, playing };
  }

  /** Speak line 7, then let the store hear `voice.stopped` while the player still sounds it. */
  function speakThenStop(f: ReturnType<typeof tail>) {
    f.level(0.4);
    f.playing.add(7);
    f.set({ voice: "speaking", generation: 7, speakingText: "Two are late." });
    f.set({ voice: "idle", generation: null, speakingText: "" });
  }

  it("[1] sends no idle frame at voice.stopped while the line still sounds: the last frame is speaking at the player's level", () => {
    const f = tail();
    stop = startHalo(f.deps);
    speakThenStop(f);
    const sinceSpeaking = f.sent.slice(f.sent.findIndex((s) => s.phase === "speaking"));
    expect(sinceSpeaking.some((s) => s.phase === "idle")).toBe(false);
    f.level(0.6);
    vi.advanceTimersByTime(LEVEL_FRAME_MS);
    expect(f.sent.at(-1)).toMatchObject({ phase: "speaking", level: 0.6 });
  });

  it("[2] keeps the level loop through the tail, and rests (no timer) the tick the line falls silent", () => {
    const f = tail();
    stop = startHalo(f.deps);
    speakThenStop(f);
    vi.advanceTimersByTime(LEVEL_FRAME_MS * 3);
    expect(vi.getTimerCount()).toBe(1);
    f.playing.delete(7);
    vi.advanceTimersByTime(LEVEL_FRAME_MS);
    expect(f.sent.at(-1)).toEqual({ phase: "idle", level: 0, cards: 0, caption: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[3] a card landing in the tail rides the speaking frame, and the frame after the tail is gate", () => {
    const f = tail();
    stop = startHalo(f.deps);
    speakThenStop(f);
    f.set({ cards: 1 });
    expect(f.sent.at(-1)).toMatchObject({ phase: "speaking", cards: 1 });
    f.playing.delete(7);
    vi.advanceTimersByTime(LEVEL_FRAME_MS);
    expect(f.sent.at(-1)).toEqual({ phase: "gate", level: 0, cards: 1, caption: null });
  });

  it("[4] a press in the tail sends listening at once: listening still wins", () => {
    const f = tail();
    stop = startHalo(f.deps);
    speakThenStop(f);
    const from = f.sent.length - 1;
    f.set({ voice: "listening", partial: "and" });
    // Straight from the tail's speaking to listening, with no idle frame between them.
    expect(f.sent.slice(from).map((s) => s.phase)).toEqual(["speaking", "listening"]);
    expect(f.sent.at(-1)).toMatchObject({ phase: "listening", caption: { who: "you", text: "and" } });
  });

  it("[6] guard: a typed turn with no line ever played sends exactly the frames it always has", () => {
    const f = tail();
    f.playing.add(1);
    stop = startHalo(f.deps);
    f.set({ run: "running" });
    f.set({ run: "idle" });
    expect(f.sent).toEqual([
      { phase: "idle", level: 0, cards: 0, caption: null },
      { phase: "thinking", level: 0, cards: 0, caption: null },
      { phase: "idle", level: 0, cards: 0, caption: null },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[5] parity: one script of store inputs and playback fed to the halo and the face yields one phase sequence", () => {
    let inputs: FaceInputs = { voice: "idle", run: "idle", cards: 0, generation: null };
    const playing = new Set<number>();
    const listeners = new Set<() => void>();
    const subscribe = (f: () => void) => {
      listeners.add(f);
      return () => void listeners.delete(f);
    };
    // The face: a stepped frame loop, no timeline.
    let faceFrame: ((now: number) => boolean | void) | null = null;
    const faceSeen: FaceSignal[] = [];
    const faceDeps: FaceDeps = {
      inputs: () => inputs,
      subscribe,
      level: () => 0.5,
      sample: () => null,
      sounding: (generation) => playing.has(generation),
      timeline: () => null,
      forget: () => {},
      loop: (fn) => {
        faceFrame = fn;
        return () => {
          faceFrame = null;
        };
      },
      now: () => 0,
      local: (signal) => void faceSeen.push(signal),
      mirror: () => {},
    };
    // The halo: the same inputs, its own level timer under the fake clock.
    const haloSent: HaloSignal[] = [];
    const haloDeps: HaloDeps = {
      shell: () => true,
      invoke: async (signal) => void haloSent.push(signal),
      inputs: () => ({ ...inputs, partial: "", speakingText: "", heard: "" }),
      override: () => null,
      subscribe,
      level: () => 0.5,
      sounding: (generation) => playing.has(generation),
      every: (ms, f) => {
        const timer = setInterval(f, ms);
        return () => clearInterval(timer);
      },
    };
    stop = startHalo(haloDeps);
    const stopFace = startFace(faceDeps);
    const tick = () => {
      vi.advanceTimersByTime(LEVEL_FRAME_MS);
      if (faceFrame && faceFrame(0) === false) faceFrame = null;
    };
    const step = (next: Partial<FaceInputs>) => {
      inputs = { ...inputs, ...next };
      listeners.forEach((f) => f());
      tick();
    };
    try {
      playing.add(7);
      step({ voice: "speaking", generation: 7 });
      step({ voice: "idle", generation: null }); // voice.stopped, the line still sounding
      tick();
      step({ cards: 1 });
      playing.delete(7);
      tick();
      step({ voice: "listening" });
      step({ voice: "thinking" });
      step({ voice: "idle", cards: 0 });
    } finally {
      stopFace();
    }
    const collapse = (phases: string[]) => phases.filter((p, i) => i === 0 || p !== phases[i - 1]);
    const face = collapse(faceSeen.map((s) => s.phase));
    const halo = collapse(haloSent.map((s) => s.phase));
    expect(face).toEqual(["idle", "speaking", "gate", "listening", "thinking", "idle"]);
    expect(halo).toEqual(face);
  });
});
