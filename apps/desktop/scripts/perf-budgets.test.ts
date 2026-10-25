/** Tests for the performance budgets' arithmetic — README section 3.1, ADR 0089. */
import { describe, expect, it } from "vitest";

// @ts-expect-error a plain .mjs helper shared with the Node runner, no declarations
import { BUDGETS, judge, percentile } from "./perf-budgets.mjs";

const smooth = {
  frames: Array.from({ length: 60 }, () => 16.7),
  longTasks: [] as number[],
  loopsPerFrame: 1,
  idleFrameRequests: 0,
  idleLongTasks: [] as number[],
};

describe("percentile", () => {
  it("is nearest-rank and zero for nothing", () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([5], 0.5)).toBe(5);
  });
});

describe("judge", () => {
  it("passes a smooth, quiet run", () => {
    const r = judge(smooth);
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("fails slow frames, naming the number", () => {
    const r = judge({ ...smooth, frames: Array.from({ length: 60 }, () => 40) });
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/frame p95 40 ms/);
    expect(r.failures.join(" ")).toMatch(/dropped/);
  });

  it("fails a long task, including one in the idle second", () => {
    expect(judge({ ...smooth, longTasks: [80] }).ok).toBe(false);
    expect(judge({ ...smooth, idleLongTasks: [120] }).ok).toBe(false);
    expect(judge({ ...smooth, longTasks: [BUDGETS.longTaskMs] }).ok).toBe(true);
  });

  it("fails a second frame loop", () => {
    const r = judge({ ...smooth, loopsPerFrame: 2 });
    expect(r.failures.join(" ")).toMatch(/2 frame loops/);
  });

  it("fails a scene that keeps asking for frames while idle", () => {
    expect(judge({ ...smooth, idleFrameRequests: 60 }).ok).toBe(false);
  });

  it("tolerates a few slow frames, not many", () => {
    const frames = [...Array.from({ length: 58 }, () => 16.7), 50, 50];
    expect(judge({ ...smooth, frames }).ok).toBe(true);
    const many = [...Array.from({ length: 50 }, () => 16.7), ...Array.from({ length: 10 }, () => 50)];
    expect(judge({ ...smooth, frames: many }).ok).toBe(false);
  });
});

describe("judge names the step a long task ran under", () => {
  it("reads the step and its offset from an attributed task", () => {
    const r = judge({ ...smooth, longTasks: [{ duration: 54, step: 'click [data-go="notion"]', offset: 250 }] });
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/a 54 ms task at click \[data-go="notion"\] \+250 ms is over the 50 ms budget/);
    expect(r.metrics.longTaskMs).toBe(54);
  });

  it("names the longest task's step, wherever it ran", () => {
    const r = judge({
      ...smooth,
      longTasks: [{ duration: 52, step: "press Escape", offset: 10 }],
      idleLongTasks: [{ duration: 70, step: "the idle second", offset: null }],
    });
    expect(r.failures.join(" ")).toMatch(/a 70 ms task in the idle second is over the 50 ms budget/);
  });

  it("guard: plain-number tasks read as before, and the budgets are unchanged", () => {
    expect(judge({ ...smooth, longTasks: [80] }).failures).toEqual(["a 80 ms task is over the 50 ms budget"]);
    expect(judge({ ...smooth, idleLongTasks: [120] }).failures).toEqual(["a 120 ms task is over the 50 ms budget"]);
    expect(judge({ ...smooth, frames: Array.from({ length: 60 }, () => 40) }).failures).toEqual([
      "frame p95 40 ms is over 20 ms",
      "100% of frames dropped, budget 5%",
    ]);
    expect(judge({ ...smooth, loopsPerFrame: 2 }).failures).toEqual(["2 frame loops ran at once, budget 1"]);
    expect(judge({ ...smooth, idleFrameRequests: 60 }).failures).toEqual(["60 frame requests while idle, budget 2"]);
    expect(judge(smooth)).toEqual({
      ok: true,
      metrics: { frames: 60, frameP95Ms: 16.7, droppedShare: 0, longTaskMs: 0, loopsPerFrame: 1, idleFrameRequests: 0 },
      failures: [],
    });
    expect(BUDGETS).toEqual({ frameP95Ms: 20, droppedShare: 0.05, longTaskMs: 50, loopsPerFrame: 1, idleFrameRequests: 2 });
  });
});
