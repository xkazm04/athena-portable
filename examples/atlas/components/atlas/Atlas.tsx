"use client";

/**
 * ATLAS — this repository's architecture as a 2D BLUEPRINT you pan, zoom and re-arrange.
 *
 * ROUND 4, AND WHY. The owner's verdict on round 3, verbatim in spirit: *"designing app
 * architecture as a 'building' is not the right direction; looking at it as a 2D diagram of
 * components in a canvas with switchable views in blueprint structure would fit much better. For
 * 3D we don't have any good practice or idea what to invent; we should not chase it."* So the
 * machine, the three renderers, `three`, the CSS-3D faces, the projection and the travelling light
 * are all gone, and what is left is the thing an architecture drawing has always been: rectangles
 * with ports, orthogonal runs, a ruled sheet, and a legend.
 *
 * FOUR THINGS MAKE THE SURFACE, and each is one module:
 *
 *   the sheet      `canvas/plan.ts` — nineteen blocks sized from the model, laid out four ways.
 *   the camera     `canvas/useCanvasCamera.ts` — the kit's rig and semantic zoom, orthographic,
 *                  which is exactly the arithmetic a drawing wants and was the wrong arithmetic
 *                  for round 3's perspective machine.
 *   the detail     three bands. Far: layers as regions, systems as blocks, system runs. Near:
 *                  the open layer's blocks show their components with component runs and stubs.
 *                  Closest: one component's pane, the only prose in the app.
 *   the views      four arrangements of the SAME blocks. A switch is a layout transition, which is
 *                  this app's one signature motion.
 *
 * WHERE THE FIFTEEN RULES OF THE FORMULA ARE:
 *
 *   1/10. the level you leave carries the camera — inverted, as rule 10 says it inverts: this is
 *         one continuous space, the level you left is still on screen, and there is no echo.
 *   2.    one claimant per shared id — no `layoutId` at all; see rule 11.
 *   3.    box, then ink — the pane grows, then fills; the parts arrive after the band has changed.
 *   4.    one clock — `motion.ts`, five tokens, no millisecond typed in JS.
 *   5.    an overlay owns its Escape — `useOverlayEscape` in the pane.
 *   6.    a move in flight is abortable — every flight is `rig.flyTo`; any input cancels it.
 *   7.    presence comes from the model — `presenceStyle` in `canvas/Block.tsx`.
 *   8.    reduced motion lands on final state — durations go to zero in the token file.
 *   9.    what is no longer seen stops costing — the camera's loop stops when the pose settles,
 *         and the only thing that ever moves is one `transform` on one element.
 *   11.   one owner of a transform — the world owns the camera's, a block owns its position's,
 *         and the pane is MEASURED out of a part rather than morphed through it.
 *   12.   a pose is where you stand and where you look — `zoom` is the level, `pan` the framing,
 *         and there is no snap list anywhere in this app.
 *   13.   type is screen-space, quantised — `--at-cs` in `canvas/Canvas.tsx`.
 *   14.   `poseFor` and `resolveGroup` are exact inverses — `canvas/poses.ts`, asserted in the test.
 *   15.   a place needs a floor size — `homeZoom` is clamped, so a 2560 display gets more sheet
 *         rather than a bigger sheet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import { useLevelFlight, useZoomNav, type Focus } from "@athena/demo-kit/zoom";

import {
  COUNTS,
  componentById,
  highlightIds,
  layerById,
  lensFor,
  systemById,
  type Lens,
} from "@/data";

import { Mast } from "./Mast";
import { useAtlasMotion } from "./motion";
import { Claims } from "./chrome/Claims";
import { Legend } from "./chrome/Legend";
import { TurnBar } from "./chrome/TurnBar";
import { Pane } from "./pane/Pane";
import { Canvas } from "./canvas/Canvas";
import { VIEW_META, type ViewId } from "./canvas/plan";
import { TURN, stopAt } from "./canvas/turn";
import { useCanvasCamera } from "./canvas/useCanvasCamera";
import { useView } from "./canvas/useView";
import { AtlasTools } from "./tools/AtlasTools";

export function Atlas() {
  const nav = useZoomNav();
  const m = useAtlasMotion();
  /* The flight is handed to `useSemanticZoom`, which claims it on every camera-driven level
     change and settles it when the fly lands — so "a move is in flight" is true for a wheel
     exactly as it is for a click, and rule 6's abort works the same for both. */
  const flight = useLevelFlight(nav, { fallbackToken: "--at-dur-move" });

  const [view, chooseView] = useView();
  const [hover, setHover] = useState<string | null>(null);
  const [stop, setStopAt] = useState(0);
  const [runsHidden, setRunsHidden] = useState(true);

  /* ------------------------------------- the lens ------------------------------------- */

  const [lensId, setLensId] = useState<string | null>(null);
  const lens: Lens = useMemo(() => lensFor(lensId), [lensId]);
  const setLens = useCallback((id: string | null) => {
    setLensId((current) => (current === id ? null : id));
  }, []);

  /* `nav.highlight` is rebuilt on every nav state change, so it is read through a ref: this
     effect must run when the LENS changes and not when the nav does. (KIT-GAPS round 2 #6, open
     in rounds 3 and 4.) */
  const highlight = useRef(nav.highlight);
  useEffect(() => {
    highlight.current = nav.highlight;
  });
  useEffect(() => {
    highlight.current(highlightIds(lensFor(lensId)));
  }, [lensId]);

  /* ------------------------------------ the camera ------------------------------------ */

  const focus: Focus = nav.state.focus;
  const camera = useCanvasCamera(nav, flight, view);

  /* A view switch is not a level change: the reader keeps their focus and the blocks travel. The
     camera re-frames the same focus in the new arrangement, which is a fly and not a cut. */
  const setView = useCallback(
    (next: ViewId) => {
      if (next === view) return;
      chooseView(next);
      camera.refit(next);
    },
    [camera, chooseView, view],
  );

  /* -------------------------------------- opening -------------------------------------- */

  const onOpenLayer = useCallback(
    (id: string) => {
      if (nav.state.focus.level >= 1 && nav.state.focus.group === id) return;
      nav.openGroup(id);
    },
    [nav],
  );

  const onOpenPart = useCallback(
    (id: string) => {
      const layer = systemById(componentById(id)?.system ?? "")?.layer;
      if (layer) nav.openItem(layer, id);
    },
    [nav],
  );

  const setStop = useCallback((index: number) => {
    setStopAt(Math.min(TURN.length - 1, Math.max(0, index)));
  }, []);

  /**
   * Where the open part is on screen, so the pane can rise out of it.
   *
   * A FUNCTION, not a piece of state, and the pane calls it once in a layout effect: measuring the
   * DOM in a render is a read of a mutable system React does not own, and turning that into
   * `setState` inside an effect is the cascading-render shape the compiler correctly refuses.
   *
   * On a 2D sheet this is an honest `getBoundingClientRect` again — round 3 had to project a point
   * through the camera because the part was a `matrix3d` face whose client rect was the bounding
   * box of a projected quadrilateral.
   */
  const open = componentById(focus.item);
  const measureOrigin = useCallback((): { x: number; y: number } | null => {
    const id = nav.state.focus.item;
    if (!id) return null;
    const el = document.querySelector<HTMLElement>(`[data-component="${id}"]`);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return null;
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, [nav]);

  /* ------------------------------------- the mount ------------------------------------- */

  const layer = layerById(focus.group);
  const here = stopAt(stop);
  const hovered = componentById(hover) ?? systemById(hover ?? "");

  return (
    <MotionConfig reducedMotion="user">
      <AtlasTools
        nav={nav}
        lens={lens}
        lensId={lensId}
        setLens={setLens}
        view={view}
        setView={setView}
        stop={stop}
        setStop={setStop}
      />
      <div
        className="at-app"
        data-level={focus.level}
        data-view={view}
        data-band={camera.band}
        data-reduced={m.reduced ? "" : undefined}
      >
        <Mast nav={nav} lens={lens} setLens={setLens} counts={COUNTS} view={view} setView={setView} />

        <div className="at-body">
          <Claims lens={lens} setLens={setLens} />

          <main className="at-stage">
            <Canvas
              view={view}
              camera={camera}
              focus={focus}
              lens={lens}
              stop={stop}
              runsHidden={view === "packages" ? runsHidden : false}
              onOpenLayer={onOpenLayer}
              onOpenPart={onOpenPart}
              onHover={setHover}
            />

            {/* The reading line: what the camera is looking at, in words, for the reader who
                needs the name of the thing under the pointer and for the capture to assert on. */}
            <p className="at-readout" data-level={focus.level}>
              <span className="at-readout-level">
                {focus.level === 0
                  ? VIEW_META[view].label
                  : focus.level === 1
                    ? layer?.name
                    : open?.name}
              </span>
              <span className="at-label">
                {focus.level === 0
                  ? VIEW_META[view].note
                  : focus.level === 1
                    ? layer?.blurb
                    : open?.file}
              </span>
              {hovered ? <span className="at-readout-hover">{hovered.name}</span> : null}
            </p>

            <Legend
              view={view}
              band={camera.band}
              runsHidden={runsHidden}
              onToggleRuns={() => setRunsHidden((h) => !h)}
            />
          </main>
        </div>

        {view === "turn" ? <TurnBar stop={stop} setStop={setStop} /> : null}
        <p className="at-sr" aria-live="polite">
          {view === "turn" ? `Stop ${stop + 1} of ${TURN.length}: ${here.label}` : ""}
        </p>

        {open ? (
          <Pane component={open} nav={nav} lens={lens} setLens={setLens} origin={measureOrigin} />
        ) : null}
      </div>
    </MotionConfig>
  );
}
