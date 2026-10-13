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
