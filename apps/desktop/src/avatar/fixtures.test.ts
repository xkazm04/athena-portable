/**
 * The scripted line - ADR 0120: what the preview harness, the perf gate and the audition draw is
 * the mouth her live line draws, so every closure is held for the producer's floor there too.
 */
import { describe, expect, it } from "vitest";

import { CALM_DURATION, CALM_VISEMES, fixtureSignal } from "./fixtures";
import { CLOSURE_FLOOR_S, CLOSURES } from "./visemes";

/** Each run of one viseme as `fixtureSignal("calm")` draws it, sampled every 0.5 ms. */
function drawnRuns(): Array<{ v: string; s: number }> {
  const step = 0.0005;
  const runs: Array<{ v: string; s: number }> = [];
  for (let i = 0; i * step < CALM_DURATION; i++) {
    const v = fixtureSignal("calm", i * step, "speaking").viseme ?? "none";
    const last = runs[runs.length - 1];
    if (last && last.v === v) last.s += step;
    else runs.push({ v, s: step });
  }
  return runs;
}

describe("the calm line as the harness draws it", () => {
  it("holds every closure for the producer's floor, as her live line does (face-timeline floors them)", () => {
    const closures = drawnRuns().filter((r) => CLOSURES.has(r.v as never));
    expect(closures.length).toBe(CALM_VISEMES.filter(([v]) => CLOSURES.has(v)).length);
    for (const c of closures) expect(c.s).toBeGreaterThanOrEqual(CLOSURE_FLOOR_S - 0.001);
  });

  it("keeps the line's ends and every sound in it", () => {
    expect(fixtureSignal("calm", 0, "speaking").viseme).toBe("sil");
    expect(drawnRuns().map((r) => r.v)).toEqual(CALM_VISEMES.map(([v]) => v));
  });
});
