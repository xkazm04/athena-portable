/**
 * The rehearsal (lib/halo-rehearsal.ts) — ADR 0027, decision 6.
 *
 * The envelope on its own, then the script under a fake clock: listening while held, thinking
 * for 1.2 s after the release, speaking for 3.5 s with the envelope and the caption, then rest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HaloOverride } from "@/lib/halo";

import { REHEARSAL_CAPTION, SPEAK_MS, THINK_MS, createRehearsal, speechEnvelope } from "./halo-rehearsal";

describe("the speech envelope", () => {
  const samples = Array.from({ length: 350 }, (_, i) => speechEnvelope(i * 10));

  it("stays within 0..1 and is silent before, at and after the ends", () => {
    expect(samples.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(speechEnvelope(0)).toBe(0);
    expect(speechEnvelope(-5)).toBe(0);
    expect(speechEnvelope(SPEAK_MS)).toBe(0);
    expect(speechEnvelope(SPEAK_MS + 100)).toBe(0);
    expect(speechEnvelope(Number.NaN)).toBe(0);
  });

  it("moves like a voice: syllable peaks, troughs, and a breath in every phrase", () => {
    expect(Math.max(...samples)).toBeGreaterThan(0.6);
    const middle = samples.slice(20, 330);
    expect(Math.min(...middle)).toBeLessThan(0.05);
    // About 4.5 syllables a second: count the rises through one half.
    let rises = 0;
    for (let i = 1; i < samples.length; i += 1) if (samples[i - 1] < 0.5 && samples[i] >= 0.5) rises += 1;
    expect(rises).toBeGreaterThanOrEqual(8);
    expect(rises).toBeLessThanOrEqual(20);
    expect(speechEnvelope(1000)).toBe(0);
  });

  it("is pure: the same instant gives the same level", () => {
    expect(speechEnvelope(777)).toBe(speechEnvelope(777));
  });
});

describe("the script", () => {
  let driven: Array<HaloOverride | null>;
  let stops: number;

  const make = (openMic: (() => Promise<{ stop: () => void }>) | null = async () => ({ stop: () => (stops += 1) })) =>
    createRehearsal({
      drive: (o) => driven.push(o),
      openMic,
      now: () => Date.now(),
      setTimeout: (f, ms) => setTimeout(f, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });

  beforeEach(() => {
    vi.useFakeTimers();
    driven = [];
    stops = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("listens while held, thinks 1.2 s, speaks 3.5 s with the caption, then rests", async () => {
    const r = make();
    r.down();
    await vi.advanceTimersByTimeAsync(0);
    expect(driven.at(-1)).toEqual({ phase: "listening", caption: null });
    // The listening override has no level of its own: the halo reads the real microphone.
    expect(driven.at(-1)?.level).toBeUndefined();

    vi.advanceTimersByTime(2000);
    r.up();
    expect(stops).toBe(1);
    expect(driven.at(-1)?.phase).toBe("thinking");

    vi.advanceTimersByTime(THINK_MS - 1);
    expect(driven.at(-1)?.phase).toBe("thinking");
    vi.advanceTimersByTime(1);
    const speaking = driven.at(-1);
    expect(speaking?.phase).toBe("speaking");
    expect(speaking?.caption).toEqual({ who: "athena", text: REHEARSAL_CAPTION });
    vi.advanceTimersByTime(250);
    expect(speaking?.level?.()).toBe(speechEnvelope(250));

    vi.advanceTimersByTime(SPEAK_MS - 251);
    expect(driven.at(-1)?.phase).toBe("speaking");
    vi.advanceTimersByTime(1);
    expect(driven.at(-1)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a press during the reply starts over, and the old script never lands", () => {
    const r = make();
    r.down();
    r.up();
    vi.advanceTimersByTime(THINK_MS + 100);
    r.down();
    expect(driven.at(-1)?.phase).toBe("listening");
    vi.advanceTimersByTime(SPEAK_MS * 2);
    expect(driven.at(-1)?.phase).toBe("listening");
  });

  it("closes a microphone that opens after its release", async () => {
    let open: (s: { stop: () => void }) => void = () => {};
    const r = make(() => new Promise((resolve) => (open = resolve)));
    r.down();
    r.up();
    open({ stop: () => (stops += 1) });
    await vi.advanceTimersByTimeAsync(0);
    expect(stops).toBe(1);
  });

  it("runs on the halo alone with no microphone at all", () => {
    const r = make(null);
    r.down();
    r.up();
    vi.advanceTimersByTime(THINK_MS + SPEAK_MS);
    expect(driven.map((o) => o?.phase ?? null)).toEqual(["listening", "thinking", "speaking", null]);
  });

  it("dispose gives the halo back", () => {
    const r = make();
    r.down();
    r.dispose();
    expect(driven.at(-1)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
