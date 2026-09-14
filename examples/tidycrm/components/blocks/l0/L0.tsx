"use client";

/**
 * L0 — the whole population, in whichever of the three prototypes is chosen.
 *
 * THE HOST OWNS EVERYTHING THAT IS NOT THE PICTURE: the switcher, the
 * nine-database legend, the caption, and the hover the two of them share. Only
 * one variant is mounted at a time — the other two are not rendered at all, so a
 * WebGL context exists only if a WebGL prototype is on screen.
 *
 * THE CAPTION IS THE READ-OUT. Pointing at a cell in the picture, or reaching a
 * key in the legend, lifts that cell and writes it here in words: how many
 * tables, how many deviations, how many awaiting a person. That is the one place
 * the three prototypes are guaranteed to say the same thing, which is what makes
 * comparing them a judgement about the drawing rather than about the wording.
 *
 * `role="status"` so a screen reader is told what the pointer found without the
 * focus moving, and `aria-live="polite"` so it waits its turn rather than
 * interrupting.
 */

import { useState } from "react";

import type { Focus } from "@athena/demo-kit/zoom";

import { databaseSummary } from "./cells";
import { L0Keys } from "./Keys";
import { L0Switcher } from "./Switcher";
import { Plate } from "./plate/Plate";
import { Slab } from "./slab/Slab";
import { Octants } from "./octants/Octants";
import { useReducedMotionQuery } from "./useReduced";
import { useL0Variant } from "./useVariant";
import type { L0Cell, L0Props } from "./contract";

const PICTURE: Record<string, (props: L0Props) => React.ReactElement> = {
  plate: Plate,
  slab: Slab,
  octants: Octants,
};

export function L0({
  cells,
  focus,
  opening,
  out,
  onOpen,
  onFlattened,
}: {
  cells: L0Cell[];
  /** The nav's focus. The legend's recede is `emphasis()` put through the kit's
   *  one mapping rather than a number invented here — see `Keys.tsx`. */
  focus: Focus;
  opening: string | null;
  out: boolean;
  onOpen: (id: string) => void;
  onFlattened: () => void;
}) {
  const [variant, choose] = useL0Variant();
  const [hovered, setHovered] = useState<string | null>(null);
  const reduced = useReducedMotionQuery();

  const lit = cells.find((c) => c.id === hovered);
  const Picture = PICTURE[variant] ?? Plate;

  const props: L0Props = {
    cells,
    hovered: opening === null ? hovered : null,
    onHover: setHovered,
    onOpen,
    opening,
    out,
    onFlattened,
    reduced,
  };

  return (
    <div
      className="bk-l0"
      data-variant-l0={variant}
      data-hover={hovered !== null && opening === null}
    >
      <L0Switcher variant={variant} onChoose={choose} />

      <div className="bk-l0-body">
        <Picture {...props} />
        <L0Keys
          cells={cells}
          focus={focus}
          hovered={hovered}
          opening={opening}
          onHover={setHovered}
          onOpen={onOpen}
        />
      </div>

      <p className="bk-l0-caption" role="status" aria-live="polite">
        {opening ? (
          `Opening ${opening} — its tables are settling onto the plane.`
        ) : lit ? (
          databaseSummary(lit)
        ) : (
          <>
            Nine databases, {cells.reduce((n, c) => n + c.tables, 0)} tables between them. One dot
            is one table: graphite carries nothing outstanding, redline deviates from the
            specification, gold stands in an identity pair no rule may resolve. A cell is washed
            red when any table inside it is outstanding.
          </>
        )}
      </p>
    </div>
  );
}
