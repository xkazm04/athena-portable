/**
 * Where an arrow key moves inside a grid of cells.
 *
 * Pure, and in the model rather than beside its caller, so the answer can be
 * pinned without a renderer: left and right step one, up and down step a row
 * (and stay put where there is no row straight above or below), Home and End go
 * to the ends, and nothing wraps off the end of the grid. Round 1's review named
 * "no arrow-key navigation at L1" as carried work; L1's roving focus
 * (`Field.tsx`) is the one caller. Round 2's flat L0 plate called it too, and
 * round 3's cube has no grid of cells to walk.
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
    // Straight down or up, or nowhere: clamping a row step into range moved the focus
    // sideways, so Down then Up did not come back to where it started.
    case "ArrowDown":
      return at + cols < count ? at + cols : at;
    case "ArrowUp":
      return at - cols >= 0 ? at - cols : at;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
