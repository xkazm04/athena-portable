/**
 * Arrow keys over a row or a grid — the index arithmetic, with no DOM in it.
 *
 * WHY THE KIT OWNS THIS. Round 1 left "no arrow-key navigation at L1" on ledgerbox and tidycrm;
 * round 2 saw ledgerbox write `useRoving(selector)` for the third time in the repo. It is a
 * dozen lines and every copy gets the same two things wrong:
 *
 *   · WRAPPING. A grid that wraps from the end of a row to the start of the next turns
 *     ArrowRight into "next in reading order", which is Tab's job, and leaves a reader who
 *     holds the key down somewhere they did not aim for. The edges here are walls: a key that
 *     cannot move answers the index it was given, the handler does not preventDefault, and the
 *     event goes on to whatever else wants it (a scroll container, the page).
 *   · A COLUMN MOVE OFF THE END. In a 3-column grid of 7 items, ArrowDown from index 6 has no
 *     row below it; clamping to `count − 1` would move the focus sideways, which is not what
 *     the key says. It stays.
 *
 * ONE COLUMN IS ONE DIMENSION. With `columns` at its default of 1 the collection has no second
 * axis to be wrong about, so BOTH pairs of arrows step by one and a caller does not have to
 * declare whether its list is a row or a column — a lane of cards and a table of rows are the
 * same arithmetic, and a reader who reaches for the wrong axis is not punished for it. The walls
 * appear the moment there IS a second axis (`columns > 1`).
 *
 * `Home` / `End` are absolute and always move (unless already there). Nothing else is claimed.
 *
 * `test/roving.test.ts` pins it; `useRoving.ts` is the twenty lines of DOM around it.
 */

/** The keys this rule answers. Anything else is not the grid's business. */
export const ROVING_KEYS = [
  "ArrowRight",
  "ArrowLeft",
  "ArrowDown",
  "ArrowUp",
  "Home",
  "End",
] as const;

export type RovingKey = (typeof ROVING_KEYS)[number];

export const isRovingKey = (key: string): key is RovingKey =>
  (ROVING_KEYS as readonly string[]).includes(key);

/**
 * The index this key moves to, or `null` when the key is not one of ours.
 *
 * The answer may EQUAL `current` — that is an edge, and the caller must not `preventDefault` a
 * key that moved nothing. `columns` is 1 for a row, which makes Left/Right the only keys that
 * move and Up/Down walls, and the caller passes the real column count for a grid.
 *
 * A `current` of −1 (nothing in the collection has focus yet) enters at the first item for a
 * forward key and at the last for a backward one, which is what a reader tabbing into a grid and
 * pressing Up expects.
 */
export function rovingIndex(
  current: number,
  key: string,
  count: number,
  columns = 1,
): number | null {
  if (!isRovingKey(key)) return null;
  const n = Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0));
  if (n === 0) return null;
  const cols = Math.max(1, Math.trunc(Number.isFinite(columns) ? columns : 1));

  if (key === "Home") return 0;
  if (key === "End") return n - 1;

  if (current < 0 || current >= n) {
    return key === "ArrowLeft" || key === "ArrowUp" ? n - 1 : 0;
  }

  switch (key) {
    case "ArrowRight":
      // A row move may not leave the row when there are columns: the last cell of a row is a
      // wall, not a door into the next one.
      return cols > 1 && current % cols === cols - 1 ? current : Math.min(current + 1, n - 1);
    case "ArrowLeft":
      return cols > 1 && current % cols === 0 ? current : Math.max(current - 1, 0);
    case "ArrowDown":
      return current + cols < n ? current + cols : current;
    case "ArrowUp":
      return current - cols >= 0 ? current - cols : current;
    default:
      return null;
  }
}
