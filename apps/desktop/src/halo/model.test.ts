import { describe, expect, it } from "vitest";

import type { HaloCaption, HaloPhase, HaloSignal } from "@/lib/halo-signal";

import {
  CAPTION_LINGER_MS,
  CAPTION_START,
  captionHideAt,
  captionView,
  parseSignal,
  settled,
  smooth,
  stepCaption,
  type CaptionState,
} from "./model";

const sig = (phase: HaloPhase, caption: HaloCaption | null = null, level = 0): HaloSignal => ({
  phase,
  level,
  cards: 0,
  caption,
});

describe("smooth", () => {
  it("attacks faster than it releases", () => {
    const up = smooth(0, 1, 30);
    const down = 1 - smooth(1, 0, 30);
    expect(up).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(0);
    expect(up).toBeGreaterThan(down * 2);
  });

  it("reaches the target and settles there", () => {
    let v = 0;
    for (let t = 0; t < 500; t += 16) v = smooth(v, 1, 16);
    expect(v).toBe(1);
    for (let t = 0; t < 2000; t += 16) v = smooth(v, 0, 16);
    expect(v).toBe(0);
    expect(settled(v, 0)).toBe(true);
  });

  it("does not move without time", () => {
    expect(smooth(0.3, 1, 0)).toBe(0.3);
    expect(smooth(0.3, 1, -5)).toBe(0.3);
  });
});

describe("parseSignal", () => {
  it("keeps a well-formed frame and clamps the level", () => {
    expect(parseSignal({ phase: "speaking", level: 3, cards: 0, caption: null })).toEqual(
      sig("speaking", null, 1),
    );
  });

  it("drops an unknown phase and an ill-formed caption", () => {
    expect(parseSignal({ phase: "dancing", level: 0 })).toBeNull();
    expect(parseSignal(null)).toBeNull();
    expect(parseSignal({ phase: "idle", level: NaN, caption: { who: "them", text: "x" } })).toEqual(
      sig("idle"),
    );
  });
});

describe("the caption", () => {
  const you: HaloCaption = { who: "you", text: "what is due this week?" };
  const her: HaloCaption = { who: "athena", text: "Two invoices, both from Acme." };

  const run = (steps: [number, HaloSignal][]): CaptionState =>
    steps.reduce((s, [t, signal]) => stepCaption(s, signal, t), CAPTION_START);

  it("shows a new line at once and replaces it on change", () => {
    let s = stepCaption(CAPTION_START, sig("listening", you), 0);
    expect(captionView(s, 0)).toEqual({ who: "you", text: you.text, visible: true });
    s = stepCaption(s, sig("speaking", her), 100);
    expect(captionView(s, 100)).toEqual({ who: "athena", text: her.text, visible: true });
  });

  it("keeps the line while listening, thinking or speaking, whatever the clock says", () => {
    const s = run([
      [0, sig("listening", you)],
      [500, sig("thinking", null)],
      [9000, sig("speaking", null)],
    ]);
    expect(captionView(s, 60_000).visible).toBe(true);
    expect(captionHideAt(s)).toBeNull();
  });

  it("hides the line 4 s after the phase leaves speaking", () => {
    const s = run([
      [0, sig("speaking", her)],
      [10_000, sig("idle", null)],
    ]);
    expect(captionHideAt(s)).toBe(10_000 + CAPTION_LINGER_MS);
    expect(captionView(s, 10_000 + CAPTION_LINGER_MS - 1).visible).toBe(true);
    expect(captionView(s, 10_000 + CAPTION_LINGER_MS)).toMatchObject({ visible: false });
  });

  it("does not restart the timer on idle frames after the reply ended", () => {
    const s = run([
      [0, sig("speaking", her)],
      [1000, sig("gate", null)],
      [3000, sig("gate", null)],
    ]);
    expect(captionHideAt(s)).toBe(1000 + CAPTION_LINGER_MS);
  });

  it("is empty before anyone has said anything", () => {
    expect(captionView(CAPTION_START, 0)).toEqual({ who: null, text: "", visible: false });
  });
});
