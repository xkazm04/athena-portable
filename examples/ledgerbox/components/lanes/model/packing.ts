/**
 * Greedy interval packing: each mark takes the first sub-row whose last mark
 * ends before this one starts.
 *
 * Runs on the server for L0 and again in the browser for L1, where the same
 * marks are drawn many times wider. One function, so the two levels cannot end
 * up disagreeing about how many rows a lane needs.
 */
import { LANE_GAP, MARK_MAX, MARK_MIN, SPAN } from "./sheet";

/**
 * Greedy interval packing: each mark takes the first sub-row whose last mark
 * ends before this one starts.
 *
 * Runs on the server for L0 and again in the browser for L1, where the same
 * marks are drawn many times wider. One function, so the two levels cannot
 * disagree about which invoices collide.
 */
export function packRows<T extends { x: number }>(
  items: readonly T[],
  widthUnits: (item: T) => number,
): { rows: number; rowOf: Map<T, number> } {
  const ends: number[] = [];
  const rowOf = new Map<T, number>();
  for (const item of [...items].sort((a, b) => a.x - b.x)) {
    const start = item.x * SPAN;
    let row = ends.findIndex((end) => end + LANE_GAP <= start);
    if (row === -1) row = ends.length;
    ends[row] = start + widthUnits(item);
    rowOf.set(item, row);
  }
  return { rows: Math.max(1, ends.length), rowOf };
}

/** L0 mark width in span units, from its 0-1 weight. */
export function markWidth(weight: number): number {
  return MARK_MIN + weight * (MARK_MAX - MARK_MIN);
}
