"use client";

/**
 * L0's chrome — the nine-database legend and the caption, under the world.
 *
 * THE PICTURE IS NOT HERE ANY MORE. Round 2's L0 mounted one of three
 * prototypes; round 3 has one scene that every level is looked at through
 * (`World.tsx`), so what is left at this level is the two instruments beside it:
 * the legend, which is the accessible path to the same nine places, and the
 * caption, which reads out whatever the pointer or the focus ring has found.
 *
 * `role="status"` so a screen reader is told what the pointer found without the
 * focus moving, and `aria-live="polite"` so it waits its turn rather than
 * interrupting.
 */

import type { Focus } from "@athena/demo-kit/zoom";

import { databaseSummary } from "./cells";
import { L0Keys } from "./Keys";
import type { L0Cell } from "./contract";

export function L0({
  cells,
  focus,
  hovered,
  onHover,
  onOpen,
}: {
  cells: L0Cell[];
  /** The nav's focus. The legend's recede is `emphasis()` put through the kit's
   *  one mapping rather than a number invented here — see `Keys.tsx`. */
  focus: Focus;
  hovered: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const lit = cells.find((c) => c.id === hovered);

  return (
    <div className="bk-l0" data-hover={hovered !== null}>
      <L0Keys
        cells={cells}
        focus={focus}
        hovered={hovered}
        opening={null}
        onHover={onHover}
        onOpen={onOpen}
      />

      <p className="bk-l0-caption" role="status" aria-live="polite">
        {lit ? (
          databaseSummary(lit)
        ) : (
          <>
            Nine databases in one volume — eight octants and a core —{" "}
            {cells.reduce((n, c) => n + c.tables, 0)} tables between them. One dot is one table:
            graphite carries nothing outstanding, redline deviates from the specification, gold
            stands in an identity pair no rule may resolve. A cell is washed red when any table
            inside it is outstanding. Open one and the camera flies into it.
          </>
        )}
      </p>
    </div>
  );
}
