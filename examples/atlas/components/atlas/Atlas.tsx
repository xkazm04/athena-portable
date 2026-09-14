"use client";

/**
 * ATLAS — this repository as a machine you can walk around, with a real turn running through it.
 *
 * ROUND 3, AND WHAT CHANGED. Round 2 built a website about an architecture: bands, columns, rows,
 * prose. The owner's correction was that the goal is "a visual multi-layer model representing the
 * app solution, with text as a secondary informative element", so this round throws the pages away
 * and builds the thing itself:
 *
 *   the six strata of README §3.1   six planes stacked in depth
 *   the systems that realise them   blocks standing on their plane, with volume
 *   the modules inside a system     parts inside a block
 *   the edges between them          pipes routed between blocks, up the stack = reaches
 *   README §3.2, "how a turn flows" a LIGHT that travels the pipes, stops twelve times, and
 *                                   WAITS at the gate until a decision resolves it
 *
 * THE THREE LEVELS ARE THREE DISTANCES, not three screens. `useAtlasCamera` (the camera
 * contract's §3) makes the wheel and the level the same gesture: far is L0, closer is one stratum
 * cut open, closer still is one part with the pane risen out of it. A tool call, a click on the
 * rail and a reader's wheel all end at the same `nav` and therefore at the same flight.
 *
 * THREE RENDERINGS, ONE MACHINE. The owner asked to choose between the techniques from live
 * builds, so `/` mounts one of `render/webgl`, `render/css3d`, `render/hybrid` at a time behind a
 * switch. They share the model, the layout, the turn, the lens, the pane, the tools, the camera
 * and the bands; the ONLY thing that differs is how a scene unit becomes a pixel.
 *
 * WHERE THE NINE RULES OF THE FORMULA ARE, since this is still their test app:
 *
 *   1. the level you leave carries the camera — literally, now: the camera IS the level change
 *      (`rig.flyTo(poseFor(focus))`), so there is no echo to render and rule 1's own primitive is
 *      not needed by this direction. Noted in KIT-GAPS round 3.
 *   2. one claimant per shared id — no `layoutId` survives: a shared-element morph out of a
 *      `matrix3d` face measures a rectangle that is not where the reader sees the part, so L2
 *      grows from a projected origin instead (`machine/Pane.tsx`).
 *   3. box, then ink — the pane, and the blocks that lift their parts before the parts are legible.
 *   4. one clock — `motion.ts` reads every duration off `tokens.css`, the turn included, in beats.
 *   5. the overlay owns its Escape — `useOverlayEscape` in the pane, untouched from round 2.
 *   6. a move in flight is abortable — every flight is `rig.flyTo`, and any input cancels it.
 *   7. presence comes from the model — `weightsFor` maps `emphasis()` and nothing re-derives it.
 *   8. reduced motion lands on final state — flights are instant and the turn is a set of stills.
 *   9. what is no longer seen stops costing — `frameloop="demand"`; the camera's rAF stops when
 *      the pose settles; the transport's stops when it is paused.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import { useLevelFlight, useZoomNav, type Focus } from "@athena/demo-kit/zoom";

import { COUNTS, componentById, highlightIds, layerById, lensFor, type Lens } from "@/data";

import { Mast } from "./Mast";
import { useAtlasMotion } from "./motion";
import { Claims } from "./machine/Claims";
import { Pane } from "./machine/Pane";
import { Transport } from "./machine/Transport";
import { Css3d } from "./render/css3d/Css3d";
import { Hybrid } from "./render/hybrid/Hybrid";
import { RenderSwitcher, useRenderVariant } from "./render/Switcher";
import { Webgl } from "./render/webgl/Webgl";
import { weightsFor, type SceneProps } from "./render/contract";
import { SCENE, partAt } from "./scene/layout";
import { project, viewOf } from "./scene/project";
import { useAtlasCamera } from "./scene/rig";
import { TURN_BLOCKS, TURN_PARTS } from "./scene/turn";
import { useTurnTransport } from "./scene/useTurn";
import { AtlasTools } from "./tools/AtlasTools";

const RENDERERS = { webgl: Webgl, css3d: Css3d, hybrid: Hybrid } as const;

export function Atlas() {
  const nav = useZoomNav();
  const m = useAtlasMotion();
  /* The flight is handed to `useSemanticZoom`, which claims it on every camera-driven level
     change and settles it when the fly lands — so "a move is in flight" is true for a wheel
     exactly as it is for a click, and rule 6's abort works the same for both. */
  const flight = useLevelFlight(nav, { fallbackToken: "--at-dur-move" });

  const [variant, chooseVariant] = useRenderVariant();
  const [hover, setHover] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  /* ------------------------------------- the lens ------------------------------------- */

  const [lensId, setLensId] = useState<string | null>(null);
  const lens: Lens = useMemo(() => lensFor(lensId), [lensId]);
  const setLens = useCallback((id: string | null) => {
    setLensId((current) => (current === id ? null : id));
  }, []);

  /* `nav.highlight` is rebuilt on every nav state change, so it is read through a ref: this
     effect must run when the LENS changes and not when the nav does. (KIT-GAPS round 2 #6, still
     open in round 3.) */
  const highlight = useRef(nav.highlight);
  useEffect(() => {
    highlight.current = nav.highlight;
  });
  useEffect(() => {
    highlight.current(highlightIds(lensFor(lensId)));
  }, [lensId]);

  /* ------------------------------------- the turn ------------------------------------- */

  const transport = useTurnTransport({ beatMs: m.beatMs, reduced: m.reduced });

  /* ------------------------------------ the camera ------------------------------------ */

  const focus: Focus = nav.state.focus;
  const { rig } = useAtlasCamera(nav, flight);

  /* ------------------------------------ the weights ------------------------------------ */

  const live = transport.stops[transport.stop];
  const weights = useMemo(
    () =>
      weightsFor({
        focus,
        lens,
        liveBlock: live?.block ?? null,
        livePart: live?.part ?? null,
        turnBlocks: TURN_BLOCKS,
        turnParts: TURN_PARTS,
        hover,
      }),
    [focus, hover, lens, live?.block, live?.part],
  );

  /* -------------------------------------- opening -------------------------------------- */

  const onOpenStratum = useCallback(
    (id: string) => {
      if (nav.state.focus.level === 1 && nav.state.focus.group === id) return;
      nav.openGroup(id);
    },
    [nav],
  );

  const onOpenPart = useCallback(
    (id: string) => {
      const part = partAt(id);
      if (!part) return;
      const layer = SCENE.blocks.find((b) => b.id === part.block)?.layer;
      if (layer) nav.openItem(layer, id);
    },
    [nav],
  );

  /**
   * Where the open part is on screen, so the pane can rise out of it.
   *
   * A FUNCTION, not a piece of state, and the pane calls it once in a layout effect. Two reasons,
   * and the second is the real one: measuring the DOM and the camera in a render is a read of two
   * mutable systems React does not own, and turning that into `setState` inside an effect is the
   * cascading-render shape the compiler correctly refuses. Handing the pane a measurement it can
   * take at the moment it mounts puts the read where it belongs — in a layout effect, in the
   * component that needs it, once.
   *
   * It is not tracked afterwards on purpose: the camera holds still at L2 (the rig has flown
   * there and nothing moves it), and a pane whose transform origin chased the camera would be a
   * pane that slides when a reader nudges the scene.
   */
  const open = componentById(focus.item);
  const measureOrigin = useCallback((): { x: number; y: number } | null => {
    const id = nav.state.focus.item;
    const part = id ? partAt(id) : undefined;
    const box = stageRef.current?.getBoundingClientRect();
    if (!part || !box) return null;
    const p = project({ x: part.x, y: part.y + part.h, z: part.z }, viewOf(rig.get()), {
      w: box.width,
      h: box.height,
    });
    return p.visible ? { x: box.left + p.x, y: box.top + p.y } : null;
  }, [nav, rig]);

  /* ------------------------------------- the mount ------------------------------------- */

  const Renderer = RENDERERS[variant];
  const sceneProps: SceneProps = {
    rig,
    transport,
    focus,
    lens,
    weights,
    hover,
    onHover: setHover,
    onOpenStratum,
    onOpenPart,
    reduced: m.reduced,
    scene: SCENE,
  };

  const layer = layerById(focus.group);

  return (
    <MotionConfig reducedMotion="user">
      <AtlasTools
        nav={nav}
        lens={lens}
        lensId={lensId}
        setLens={setLens}
        transport={transport}
      />
      <div className="at-app" data-level={focus.level} data-render={variant}>
        <Mast nav={nav} lens={lens} setLens={setLens} counts={COUNTS}>
          <RenderSwitcher variant={variant} onChoose={chooseVariant} />
        </Mast>

        <div className="at-body">
          <Claims lens={lens} setLens={setLens} />

          <main className="at-stage" ref={stageRef}>
            {/* One renderer at a time, keyed by variant so a switch tears the old one down —
                a WebGL context that is merely hidden is a WebGL context still allocated. */}
            <Renderer key={variant} {...sceneProps} />

            {/* The reading line: what the camera is looking at, in words, for the reader who
                needs the name of the thing under the pointer and for the capture to assert on. */}
            <p className="at-readout" data-level={focus.level}>
              <span className="at-readout-level">
                {focus.level === 0
                  ? "The whole machine"
                  : focus.level === 1
                    ? layer?.name
                    : open?.name}
              </span>
              <span className="at-label">
                {focus.level === 0
                  ? "Drag to orbit · wheel to come closer · Home to reset"
                  : focus.level === 1
                    ? layer?.blurb
                    : open?.file}
              </span>
            </p>
          </main>
        </div>

        <Transport transport={transport} />

        {open ? (
          <Pane component={open} nav={nav} lens={lens} setLens={setLens} origin={measureOrigin} />
        ) : null}
      </div>
    </MotionConfig>
  );
}
