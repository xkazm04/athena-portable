/**
 * Where an arrow key moves inside a grid of cells.
 *
 * Pure, and in the model rather than beside either caller, because two levels
 * now lay cells out in a grid and both owe the reader the same answer: left and
 * right step one, up and down step a row, Home and End go to the ends, and
 * nothing wraps off the end of the grid. Round 1's review named "no arrow-key
 * navigation at L1" as carried work; this is the half that can be tested without
 * a renderer, and `L1`'s roving tabindex and L0's plate both call it.
 *
 * Returns `null` for a key that is not the grid's business, so the caller knows
 * not to `preventDefault` — a component that swallows every key is one a
 * screen reader cannot be driven through.
 */
export function gridStep(
  key: string,
  at: number,
  count: number,
  cols: number,
): number | null {
  if (count === 0) return null;
  const clamp = (n: number) => Math.min(count - 1, Math.max(0, n));
  switch (key) {
    case "ArrowRight":
      return clamp(at + 1);
    case "ArrowLeft":
      return clamp(at - 1);
    case "ArrowDown":
      return clamp(at + cols);
    case "ArrowUp":
      return clamp(at - cols);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
