"use client";

/**
 * Arrow keys over the row or grid inside `ref`. Formula §1 rule 3 of the round-3 list (focus
 * follows every level change, not only L2).
 *
 *     const roving = useRoving(laneRef, { selector: "[data-cell]", columns: 6 });
 *     <ul ref={laneRef} {...roving}>…</ul>
 *
 * The index arithmetic is pure in `./roving.ts` and pinned by `test/roving.test.ts`; this is the
 * DOM around it, and it is deliberately the smaller half:
 *
 *   · the collection is queried at KEYDOWN, not captured. A grid whose rows arrive with the data
 *     (which is all of them) would otherwise rove over the list it had at mount.
 *   · the current index is `document.activeElement`'s place in that collection, so this composes
 *     with anything else that moves focus — a click, an agent tool, the focus an overlay handed
 *     back — with no state of its own to get out of step.
 *   · `preventDefault` ONLY when the focus actually moved. An ArrowDown at the bottom edge is
 *     the page's to scroll with; a component that swallows it has made a wall the reader cannot
 *     see and cannot pass.
 */
import { useCallback, type KeyboardEvent, type RefObject } from "react";

import { rovingIndex } from "./roving";

export interface RovingOptions {
  /** What counts as an item, relative to `ref`. e.g. `'[role="row"]'` or `"[data-cell]"`. */
  selector: string;
  /**
   * How many items per row. 1 (the default) is a one-dimensional collection, where both pairs of
   * arrows step by one — a row and a column are the same arithmetic. A number, or a function for
   * a grid whose columns follow the viewport.
   */
  columns?: number | (() => number);
}

export interface Roving {
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export function useRoving(
  ref: RefObject<HTMLElement | null>,
  { selector, columns = 1 }: RovingOptions,
): Roving {
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const root = ref.current;
      if (!root) return;

      const items = [...root.querySelectorAll<HTMLElement>(selector)];
      if (items.length === 0) return;

      const active = typeof document === "undefined" ? null : document.activeElement;
      const current = items.findIndex((item) => item === active || item.contains(active));
      const cols = typeof columns === "function" ? columns() : columns;

      const next = rovingIndex(current, event.key, items.length, cols);
      if (next === null || next === current) return;

      const target = items[next];
      if (!target) return;
      event.preventDefault();
      target.focus({ preventScroll: false });
    },
    [ref, selector, columns],
  );

  return { onKeyDown };
}
