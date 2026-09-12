/**
 * The truncation contract for WebMCP tool results, in one exported helper.
 *
 * CLAUDE.md states the rule once: any bounded output carries `(showing N of M)`. Before this
 * helper every app invented its own shape: `{showing, of, items}` in the kit's own zoom
 * tools, `{matched, showing, results}` in three search helpers, and a pre-formatted English
 * sentence (`showing: "showing 5 of 22 (page 0)"`) in ledgerbox's strip. An agent had to parse
 * English in one app, subtract in another, and read `showing` as an unrelated detail object in a
 * third — and the one question the contract exists to answer, "how many did I not see", had no
 * single answer.
 *
 * So: one envelope everywhere.
 *
 *     { showing: number, of: number, items: T[] }
 *
 * `showing` is always a count, `of` is always the total before the cut, and the difference is what
 * the caller did not see. `boundedPage` adds `page` for a tool that pages rather than heads. Both
 * take an optional projection so a call site never re-slices by hand — hand-slicing is how the
 * count and the cut drifted apart in the first place.
 */

/** A bounded projection of a list, with its own budget stated (design 5.1, CLAUDE.md). */
export interface Bounded<T> {
  /** How many are in `items`. */
  showing: number;
  /** How many there were before the cut. `of - showing` is what the caller did not see. */
  of: number;
  items: T[];
}

/** A page of a bounded projection: the same envelope, plus which page it is. */
export interface BoundedPage<T> extends Bounded<T> {
  /** Zero-based. */
  page: number;
}

/** Default page for a tool result — the same one the kit's zoom tools have always used. */
export const PAGE = 40;

export function bounded<T>(all: readonly T[], page?: number): Bounded<T>;
export function bounded<T, U>(all: readonly T[], page: number, project: (item: T) => U): Bounded<U>;
export function bounded<T, U>(
  all: readonly T[],
  page: number = PAGE,
  project?: (item: T) => U,
): Bounded<T | U> {
  const kept = all.slice(0, Math.max(0, page));
  return { showing: kept.length, of: all.length, items: project ? kept.map(project) : [...kept] };
}

export function boundedPage<T>(all: readonly T[], page: number, size?: number): BoundedPage<T>;
export function boundedPage<T, U>(
  all: readonly T[],
  page: number,
  size: number,
  project: (item: T) => U,
): BoundedPage<U>;
export function boundedPage<T, U>(
  all: readonly T[],
  page: number,
  size: number = PAGE,
  project?: (item: T) => U,
): BoundedPage<T | U> {
  const at = Math.max(0, Math.floor(page) || 0);
  const step = Math.max(1, size);
  const kept = all.slice(at * step, (at + 1) * step);
  return {
    showing: kept.length,
    of: all.length,
    page: at,
    items: project ? kept.map(project) : [...kept],
  };
}
