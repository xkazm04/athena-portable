"use client";

/**
 * THE WILDCARD — this repository's architecture as a **structure matrix**.
 *
 * THE IDEA, and the three sentences it is defended in.
 *
 *   1. A node-link drawing of 68 modules and 120 edges is a drawing of edges nobody traces; a
 *      matrix puts every one of those edges in exactly one place, with no crossing, no routing
 *      and nothing hidden behind anything, so L0 is COMPLETE rather than a summary.
 *   2. Ordering both axes by README §3.1's stack turns the architecture's central claim —
 *      dependencies run down — into a geometric fact: the upper-right triangle is lawful, the
 *      lower-left is hatched and must stay empty, and the field currently says the promise is
 *      kept in a way no arrangement of boxes can, because a matrix gives the ABSENCE of a
 *      relationship a position on the page.
 *   3. It is the one form whose three bands are the same object at three grains — layer blocks,
 *      system blocks, component cells — so semantic zoom is aggregation rather than a change of
 *      drawing, and `poseFor` / `resolve*` are exact inverses by construction because an item is
 *      a coordinate rather than a thing inside a container (rule 16, in its strongest form).
 *
 * WHAT EACH BAND SHOWS. L0: the 6 x 6 grain — the shape of the whole architecture, the hatched
 * empty triangle, the six layer blocks on the diagonal sized by how much code is in them. L1: one
 * layer's row band and column band tinted across the whole field, the 19 x 19 grain, the rails
 * turned to system names. L2: one component's CROSSHAIR — its row is everything it asks of, its
 * column is everything that asks it — with the kind glyph in every mark and the pane for prose.
 *
 * THE SIGNATURE INTERACTION IS THE CROSSHAIR. Point at a mark and both of its modules light: the
 * row of the one that asks and the column of the one asked, one hop and no further. Commit to one
 * and the cross stays, and reading the architecture becomes reading two orthogonal strips instead
 * of following a line through a diagram.
 *
 * WHERE THE RULES ARE:
 *   1/10. one continuous space, so rule 1 inverts and there is no echo.
 *   3.    box, then ink — the crosshair lands, then the kind glyphs; the pane grows, then fills.
 *   4.    one clock — every duration is a `--wc-dur-*` token and no millisecond is typed here.
 *   6.    every flight is `rig.flyTo`; any input cancels it.
 *   8.    reduced motion zeroes the tokens, so the field lands on its final state.
 *   9.    one transform on one element, written outside React; a settled field draws nothing.
 *   11.   the world owns the camera's transform; the pane is MEASURED out of the pin, not morphed.
 *   12.   `zoom` is the level and `pan.x` is pure framing — see `poses.ts`, where the row is the
 *         subject and the column the object.
 *   13.   type is screen-space: the labels are not in the world at all (`Rails.tsx`).
 *   14/16. `poseFor` and `resolve*` are exact inverses, asserted for all 68 components.
 *   15.   a matrix cannot be sparse; what it can be is too fine, and `HOME_MAX` is the answer.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { componentById, systemById } from "@/data";

import type { VariantMeta, VariantProps } from "../contract";
import { Field, type Hover } from "./Field";
import { Legend } from "./Legend";
import { Rail } from "./Rails";
import { MATRIX_COUNTS, idAt, indexOf, layerSpan } from "./matrix";
import { useMatrixCamera } from "./useMatrixCamera";
import "./wildcard.css";

export const meta: VariantMeta = { slug: "wildcard" };

export default function Wildcard({
  nav,
  focus,
  flight,
  lit,
  pane,
  reportOrigin,
}: VariantProps) {
  const camera = useMatrixCamera(nav, flight);
  const [hover, setHover] = useState<Hover>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const pinRef = useRef<HTMLElement | null>(null);

  const onOpenLayer = useCallback(
    (id: string) => {
      if (focus.level >= 1 && focus.group === id) return;
      nav.openGroup(id);
    },
    [focus.group, focus.level, nav],
  );

  const onOpenPart = useCallback(
    (id: string) => {
      const layer = systemById(componentById(id)?.system ?? "")?.layer;
      if (layer) nav.openItem(layer, id);
    },
    [nav],
  );

  /**
   * WHERE THE PANE GROWS FROM (rule 3, rule 11).
   *
   * The pin is the open component's own diagonal cell — the one point on the field that belongs
   * to it alone — and its client rect is honest at any zoom because it is a plain DOM element
   * under one `transform`. Reported when the focus changes AND again whenever the camera comes to
   * rest, because the fly that carries the reader to L2 moves the cell after the pane has opened.
   */
  const anchor = useCallback((el: HTMLElement | null) => {
    pinRef.current = el;
  }, []);

  const report = useCallback(() => {
    const el = pinRef.current;
    if (!el) {
      reportOrigin(null);
      return;
    }
    const box = el.getBoundingClientRect();
    reportOrigin(box.width === 0 && box.height === 0 ? null : box);
  }, [reportOrigin]);

  useEffect(() => {
    if (focus.level !== 2) {
      reportOrigin(null);
      return;
    }
    report();
    return camera.rig.subscribe((_pose, moving) => {
      if (!moving) report();
    });
  }, [camera.rig, focus.item, focus.level, report, reportOrigin]);

  /* ---------------------------------- the keyboard ---------------------------------- */

  const { rig } = camera;
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      /* The canvas itself has focus: the keys are the camera's — arrows pan, +/-/Home zoom. The
         rails own the arrows for everything else, which is where a reader traverses the model. */
      if (event.target === canvasRef.current) rig.bind.onKeyDown(event);
    },
    [rig],
  );

  /* ----------------------------------- the readout ----------------------------------- */

  const reading = useMemo(() => {
    if (hover?.kind === "mark") {
      const from = componentById(idAt(hover.row));
      const to = componentById(idAt(hover.col));
      if (from && to) return { lead: `${from.name} → ${to.name}`, note: from.file };
    }
    if (hover?.kind === "axis") {
      const c = componentById(idAt(hover.index));
      if (c) return { lead: c.name, note: c.file };
    }
    if (focus.level === 2) {
      const c = componentById(focus.item);
      if (c) return { lead: c.name, note: c.file };
    }
    if (focus.level === 1) {
      const span = layerSpan(focus.group);
      if (span) {
        const n = span.systems.length;
        return { lead: span.name, note: `${span.count} modules in ${n} system${n === 1 ? "" : "s"}` };
      }
    }
    return {
      lead: `${MATRIX_COUNTS.axis} modules`,
      note: `${MATRIX_COUNTS.marks} related pairs · ${MATRIX_COUNTS.density}% of the field`,
    };
  }, [focus.group, focus.item, focus.level, hover]);

  const focusRow = focus.level === 2 ? indexOf(focus.item) : -1;

  return (
    <div className="wc-stage" data-band={camera.band} data-level={focus.level} data-driving={camera.driving ?? undefined}>
      <div className="wc-corner">
        <span className="wc-corner-y">a row asks &darr;</span>
        <span className="wc-corner-x">a column is asked &rarr;</span>
      </div>

      <Rail
        axis="col"
        camera={camera}
        band={camera.band}
        focus={focus}
        lit={lit}
        hover={hover}
        onHover={setHover}
        onOpenLayer={onOpenLayer}
        onOpenPart={onOpenPart}
      />
      <Rail
        axis="row"
        camera={camera}
        band={camera.band}
        focus={focus}
        lit={lit}
        hover={hover}
        onHover={setHover}
        onOpenLayer={onOpenLayer}
        onOpenPart={onOpenPart}
      />

      <div
        className="wc-canvas"
        ref={(el) => {
          rig.bind.ref(el);
          canvasRef.current = el;
          camera.measure(el);
        }}
        onPointerDown={rig.bind.onPointerDown}
        onPointerMove={rig.bind.onPointerMove}
        onPointerUp={rig.bind.onPointerUp}
        onPointerCancel={rig.bind.onPointerCancel}
        onWheel={rig.bind.onWheel}
        onKeyDown={onKeyDown}
        tabIndex={rig.bind.tabIndex}
        style={rig.bind.style}
        data-camera={rig.bind["data-camera"]}
        role="application"
        aria-label="The structure matrix. Drag to pan, wheel to zoom; the left rail lists every module."
      >
        <Field
          camera={camera}
          focus={focus}
          lit={lit}
          hover={hover}
          onHover={setHover}
          onOpenPart={onOpenPart}
          anchor={anchor}
        />
      </div>

      <p className="wc-readout" data-level={focus.level}>
        <span className="wc-readout-lead">{reading.lead}</span>
        <span className="wc-readout-note">{reading.note}</span>
      </p>

      <Legend band={camera.band} row={focusRow} />

      <p className="wc-sr" aria-live="polite">
        {focus.level === 2 && focusRow >= 0
          ? `${componentById(focus.item)?.name ?? ""}: row ${focusRow + 1} of ${MATRIX_COUNTS.axis}.`
          : ""}
      </p>

      {pane}
    </div>
  );
}
