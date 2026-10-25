/**
 * Her face's producer (lib/face-signal.ts).
 *
 * First against fake inputs and a stepped frame loop: the mirror's rate cap, rest costing no loop,
 * and the tail of a line that is still sounding after its `voice.stopped`. Then the acceptance run:
 * the real voice store fed a fake channel, the real player on a fake audio clock and the real
 * timeline, asserting the signals her window would draw and Main would receive.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FaceSignal } from "@/avatar/types";
import { addVisemes, beginLine, faceTimeline, resetFaceTimelineForTests, type FaceTimeline } from "@/lib/face-timeline";
import { PLAYER_KIT, type SocketLike } from "@/lib/voice";
import { Player } from "@/lib/voice-player";
import { resetRunForTests, useRun } from "@/stores/run";
import { applyVoiceConfig, resetVoiceForTests, setVoiceDeps, useVoice } from "@/stores/voice";

import { MIRROR_PERIOD_MS, VISEME_LEAD_S, liveFaceDeps, startFace, type FaceDeps, type FaceInputs } from "./face-signal";

/** A frame loop the test steps; counts how many times one was started. */
function steppedLoop() {
  let fn: ((now: number) => boolean | void) | null = null;
  let starts = 0;
  return {
    loop: (f: (now: number) => boolean | void) => {
      starts += 1;
      fn = f;
      return () => {
        fn = null;
      };
    },
    running: () => fn !== null,
    starts: () => starts,
    step: (now: number) => {
      if (fn && fn(now) === false) fn = null;
    },
  };
}

let stopFace: (() => void) | null = null;

afterEach(() => {
  stopFace?.();
  stopFace = null;
  resetFaceTimelineForTests();
});

describe("the producer, against fakes", () => {
  function fake() {
    let inputs: FaceInputs = { voice: "idle", run: "idle", cards: 0, generation: null };
    let level = 0.5;
    let sample: number | null = null;
    let sounding = false;
    let line: FaceTimeline | null = null;
    let now = 0;
    const listeners = new Set<() => void>();
    const local: FaceSignal[] = [];
    const mirrored: Array<{ at: number; signal: FaceSignal }> = [];
    const loop = steppedLoop();
    const deps: FaceDeps = {
      inputs: () => inputs,
      subscribe: (f) => {
        listeners.add(f);
        return () => void listeners.delete(f);
      },
      level: () => level,
      sample: () => sample,
      sounding: () => sounding,
      timeline: () => line,
      forget: () => {
        line = null;
      },
      loop: loop.loop,
      now: () => now,
      local: (s) => void local.push(s),
      mirror: (s) => void mirrored.push({ at: now, signal: s }),
    };
    return {
      deps,
      local,
      mirrored,
      loop,
      set: (next: Partial<FaceInputs>) => {
        inputs = { ...inputs, ...next };
        listeners.forEach((f) => f());
      },
      level: (v: number) => {
        level = v;
      },
      sample: (v: number | null) => {
        sample = v;
      },
      sounding: (v: boolean) => {
        sounding = v;
      },
      line: (v: FaceTimeline | null) => {
        line = v;
      },
      /** Step the loop at `at` ms. */
      at: (at: number) => {
        now = at;
        loop.step(at);
      },
      time: (at: number) => {
        now = at;
      },
    };
  }

  it("at rest sends one signal per change and runs no loop", () => {
    const f = fake();
    stopFace = startFace(f.deps);
    expect(f.loop.running()).toBe(false);
    expect(f.mirrored.map((m) => m.signal.phase)).toEqual(["idle"]);
    f.set({ run: "running" });
    f.set({ run: "running" }); // no change, nothing sent
    f.set({ run: "idle", cards: 1 });
    expect(f.mirrored.map((m) => m.signal.phase)).toEqual(["idle", "thinking", "gate"]);
    expect(f.loop.starts()).toBe(0);
    expect(f.mirrored.every((m) => m.signal.level === 0 && m.signal.open === 0)).toBe(true);
  });

  it("feeds her own window every frame but mirrors at most 30 a second, whatever the frame rate", () => {
    for (const frameMs of [1, 1000 / 60, 1000 / 144, 1000 / 30]) {
      const f = fake();
      stopFace = startFace(f.deps);
      f.set({ voice: "speaking", generation: 1 });
      expect(f.loop.running()).toBe(true);
      let frames = 0;
      for (let t = frameMs; t <= 3000; t += frameMs) {
        f.level(0.3 + 0.4 * Math.abs(Math.sin(t / 37))); // a voice: every frame differs
        f.at(t);
        frames += 1;
      }
      const speaking = f.mirrored.filter((m) => m.signal.phase === "speaking");
      expect(f.local.length).toBeGreaterThanOrEqual(frames);
      // Three seconds: at most 3 x 30, plus the frame that opened the window.
      expect(speaking.length).toBeLessThanOrEqual(91);
      // And no two frames closer than half a period, so the cap is not met by bursts.
      for (let i = 1; i < speaking.length; i += 1) {
        expect(speaking[i].at - speaking[i - 1].at).toBeGreaterThanOrEqual(MIRROR_PERIOD_MS / 2 - 2);
      }
      if (frameMs <= 1000 / 60) expect(speaking.length).toBeGreaterThanOrEqual(85);
      stopFace();
      stopFace = null;
    }
  });

  it("sends a phase change at once, even inside the cap, and stops the loop when she stops", () => {
    const f = fake();
    stopFace = startFace(f.deps);
    f.set({ voice: "listening" });
    f.at(10);
    f.time(12);
    f.set({ voice: "thinking" });
    expect(f.mirrored.at(-1)?.signal.phase).toBe("thinking");
    expect(f.mirrored.at(-1)?.at).toBe(12);
    expect(f.loop.running()).toBe(false);
  });

  it("listening carries the microphone's level but never moves her mouth", () => {
    const f = fake();
    stopFace = startFace(f.deps);
    f.set({ voice: "listening" });
    f.level(0.9);
    f.at(20);
    f.at(60);
    const last = f.local.at(-1)!;
    expect(last.phase).toBe("listening");
    expect(last.level).toBe(0.9);
    expect(last.open).toBe(0);
    expect(last.viseme).toBeNull();
  });

  it("keeps speaking through the tail of a stopped line, then rests and forgets it", () => {
    const f = fake();
    stopFace = startFace(f.deps);
    const line: FaceTimeline = { generation: 2, sampleRate: 1000, shapes: [], motion: [], finished: false };
    f.line(line);
    f.set({ voice: "speaking", generation: 2 });
    beginLine(2, 1000);
    f.at(16);
    f.sounding(true);
    line.finished = true;
    f.set({ voice: "idle", generation: null });
    f.at(33);
    expect(f.local.at(-1)?.phase).toBe("speaking");
    expect(f.local.at(-1)?.generation).toBe(2);
    expect(f.loop.running()).toBe(true);
    f.sounding(false);
    f.at(50);
    expect(f.local.at(-1)?.phase).toBe("idle");
    expect(f.mirrored.at(-1)?.signal.phase).toBe("idle");
    expect(f.loop.running()).toBe(false);
  });
});

// -- acceptance ------------------------------------------------------------------------------

describe("acceptance: a fake channel and a fake player clock in, her face out", () => {
  /** A fake socket the store connects through, and a fake audio context whose clock the test moves. */
  function channel() {
    let live: SocketLike | null = null;
    const factory = () => {
      const socket: SocketLike = {
        binaryType: "blob",
        readyState: 1,
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        send: () => {},
        close: () => {
          socket.readyState = 3;
        },
      };
      live = socket;
      queueMicrotask(() => socket.onopen?.({}));
      return socket;
    };
    const ended: Array<() => void> = [];
    const context = {
      state: "running",
      currentTime: 0,
      destination: {},
      createAnalyser: () => ({ fftSize: 32, connect: () => {}, getFloatTimeDomainData: () => {} }),
      createBuffer: (_c: number, length: number, rate: number) => ({ duration: length / rate, copyToChannel: () => {} }),
      createBufferSource: () => {
        const source = {
          buffer: null as unknown,
          connect: () => {},
          start: () => {},
          stop: () => {},
          onended: null as (() => void) | null,
        };
        ended.push(() => source.onended?.());
        return source;
      },
    };
    const player = new Player(() => context as unknown as AudioContext, PLAYER_KIT);
    return {
      factory,
      context,
      player,
      emit: async (event: Record<string, unknown>) => {
        live?.onmessage?.({ data: JSON.stringify(event) });
        await new Promise((r) => setTimeout(r, 0));
      },
      /** One audio frame of `samples` silent samples: four bytes of generation, then PCM16. */
      audio: (generation: number, samples: number) => {
        const bytes = new Uint8Array(4 + samples * 2);
        new DataView(bytes.buffer).setUint32(0, generation, false);
        live?.onmessage?.({ data: bytes.buffer });
      },
      /** Every scheduled source has ended: her voice has stopped sounding. */
      silence: () => ended.splice(0).forEach((f) => f()),
    };
  }

  beforeEach(() => {
    resetVoiceForTests();
    resetRunForTests();
    resetFaceTimelineForTests();
  });

  it("puts the right mouth shape at the right sample, brings the motion in, and clears on a new generation", async () => {
    const ch = channel();
    setVoiceDeps({
      endpoint: () => ({ url: "http://daemon", token: "t" }),
      config: async () => ({ ready: true, reason: null }),
      socket: ch.factory,
      openMic: null,
      player: () => ch.player,
      focused: () => ({ tabId: 1, origin: "https://ledgerbox.local", appId: "ledgerbox" }),
      hostState: () => ({}),
      call: async () => ({ ok: true, output: "" }),
    });
    applyVoiceConfig({ ready: true, reason: null });

    const loop = steppedLoop();
    const local: FaceSignal[] = [];
    const mirrored: FaceSignal[] = [];
    let now = 0;
    stopFace = startFace({
      ...liveFaceDeps(),
      loop: loop.loop,
      now: () => now,
      local: (s) => void local.push(s),
      mirror: (s) => void mirrored.push(s),
    });
    /** One frame with the audio clock at `seconds`. */
    const frame = (seconds: number) => {
      ch.context.currentTime = seconds;
      now = seconds * 1000;
      loop.step(now);
      return local.at(-1)!;
    };

    await useVoice.getState().say("how much is overdue");
    expect(local.at(-1)?.phase).toBe("thinking");
    expect(loop.running()).toBe(false);

    // The line: 1000 Hz so a sample is a millisecond. Two sentences' shapes arrive before audio.
    await ch.emit({ kind: "voice.speaking", generation: 1, text: "Three. Overdue.", truncated: false, sample_rate: 1000 });
    expect(loop.running()).toBe(true);
    await ch.emit({
      kind: "voice.visemes",
      generation: 1,
      sentence: 0,
      offset: 0,
      sample_rate: 1000,
      visemes: [["sil", 0, 100], ["aa", 100, 400], ["PP", 400, 500]],
    });
    await ch.emit({
      kind: "voice.visemes",
      generation: 1,
      sentence: 1,
      offset: 500,
      sample_rate: 1000,
      visemes: [["E", 0, 300], ["sil", 300, 400]],
    });
    for (let i = 0; i < 9; i += 1) ch.audio(1, 100); // nine 0.1 s chunks, back to back from 0

    const lead = Math.round(VISEME_LEAD_S * 1000);
    expect(lead).toBe(35);
    const a = frame(0.05); // sample 50, read at 85
    expect(a).toMatchObject({ phase: "speaking", viseme: "sil", generation: 1, motion: null });
    const b = frame(0.2); // 235
    expect(b.viseme).toBe("aa");
    expect(b.open).toBeGreaterThan(0);
    const c = frame(0.38); // 415: the closure ahead of the sound
    expect(c.viseme).toBe("PP");
    expect(c.open).toBeLessThan(b.open);
    const d = frame(0.6); // 635: the second sentence, by its offset
    expect(d.viseme).toBe("E");
    expect(d.motion).toBeNull();

    // Motion for the second sentence arrives late, as it may; it covers 0.5 .. 0.8 s of the line.
    await ch.emit({
      kind: "voice.motion",
      generation: 1,
      sentence: 1,
      offset: 500,
      fps: 10,
      frames: [
        { t: 0, head: { yaw: 0, pitch: 0, roll: 0 }, eyes: { blinkL: 0, blinkR: 0, gazeX: 0, gazeY: 0 } },
        { t: 0.2, head: { yaw: 4, pitch: -2, roll: 1 }, eyes: { blinkL: 0, blinkR: 0, gazeX: 0.2, gazeY: 0 } },
        { t: 0.3, head: { yaw: 4, pitch: -2, roll: 1 }, eyes: { blinkL: 0, blinkR: 0, gazeX: 0.2, gazeY: 0 } },
      ],
    });
    const e = frame(0.65); // 0.15 s into the track: three quarters of the way to the second frame
    expect(e.motion).toEqual({ yaw: 3, pitch: -1.5, roll: 0.75, blink: 0, gazeX: 0.15, gazeY: 0 });
    expect(frame(0.85).motion).toBeNull(); // past the track: procedural again

    // The daemon has sent the whole line; her voice is still sounding its last chunk.
    await ch.emit({ kind: "voice.stopped", generation: 1, reason: "done" });
    // She is speaking for as long as she is heard: the store goes idle when the player goes quiet.
    expect(useVoice.getState().phase).toBe("speaking");
    const tail = frame(0.86); // 895: the second sentence's closing silence
    expect(tail).toMatchObject({ phase: "speaking", viseme: "sil", generation: 1 });
    ch.silence();
    expect(useVoice.getState().phase).toBe("idle");
    const rest = frame(0.95);
    expect(rest).toMatchObject({ phase: "idle", viseme: null, open: 0, motion: null });
    expect(loop.running()).toBe(false);
    expect(faceTimeline()).toBeNull();
    expect(mirrored.at(-1)).toEqual(rest);

    // The next line: generation 2 has no shapes of its own, so the mouth goes by the level.
    addVisemes({ kind: "voice.visemes", generation: 1, sentence: 0, offset: 0, sample_rate: 1000, visemes: [["aa", 0, 999]] });
    await ch.emit({ kind: "voice.speaking", generation: 2, text: "Done.", truncated: false, sample_rate: 1000 });
    ch.context.currentTime = 1;
    ch.audio(2, 100);
    const next = frame(1.05);
    expect(next).toMatchObject({ phase: "speaking", generation: 2, viseme: null, motion: null });
    expect(faceTimeline()?.generation).toBe(2);
    expect(faceTimeline()?.shapes).toEqual([]);

    // A barge-in clears it at once.
    beginLine(2, 1000);
    addVisemes({ kind: "voice.visemes", generation: 2, sentence: 0, offset: 0, sample_rate: 1000, visemes: [["oh", 0, 100]] });
    expect(frame(1.03).viseme).toBe("oh");
    await ch.emit({ kind: "voice.stopped", generation: 2, reason: "barge_in" });
    expect(faceTimeline()).toBeNull();
    expect(local.at(-1)).toMatchObject({ phase: "idle", viseme: null });
    expect(useRun.getState().cards).toEqual([]);
  });
});
