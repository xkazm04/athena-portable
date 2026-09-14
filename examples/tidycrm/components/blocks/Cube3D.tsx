"use client";

/**
 * L0 - one cube, in WebGL, and the move that turns it into the L1 grid.
 *
 * THE CUBE. One object, quartered; a zone is a quadrant of it rather than a
 * diagram of its own. Every dot inside is a RECORD: graphite where nothing is
 * outstanding, redline where it deviates from the specification, gold where it
 * stands in an identity pair no rule may resolve. Most rows carry nothing, so
 * most of the field is quiet and the red is the exception it should be.
 *
 * THE FLATTEN. Opening a zone does not cross-fade a cube into a grid. The other
 * three quadrants drop away, the cube turns to face you, and the chosen
 * quadrant's records leave their 3D lattice and settle into a flat plane,
 * arranged as one cluster per block in the same order the DOM cells are about
 * to use. The dots BECOME the grid. `cube/geometry.ts` holds both positions and
 * `cube/Records.tsx` walks between them.
 *
 * WHY THIS STAYS ON THE CHECK PRINT. The palette and the two-colour markup
 * convention are the `law` direction's and are not renegotiated: graphite on vellum,
 * redline for a deviation, gold for what a person must settle. What changed is
 * the dimension, not the drawing.
 *
 * This file is the VIEW: the canvas, the zone keys beside it and the caption
 * under it. Everything that moves lives in `cube/`.
 */

import { Canvas } from "@react-three/fiber";
import { useMemo, useState, type CSSProperties } from "react";

import { Stat, Stats } from "./Stat";
import { outstandingTone, ZONE_QUADRANT, type BkSheet } from "./model";
import { Particles } from "./cube/Particles";
import { Quadrant } from "./cube/Quadrant";
import { Turntable, useReducedMotionQuery } from "./cube/Turntable";

/**
 * Which quarter of the cube this zone is, drawn at lettering size.
 *
 * The zone keys are a list, and a list has no geometry — so a reader who learns
 * "C is 169 outstanding" from the rail has no way to find C in the cube without
 * hunting for it. Four squares and a filled one is the whole fix, and it is
 * exactly how a drawing border indexes its own zones.
 */
function QuarterGlyph({ id }: { id: string }) {
  const q = ZONE_QUADRANT[id] ?? { sx: -1, sy: 1 };
  return (
    <svg className="bk-quarter" viewBox="0 0 15 15" aria-hidden focusable="false">
      <rect className="bk-quarter-box" x="0.5" y="0.5" width="14" height="14" />
      <path className="bk-quarter-box" d="M7.5 0.5V14.5M0.5 7.5H14.5" />
      <rect
        className="bk-quarter-on"
        x={q.sx < 0 ? 1.5 : 8.5}
        y={q.sy > 0 ? 1.5 : 8.5}
        width="5"
        height="5"
      />
    </svg>
  );
}

export function Cube3D({
  sheet,
  opening,
  out,
  onOpen,
  onFlattened,
}: {
  sheet: BkSheet;
  /** The zone being opened, while its records are still flattening. */
  opening: string | null;
  /**
   * The plate has handed over: the level is L1 and `.bk-cube-hold` is running to
   * `opacity: 0`. The cube is still MOUNTED — the cells are standing on the pose
   * it left and it may not be pulled out from under them — but it has nothing
   * left to say, so it stops rendering. See the `frameloop` note below.
   */
  out: boolean;
  onOpen: (zoneId: string) => void;
  onFlattened: () => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const reduced = useReducedMotionQuery();
  const zoneIds = useMemo(() => sheet.zones.map((z) => z.id), [sheet.zones]);
  const hoveredZone = sheet.zones.find((z) => z.id === hovered);
  /** The worst zone sets the scale the other three are drawn against. */
  const worst = useMemo(
    () => sheet.zones.reduce((n, z) => Math.max(n, z.deviationTotal), 0),
    [sheet.zones],
  );

  return (
    <div
      className="bk-cube-wrap"
      data-opening={opening ?? ""}
      data-hover={hovered !== null && opening === null}
    >
      <div className="bk-cube-canvas">
        <Canvas
          camera={{ position: [0, 0, 12], fov: 30, near: 0.1, far: 100 }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true }}
          /*
           * A SETTLED CUBE COSTS NOTHING, which is what DESIGN §8 always claimed
           * and what this line, with the four `invalidate()` calls in `cube/`,
           * finally makes true.
           *
           * `demand` renders on invalidation only. React's own commits in the
           * scene invalidate, a pointer move over the canvas invalidates
           * (`Turntable.tsx`), and every `useFrame` in `cube/` asks for the next
           * frame while — and only while — it still has somewhere to go. So the
           * cube turns under the cursor, the quadrant weights fade, the dust
           * converges, and then the canvas stops: no frames, no draw calls, no
           * GPU.
           *
           * TWO STATES IT IS DELIBERATELY NOT USED IN.
           *
           *   opening  the flatten is a DURATION the DOM waits on — `onSettled`
           *            is what changes the level — so it runs on a continuous
           *            loop rather than on a chain of invalidations that one
           *            mis-gated branch could break. A stalled flatten is a
           *            reader stranded on the plate.
           *   out      nothing, in the other direction. The canvas stays mounted
           *            through the hand-off because the DOM cells are measured
           *            onto the pose it is holding, but it was still drawing
           *            eight hundred instances behind a layer running to
           *            `opacity: 0`. `demand` holds the last frame instead.
           */
          frameloop={opening !== null && !out ? "always" : "demand"}
          onPointerMissed={() => setHovered(null)}
        >
          <Turntable reduced={reduced} opening={opening}>
            <Particles
              zones={zoneIds}
              reduced={reduced}
              opening={opening}
              hovered={hovered}
            />
            {sheet.zones.map((zone) => (
              <Quadrant
                key={zone.id}
                zone={zone}
                opening={opening}
                hovered={hovered}
                onHover={setHovered}
                onOpen={onOpen}
                onSettled={onFlattened}
              />
            ))}
          </Turntable>
        </Canvas>
      </div>

      {/*
        * The zone buttons are real DOM controls beside the canvas, not labels
        * floating on it. A quadrant is clickable in the scene, but a scene is
        * not reachable by keyboard and a survey plate has to be — so these are
        * the accessible path to the same four places, and they double as the
        * read-out for whichever quadrant the pointer is over.
        */}
      <ul className="bk-zone-keys">
        {sheet.zones.map((zone) => (
          <li key={zone.id}>
            <button
              type="button"
              className="bk-zone-key"
              data-on={hovered === zone.id || opening === zone.id}
              data-worst={zone.deviationTotal === worst}
              /*
               * NOT disabled while a zone is opening. They used to be, for the
               * whole length of the move, which meant the one moment a reader is
               * most likely to want a different zone — they have just watched the
               * wrong quadrant start to come apart — was the one moment the four
               * keys could not be pressed. `openFromPlate` already handles being
               * asked for a second zone mid-flatten, and Escape now abandons the
               * move outright, so there is nothing left for the disable to
               * protect and a control the user can see but not press is the
               * opposite of control.
               */
              onMouseEnter={() => setHovered(zone.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(zone.id)}
              onBlur={() => setHovered(null)}
              onClick={() => onOpen(zone.id)}
            >
              {/* The name leads. The quarter index is an index, so it sits beside the name at
                  lettering weight rather than competing with it, and the span it covers is the
                  quiet line under it. */}
              <span className="bk-zone-key-top">
                <QuarterGlyph id={zone.id} />
                <span className="bk-zone-key-name">Zone {zone.id}</span>
              </span>
              <span className="bk-zone-key-span">{zone.span}</span>

              <Stats className="bk-stats-pair bk-zone-key-figures">
                <Stat value={zone.tables.length} label="blocks" />
                <Stat value={zone.records} label="records" />
                <Stat
                  value={zone.deviationTotal}
                  label="deviations"
                  tone={outstandingTone(zone.deviationTotal)}
                />
                <Stat
                  value={zone.attention}
                  label="pairs awaiting"
                  tone={zone.attention > 0 ? "goldline" : undefined}
                />
              </Stats>

              {/* The frontier, drawn rather than counted: how much of the
                  sheet's outstanding work stands in this zone, against the
                  worst zone's share. Four rules of unequal length rank the
                  zones faster than four numbers do. */}
              <span
                className="bk-zone-key-measure"
                style={
                  { "--of": worst > 0 ? zone.deviationTotal / worst : 0 } as CSSProperties
                }
                aria-hidden
              >
                <i />
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="bk-cube-caption">
        {opening ? (
          `Opening zone ${opening} — the records are settling into their blocks.`
        ) : hoveredZone ? (
          <>
            <b>Zone {hoveredZone.id}</b> · {hoveredZone.span} ·{" "}
            {Math.round(hoveredZone.coverage * 100)}% of its records carry nothing outstanding.
          </>
        ) : (
          "One dot is one record. Graphite carries nothing outstanding; redline deviates from the specification; gold stands in an identity pair no rule may resolve."
        )}
      </p>
    </div>
  );
}
