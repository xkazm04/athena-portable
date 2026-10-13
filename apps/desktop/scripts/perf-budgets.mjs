/**
 * The performance budgets and the arithmetic that judges them — README section 3.1, ADR 0089.
 *
 * Pure: it takes the raw samples a browser run produced and answers pass or fail with the numbers,
 * so the rule is tested without a browser. `perf-gate.mjs` collects the samples; the budgets live
 * here and change only by a later ADR.
 */

export const BUDGETS = {
  /** Frame interval at the 95th percentile while something moves, in ms (a 60 Hz frame is 16.7). */
  frameP95Ms: 20,
  /** Share of frames slower than two vsyncs (33.4 ms) while something moves. */
  droppedShare: 0.05,
  /** The longest main-thread task, in ms. The platform's own long-task line is 50. */
  longTaskMs: 50,
  /** Frame callbacks that may run in one frame: one shared clock, so one. */
  loopsPerFrame: 1,
  /** Frame callbacks the page may ask for during one idle second. A settled scene asks for none. */
  idleFrameRequests: 2,
};

/** The `p`th percentile (0..1) of a list of numbers, by nearest rank. 0 for an empty list. */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank];
}

/**
 * Judge one run.
 *
 * @param {{
 *   frames: number[],            frame intervals while the scenario moved, ms
 *   longTasks: number[],         long-task durations over the whole scenario, ms
 *   loopsPerFrame: number,       the most callbacks that ran in a single frame
 *   idleFrameRequests: number,   frame callbacks requested during the idle second
 *   idleLongTasks: number[],     long tasks during the idle second
 * }} samples
 * @returns {{ ok: boolean, metrics: Record<string, number>, failures: string[] }}
 */
export function judge(samples, budgets = BUDGETS) {
  const frameP95 = percentile(samples.frames, 0.95);
  const dropped =
    samples.frames.length === 0
      ? 0
      : samples.frames.filter((f) => f > 33.4).length / samples.frames.length;
  const longest = Math.max(0, ...samples.longTasks, ...samples.idleLongTasks);

  const metrics = {
    frames: samples.frames.length,
    frameP95Ms: round(frameP95),
    droppedShare: round(dropped),
    longTaskMs: round(longest),
    loopsPerFrame: samples.loopsPerFrame,
    idleFrameRequests: samples.idleFrameRequests,
  };

  const failures = [];
  if (frameP95 > budgets.frameP95Ms)
    failures.push(`frame p95 ${round(frameP95)} ms is over ${budgets.frameP95Ms} ms`);
  if (dropped > budgets.droppedShare)
    failures.push(`${round(dropped * 100)}% of frames dropped, budget ${budgets.droppedShare * 100}%`);
  if (longest > budgets.longTaskMs)
    failures.push(`a ${round(longest)} ms task is over the ${budgets.longTaskMs} ms budget`);
  if (samples.loopsPerFrame > budgets.loopsPerFrame)
    failures.push(`${samples.loopsPerFrame} frame loops ran at once, budget ${budgets.loopsPerFrame}`);
  if (samples.idleFrameRequests > budgets.idleFrameRequests)
    failures.push(
      `${samples.idleFrameRequests} frame requests while idle, budget ${budgets.idleFrameRequests}`,
    );

  return { ok: failures.length === 0, metrics, failures };
}

function round(n) {
  return Math.round(n * 100) / 100;
}
