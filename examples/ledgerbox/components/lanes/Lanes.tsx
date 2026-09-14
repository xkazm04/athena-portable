"use client";

/**
 * The Lanes — one map, one camera, four bands.
 *
 * ROUND 3 TOOK THE LEVELS OUT OF THE PAGE AND PUT THEM IN THE DISTANCE. Round 2's version of
 * this file mounted two layers in one grid cell, measured a transform origin off the lane you
 * clicked, put the whole zoom on the layer that was leaving and handed `layoutId`s between them
 * in the commit the level changed. All of that was in service of one thing: making a level change
 * a move you can follow. A camera over one persistent world makes it a move BY CONSTRUCTION, so
 * the echo, the measured origin, the two layers and the id hand-off are gone — see
 * `design/round3-map-brief.md` §7.
 *
 * WHAT IS LEFT HERE, AND WHY EACH PIECE IS HERE RATHER THAN IN A CHILD:
 *
 *   · THE NAV is still the single truth. A wheel that crosses a band, a click on a lane, Escape
 *     and an agent's `open_group` all end in the same reducer, because `useSemanticZoom` turns
 *     the camera's distance into `nav.openGroup` / `openItem` / `up` and turns every nav change
 *     back into `rig.flyTo(poseFor(focus))`. One set of poses, three ways to ask for them.
 *   · THE FRAME, because the world's size IS the stage's size (zoom 1 is the resting frame), so
 *     a resize rebuilds the world and every pose with it.
 *   · THE TRANSFORM AND `--ln-inv`, written straight onto the scene node in the camera's own
 *     subscribe. Neither is React state: sixty renders a second of a hundred and twenty-five
 *     invoices is the whole motion-cost axis, and neither value is read by anything but CSS.
 *   · THE BAND, which IS React state — but only four values, changing a handful of times in a
 *     gesture, and `World` is memoised so the change costs a class flip rather than a re-render
 *     of the map.
 *   · The filter, the tick and the period, because each of them is something a tool moves, and an
 *     agent's call and a person's click have to end in the same `setState` or the two are looking
 *     at different pages.
 */
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import {
  poseToTransform,
  useCameraRig,
  useLevelFlight,
  useSemanticZoom,
  useZoomNav,
  type CameraPose,
} from "@athena/demo-kit/zoom";

import { Card } from "./Card";
import { formatDate } from "@/lib/format";
import type { Period } from "@/lib/constants";
import {
  NO_FILTER,
  laneById,
  markById,
  type LnBooks,
  type LnFilter,
  type LnMark,
  type LnSheet,
} from "./model";
import { fade, instant } from "./motion";
import { Foot } from "./shell/Foot";
import { Mast } from "./shell/Mast";
import { BooksTools, LanesTools } from "./tools";
import { Hud } from "./world/Hud";
import { Tip, type Hover } from "./world/Tip";
import { World } from "./world/World";
import { bandOf, quantizeInverse, type Band } from "./world/bands";
import {
  NAV_BANDS,
  ZOOM,
  buildWorld,
  centreOf,
  clampPan,
  laneAt,
  markAt,
  panBounds,
  poseForFocus,
  timeAt,
  type Frame,
} from "./world/layout";
import "./style/index.css";

/** The map does not re-render because the reader dragged over a lane boundary. */
const TheWorld = memo(World);

export function Lanes({ sheet, books }: { sheet: LnSheet; books: LnBooks }) {
  const nav = useZoomNav();
  const reduced = useReducedMotion();
  const [filter, setFilter] = useState<LnFilter>(NO_FILTER);
  const [picked, setPicked] = useState<string[]>([]);
  const [period, setPeriod] = useState<Period>("2026-08");

  const focus = nav.state.focus;
  const level = focus.level;

  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const dateRef = useRef<HTMLElement | null>(null);

  /**
   * THE FRAME IS THE WORLD'S OWN SIZE. `buildWorld` lays the map out so that zoom 1 shows all of
   * it in exactly this box, which is what lets the band thresholds be plain numbers instead of
   * multiples of a viewport-dependent fit (`world/layout.ts`, the header note). A resize is
   * therefore a rebuild — of the world, and of every pose derived from it.
   */
  const [frame, setFrame] = useState<Frame>({ w: 1440, h: 620 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const read = () => {
      const box = el.getBoundingClientRect();
      setFrame((f) =>
        Math.abs(f.w - box.width) < 1 && Math.abs(f.h - box.height) < 1
          ? f
          : { w: box.width, h: box.height },
      );
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const world = useMemo(() => buildWorld(sheet, frame), [sheet, frame]);

  /*
   * THE CAMERA'S CALLBACKS ARE BOUND ONCE and must see the CURRENT world, not the one that was
   * in scope when the rig mounted. Refs, because none of these renders anything — and written in
   * an effect rather than during render, which is not a formality: a ref assigned in the render
   * body is assigned again on a render React then throws away, and under StrictMode or a
   * concurrent retry the camera would be reading the world of a commit that never happened. An
   * effect runs on the commit that won, and every reader below is an event or a subscription,
   * which cannot fire before it.
   */
  const worldRef = useRef(world);
  const frameRef = useRef(frame);
  const levelRef = useRef(level);

  /**
   * THE FLIGHT IS STILL THE KIT'S, and it is now claimed by the camera rather than by a
   * zero-size element running a dummy animation.
   *
   * `useSemanticZoom` takes the flight and claims it for the length of each `flyTo`, so
   * `nav.setMoving` is true exactly while the camera is moving — which is what lets the nav's own
   * Escape listener abandon a move in flight rather than step out of a level nobody arrived at
   * (rule 6). Round 2 spent a `motion.span` and an `onAnimationComplete` on the same job.
   */
  const flight = useLevelFlight(nav, { fallbackToken: "--ln-dur-4", el: rootEl });

  const bounds = useMemo(
    () => ({ zoom: [ZOOM.min, ZOOM.max] as [number, number], pan: panBounds(world) }),
    [world],
  );

  /**
   * THE PAN CLAMP IS A SNAP, and that is the one place the contract did not fit.
   *
   * `bounds.pan` is a single static rectangle, but how far a camera may travel depends on the
   * zoom: a bound wide enough for zoom 14 lets the reader drag the whole map off the screen at
   * zoom 1. So the bound is set once, generously, and the per-zoom half of the same rule is
   * handed in as `snap` — which the rig applies when the reader stops. `clampPan` is idempotent
   * and tested, so a pose already inside the world is left exactly where it is.
   */
  const rig = useCameraRig({
    bounds,
    drag: "pan",
    wheel: "zoom",
    inertia: 0.86,
    keyboard: true,
    reducedMotion: "user",
    flyToken: "--ln-dur-move",
    easeToken: "--ln-ease",
    snap: useCallback(
      (pose: CameraPose) => clampPan(pose, worldRef.current, frameRef.current) as CameraPose,
      [],
    ),
  });

  /**
   * CAMERA DISTANCE IS THE LEVEL. The wheel crosses a band and this dispatches the same action a
   * click dispatches; a click, a tool or Escape changes the nav and this flies the camera to the
   * same pose. The hook marks which side is driving and ignores the echo of its own dispatch, so
   * the two directions cannot loop.
   */
  useSemanticZoom(nav, rig, {
    bands: NAV_BANDS,
    resolveGroup: (pose) => laneAt(worldRef.current, centreOf(pose, worldRef.current).y),
    resolveItem: (pose, group) => {
      const here = centreOf(pose, worldRef.current);
      return markAt(worldRef.current, group, here.x, here.y);
    },
    poseFor: (f) => poseForFocus(worldRef.current, f, frameRef.current) as Partial<CameraPose>,
    flight,
  });

  /**
   * The band, and the lane the camera is over.
   *
   * Two pieces of state, both changing a handful of times per gesture rather than per frame. The
   * lane under the camera is NOT the same thing as `focus.group`: while a reader drags sideways
   * at the near band the nav still has the lane they opened, and the HUD should already be
   * naming the one they are arriving at. That gap is the whole reason the head is furniture.
   */
  const [band, setBand] = useState<Band>("far");
  const bandRef = useRef<Band>("far");
  const [under, setUnder] = useState<string | null>(null);
  const underRef = useRef<string | null>(null);
  /** The rung of the type ladder the scene is on. See `quantizeInverse`. */
  const invRef = useRef(0);

  /* Every ref the camera reads, synced on the commit that won. See the note above. */
  useEffect(() => {
    worldRef.current = world;
    frameRef.current = frame;
    levelRef.current = level;
    bandRef.current = band;
    underRef.current = under;
  }, [world, frame, level, band, under]);

  /**
   * ONE SUBSCRIBE, AND IT WRITES THE DOM RATHER THAN STATE.
   *
   * The transform and `--ln-inv` are written on the same commit, which is what keeps the type in
   * the world at a constant size in screen pixels while the geometry scales (brief §6). The
   * readout's date is written the same way. Only the two values that CHANGE SOMETHING
   * STRUCTURAL — the band, and the lane the HUD names — go through React.
   */
  useEffect(
    () =>
      rig.subscribe((pose) => {
        const scene = sceneRef.current;
        if (scene) {
          /* The transform is a composite and costs nothing to write per frame. `--ln-inv` is a
             LAYOUT input — it sizes every glyph in the world — so it is quantised and written
             only when the rung changes. Un-quantised, this line alone relaid out fourteen
             hundred elements sixty times a second: 23fps and a 110ms long task per flight. */
          scene.style.transform = poseToTransform(pose);
          const inv = quantizeInverse(pose.zoom);
          if (inv !== invRef.current) {
            invRef.current = inv;
            scene.style.setProperty("--ln-inv", String(inv));
          }
        }
        const w = worldRef.current;
        const here = centreOf(pose, w);
        if (dateRef.current) {
          dateRef.current.textContent = formatDate(new Date(timeAt(w, here.x)).toISOString());
        }
        const nextBand = bandOf(levelRef.current, pose.zoom, bandRef.current);
        if (nextBand !== bandRef.current) {
          bandRef.current = nextBand;
          setBand(nextBand);
        }
        const nextLane = laneAt(w, here.y);
        if (nextLane !== underRef.current) {
          underRef.current = nextLane;
          setUnder(nextLane);
        }
      }),
    [rig],
  );

  /* A nav change that did not come from the camera — a click, a tool, Escape — still moves the
     band, and it must move it on the frame the level changed rather than when the fly happens to
     cross a threshold. The camera's own crossing is idempotent against this. */
  useEffect(() => {
    const next = bandOf(level, rig.get().zoom, bandRef.current);
    if (next !== bandRef.current) {
      bandRef.current = next;
      setBand(next);
    }
  }, [level, rig]);

  const lane = laneById(sheet, focus.group);
  const mark = markById(sheet, focus.item);
  const detail = mark ? sheet.details[mark.id] : undefined;
  /* The HUD names where the CAMERA is, which during a drag is ahead of where the nav is. */
  const hudLane = laneById(sheet, under) ?? lane;

  const pickedSet = useMemo(() => new Set(picked), [picked]);

  const [hover, setHover] = useState<Hover | null>(null);
  const onHover = useCallback(
    (m: LnMark | null, el: HTMLElement | null) => {
      if (!m || !el) {
        setHover(null);
        return;
      }
      const box = el.getBoundingClientRect();
      const laneOf = sheet.lanes.find((l) => l.marks.some((x) => x.id === m.id));
      if (!laneOf) return;
      setHover({ mark: m, lane: laneOf, x: box.left + box.width / 2, y: box.bottom, top: box.top });
    },
    [sheet],
  );

  const openLane = useCallback((id: string) => nav.openGroup(id), [nav]);
  const openMark = useCallback(
    (laneId: string, markId: string) => nav.openItem(laneId, markId),
    [nav],
  );

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="ln-root"
        ref={setRootEl}
        data-variant="lanes"
        data-level={level}
        data-band={band}
      >
        {/* The ingest layer: this direction's three levels, offered to an agent beside the page
            on `document.modelContext`. The tools did not change this round — `open_group` still
            means what it meant; it is now a flight rather than a page. */}
        <LanesTools sheet={sheet} nav={nav} filter={filter} setFilter={setFilter} />
        <BooksTools
          sheet={sheet}
          books={books}
          nav={nav}
          filter={filter}
          setFilter={setFilter}
          picked={picked}
          setPicked={setPicked}
          period={period}
          setPeriod={setPeriod}
        />

        <div className="ln-bath" aria-hidden />
        <div className="ln-vignette" aria-hidden />
        <div className="ln-grain" aria-hidden />

        <Mast sheet={sheet} />

        {/*
         * THE STAGE IS THE VIEWPORT AND THE SCENE IS THE WORLD. The rig binds to the stage —
         * that is where the pointer, the wheel and the keys are read, and where the frame is
         * measured — and the scene inside it carries the transform. `bind` is spread AFTER the
         * ref so the rig keeps the element it reads tokens and the bounding box from.
         */}
        <div
          className="ln-stage"
          ref={(el) => {
            stageRef.current = el;
            rig.bind.ref(el);
          }}
          onPointerDown={rig.bind.onPointerDown}
          onPointerMove={rig.bind.onPointerMove}
          onPointerUp={rig.bind.onPointerUp}
          onPointerCancel={rig.bind.onPointerCancel}
          onWheel={rig.bind.onWheel}
          onKeyDown={rig.bind.onKeyDown}
          tabIndex={rig.bind.tabIndex}
          style={rig.bind.style}
          data-camera="rig"
          role="application"
          aria-label="The books as a map. Drag to pan, wheel or plus and minus to zoom, Home to reset."
        >
          <div
            className="ln-world"
            ref={sceneRef}
            data-band={band}
            /* The size and the two measures the stylesheet reads, plus the negative margins
               that put the scene's own centre on the stage's — which is what makes the kit's
               `transform-origin: 50% 50%` frame of reference literally true here. */
            style={
              {
                inlineSize: world.w,
                blockSize: world.h,
                marginInlineStart: -world.w / 2,
                marginBlockStart: -world.h / 2,
                "--ln-gutter-w": world.gutter,
                "--ln-axis-h": world.axisH,
              } as CSSProperties
            }
          >
            <TheWorld
              world={world}
              focus={focus}
              filter={filter}
              picked={pickedSet}
              onOpenLane={openLane}
              onOpenMark={openMark}
              onHover={onHover}
            />
          </div>

          <Hud band={band} lane={hudLane} mark={mark} dateRef={dateRef} onOut={nav.up} />
        </div>

        {/* The legend is also the filter panel, and the crumbs are still the way back up. One
            `setFilter`, whether the press came from a person's thumb or from `set_filter`. */}
        <Foot
          sheet={sheet}
          lane={lane}
          mark={mark}
          level={level}
          nav={nav}
          filter={filter}
          setFilter={setFilter}
        />

        {hover ? <Tip hover={hover} /> : null}

        {/*
         * L2 is the one thing that is NOT in the world, and that is deliberate. An invoice you
         * are acting on wants a modal's focus trap, a scroll of its own and a dialog role; a
         * card at zoom 12 inside a panning scene has none of those. So the closest band opens a
         * DOM pane OVER the map — box first, from the exact screen position of the card it grew
         * out of, and its ink a beat later (rule 3). The camera holds where it arrived, so the
         * world behind the pane is still the lane the reader was reading.
         */}
        <AnimatePresence>
          {level === 2 && mark ? (
            <motion.div
              key="card"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reduced ? instant : fade()}
            >
              <Card
                mark={mark}
                detail={detail}
                laneLabel={lane?.label ?? mark.category}
                onClose={nav.up}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
