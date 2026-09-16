"use client";

/**
 * ARCHIFY-LANES — the turn in lanes. Round 6, proposal B of `docs/archify-study.md` Part 2 §5.
 *
 * WHAT THIS VARIANT IS AN ARGUMENT ABOUT, in one sentence: **reading order can come from position,
 * so lanes and phases replace boundary frames entirely and the turn is the diagram rather than an
 * overlay on a static map.**
 *
 * The owner's verdict on round 5 named three degradations — grouping, component strategy, style —
 * and the second study found that all three were quantities. This variant answers each with a
 * number rather than with a technique:
 *
 *   GROUPING   Nineteen systems become TWELVE nodes by four authored merges, 120 model edges
 *              become FOURTEEN runs, and there are ZERO boundary rectangles. What a frame used to
 *              claim, a lane band claims better, because a reader does not have to trace it.
 *   COMPONENT  Every node is 130×56, always: `rx 6`, stroke 1.5, an opaque mask, an 11-unit sigil,
 *              a label that shrinks to a floor of 8 and never clips, a 9-unit sublabel carrying
 *              the components the merge absorbed, a 7-unit tag. No ghost cells, no fitted widths,
 *              no ellipsis, no title bar.
 *   STYLE      Home is SCALE 1 on a world authored at 1170×578, so a run is 1.5 screen px and not
 *              0.42, the grid is 40 px and not 11, and a label is 11 px. Zoom-out below home is
 *              disabled, which is `viewer-camera.js`'s own rule and the round-5 correction.
 *
 * THE THREE LEVELS ARE THE THREE THINGS THE DRAWING IS (`poses.ts`):
 *
 *   L0  the whole lane grid with the phase headers on top.
 *   L1  one PHASE — its columns widened by `planFor`, the edge labels a 52-unit column gap could
 *       not hold revealed, the other two phases receded through the kit's `presenceOf` (rule 7).
 *   L2  one NODE — its screen rect reported through `reportOrigin` so the shell's pane grows out
 *       of it, and the pane rendered last so it sits over the world (rule 3, rule 11).
 *
 * WHAT IS REUSED RATHER THAN REBUILT. `../archify/kinds` (the role→colour rule and the seven-kind
 * enum — a fact about the model, not about a drawing), `../archify/story` (the twelve stops read
 * off README §3.2 and the four chapter cuts), and `../archify/routing`'s pure geometry primitives
 * and `runPath`. Nothing in `variants/archify/**` was modified, and this folder imports no
 * component, stylesheet or class name from it — the round-6 brief asked for the reuse and the
 * contract's "a variant owns everything inside its stage" decides where the line is.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  emphasis,
  poseToTransform,
  secs,
  useCameraRig,
  useSemanticZoom,
  useTokens,
  type CameraPose,
  type Focus,
} from "@athena/demo-kit/zoom";

import type { VariantMeta, VariantProps } from "../contract";
import { usePublishViews } from "../viewBus";

import "./lanes.css";
import { CARDS, Cards, StoryBar, TitleBand, Toolbar } from "./Chrome";
import {
  Legend,
  Lanes,
  Node,
  Phases,
  RunMarkers,
  Runs,
  Trail,
  type Intent,
  type TrailMark,
  type TrailSegment,
} from "./Scene";
import { GRID, centreOf, planOf } from "./geometry";
import {
  BANDS,
  ZOOM_BOUNDS,
  clampLook,

  phaseOfNode,
  poseFor,
  resolveGroup,
  resolveItem,
  type Frame,
} from "./poses";
import { elbow, mainErrorCrossings, routesFor } from "./routing";
import {
  BEAT_VIEWS,
  CHAPTER_VIEWS,
  HOPS,
  TRAIL_COUNTS,
  beatState,
  chapterOf,
  nodeAt,
} from "./story";
import { LanesTools } from "./Tools";
import { EDGE_BY_ID, NODES, ON_MAIN, PHASES, roleCounts } from "./workflow";

/** Two arrangements of the same twelve boxes: the grid, and the grid with the turn told over it. */
export const VIEWS = ["lanes", "turn"] as const;
type ViewId = (typeof VIEWS)[number];

export const meta: VariantMeta = { slug: "archify-lanes", views: [...VIEWS] };

/**
 * The story's clock, as a multiple of the app's own view duration.
 *
 * NO MILLISECOND IS TYPED HERE (formula §1 rule 4, `design/check-tokens.mjs` enforces it). Archify
 * runs its guided view at 3200 ms with an 1100 ms follow dwell; this reads `--at-dur-view` out of
 * the cascade and multiplies by the same two factors `lanes.css` uses, so the CSS and the JS
 * cannot disagree about when a beat ends.
 */
const BEAT_VIEWS_MULT = 6;
const DWELL_VIEWS_MULT = 2;
/** The vertical follow lands AFTER the phase change's own flight, never beside it. */
const FOLLOW_VIEWS_MULT = 3;

function composeRefs<T>(...refs: ((el: T | null) => void)[]) {
  return (el: T | null) => {
    for (const ref of refs) ref(el);
  };
}

export default function ArchifyLanes({
  nav,
  flight,
  focus,
  level,
  lit,
  reduced,
  pane,
  reportOrigin,
}: VariantProps) {
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const frame = useRef<Frame>({ w: 0, h: 0 });

  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [story, setStory] = useState(false);
  const [stop, setStop] = useState(0);
  const [playing, setPlaying] = useState(false);

  /**
   * THE FRAME IS MEASURED BEFORE THE CAMERA EXISTS, and the ordering is the whole of KIT-GAPS
   * R5-A2. `poseFor(HOME)` needs the canvas's size, and the contract hands the resolve callbacks a
   * pose and no frame; correcting the camera afterwards with `rig.set` CANCELS the fly
   * `useSemanticZoom` starts on mount, which leaves the hook believing the nav is still leading and
   * suppresses every camera-driven level change. This effect is declared before `useCameraRig`, so
   * it runs first in the same commit and the first `poseFor` is already right.
   */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    frame.current = { w: el.clientWidth, h: el.clientHeight };
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) frame.current = { w: box.width, h: box.height };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rig = useCameraRig({
    bounds: { zoom: [ZOOM_BOUNDS[0], ZOOM_BOUNDS[1]], yaw: [0, 0], pitch: [0, 0] },
    drag: "pan",
    wheel: "zoom",
    inertia: 0.86,
    snap: null,
    keyboard: true,
    flyToken: "--at-dur-move",
    easeToken: "--at-ease",
  });

  /* The open phase drives the PLAN, and the plan is what `resolve*` answers against, so the two
     are read through one ref rather than through two copies of the same fact. */
  const openPhase = level > 0 ? (focus.group ?? null) : null;
  const openRef = useRef<string | null>(openPhase);
  useEffect(() => {
    openRef.current = openPhase;
  }, [openPhase]);

  const semantic = useSemanticZoom(nav, rig, {
    bands: BANDS,
    resolveGroup: useCallback((pose: CameraPose) => resolveGroup(pose, openRef.current), []),
    resolveItem: useCallback(
      (pose: CameraPose, group: string) => resolveItem(pose, group, openRef.current),
      [],
    ),
    poseFor: useCallback((f: Focus) => poseFor(f, frame.current), []),
    flight,
  });
  const band = semantic.level;

  /* The transform, written straight onto one element — never through React state. */
  const [zoomRead, setZoomRead] = useState(1);
  useEffect(
    () =>
      rig.subscribe((pose) => {
        const el = worldRef.current;
        if (el) el.style.transform = poseToTransform(pose);
        setZoomRead(pose.zoom);
      }),
    [rig],
  );

  /* ------------------------------------------ the plan ---------------------------------------- */

  const plan = useMemo(() => planOf(band > 0 ? openPhase : null), [band, openPhase]);
  const { runs } = useMemo(() => routesFor(plan), [plan]);

  /**
   * THE PLAN IS A LAYOUT TRANSITION, AND IT IS THIS VARIANT'S SIGNATURE MOTION.
   *
   * Opening a phase widens the gaps it touches, so twelve boxes slide into their new columns while
   * the camera flies to the phase. Two moves, two owners: the node's own `transform` is owned by
   * the layout and the world's by the camera (rule 11), and they are on different elements, so
   * neither animates inside the other.
   */
  /* THE SECOND AXIS IS DERIVED, NOT MIRRORED. `view` is not state: there is one fact here — is the
     turn being told — and a `view` kept beside it would be a second copy of it that an effect has
     to keep in step, which is the cascading-render shape the compiler's lint correctly refuses. */
  const view: ViewId = story ? "turn" : "lanes";
  usePublishViews({
    views: useMemo(
      () => [
        { id: "lanes", label: "Lanes", note: "The grid: four lanes, six columns, three phases." },
        { id: "turn", label: "Turn", note: "The twelve stops told over the same grid." },
      ],
      [],
    ),
    current: view,
    onSet: useCallback((id: string) => {
      setStory(id === "turn");
      if (id !== "turn") setPlaying(false);
    }, []),
  });

  /* ------------------------------------------ the story --------------------------------------- */

  const t = useTokens(["--at-dur-view"] as const, stage);
  const beatMs = secs(t["--at-dur-view"].ms) * BEAT_VIEWS_MULT * 1000;
  const dwellMs = secs(t["--at-dur-view"].ms) * DWELL_VIEWS_MULT * 1000;
  const followMs = secs(t["--at-dur-view"].ms) * FOLLOW_VIEWS_MULT * 1000;

  const beat = BEAT_VIEWS[Math.min(BEAT_VIEWS.length - 1, Math.max(0, stop))]!;
  const chapter = chapterOf(stop);

  useEffect(() => {
    if (!playing || reduced || beatMs <= 0) return;
    const id = setInterval(() => setStop((s) => (s + 1) % BEAT_VIEWS.length), beatMs);
    return () => clearInterval(id);
  }, [beatMs, playing, reduced]);

  /* The follow camera, with a dwell: the story moves the NAV and the nav moves the camera through
     `useSemanticZoom`, so a guided view and a reader's own click take exactly the same path. */
  const beatNode = nodeAt(stop);
  useEffect(() => {
    if (!story) return;
    const id = setTimeout(
      () => {
        nav.openGroup(phaseOfNode(beatNode));
      },
      reduced ? 0 : dwellMs,
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatNode, dwellMs, reduced, story]);

  /**
   * THE SECOND HALF OF THE FOLLOW CAMERA: the lane, not just the phase.
   *
   * A phase is two columns of a four-lane stack, and at the L1 zoom the frame holds about three
   * lanes — so opening the phase the beat lives in puts the reader in the right COLUMNS and can
   * still leave the beat's own lane off the bottom (stop 8 reaches down into `Tools and evidence`
   * from the gate). So the story also slides the camera vertically onto the beat's lane, which is
   * a pan and not a level change: `resolveGroup` answers by the centre's x below the second band,
   * so the phase under the camera is unchanged and `useSemanticZoom` has nothing to correct.
   *
   * It waits the same dwell the phase change does, which is well past the kit's own 320 ms flight,
   * so the two flies never race — the round-5 finding (KIT-GAPS R5-A2/A3: a cancelled fly told
   * nobody) is a hazard here and the fix is to not overlap them rather than to rely on the repair.
   */
  useEffect(() => {
    if (!story || band !== 1) return;
    const box = planOf(openPhase).byId.get(beatNode);
    if (!box) return;
    const id = setTimeout(() => {
      /* `flyTo` takes a whole pan, so the x it is already at is read back rather than recomputed
         — the phase decides x and the beat decides y, and neither may overwrite the other. */
      const pose = rig.get();
      const look = clampLook(
        { x: -pose.pan.x, y: box.y + box.h / 2 },
        pose.zoom,
        frame.current,
        openPhase,
      );
      rig.flyTo({ pan: { x: -look.x, y: -look.y } });
    }, reduced ? 0 : followMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band, beatNode, followMs, openPhase, reduced, story]);

  const trail = useMemo<TrailSegment[]>(() => {
    if (!story) return [];
    const byId = new Map(runs.map((r) => [r.id, r]));
    return HOPS.map((hop) => {
      const authored = hop.edge ? byId.get(hop.edge) : undefined;
      const a = plan.byId.get(hop.from);
      const b = plan.byId.get(hop.to);
      if (!a || !b) return null;
      return {
        id: `hop-${hop.index}`,
        authored: Boolean(authored),
        state: beatState(hop.index, stop),
        /* The overlay is drawn ON the authored run where the grid carries the hop, and as a
           derived elbow where README asserts one the grid does not. */
        d: authored ? authored.d : elbow(centreOf(a), centreOf(b)),
      } satisfies TrailSegment;
    }).filter((s): s is TrailSegment => s !== null);
  }, [plan, runs, stop, story]);

  const marks = useMemo<TrailMark[]>(() => {
    if (!story) return [];
    const seen = new Map<string, number>();
    return BEAT_VIEWS.map((b) => {
      const boxed = plan.byId.get(b.node);
      if (!boxed) return null;
      /* Two stops can share a node (the approval row and the ledger row are one box); the second
         mark sits below the first rather than on top of it. */
      const n = seen.get(b.node) ?? 0;
      seen.set(b.node, n + 1);
      const c = centreOf(boxed);
      return {
        id: `beat-${b.index}`,
        x: c.x - boxed.w / 2 + 12 + n * 22,
        y: c.y + boxed.h / 2 + 12,
        n: b.index + 1,
        state: beatState(b.index, stop),
      } satisfies TrailMark;
    }).filter((m): m is TrailMark => m !== null);
  }, [plan, stop, story]);

  /* ---------------------------------------- what is lit --------------------------------------- */

  const hover = nav.state.hover;
  const storyNodes = useMemo(
    () => (story ? new Set(CHAPTER_VIEWS[chapter]?.focus ?? []) : new Set<string>()),
    [chapter, story],
  );

  const intentOf = useCallback(
    (id: string): Intent => {
      const node = NODES.find((n) => n.id === id);
      if (focus.item && node?.item === focus.item) return "focus";
      if (hover === id) return "hover";
      if (story && beatNode === id) return "story";
      if (node?.systems.some((s) => lit.has(s))) return "lens";
      return undefined;
    },
    [beatNode, focus.item, hover, lit, story],
  );

  const dimOf = useCallback(
    (id: string): boolean => (story ? !storyNodes.has(id) && beatNode !== id : false),
    [beatNode, story, storyNodes],
  );

  const near = useMemo(() => new Set(hover ? [hover] : []), [hover]);
  const revealed = useMemo(() => {
    if (!story) return null;
    const ids = HOPS.filter((h) => h.edge !== null && h.index <= stop + 1).map((h) => h.edge!);
    return new Set(ids);
  }, [stop, story]);

  /* ----------------------------------------- interaction -------------------------------------- */

  const onOpen = useCallback(
    (id: string) => {
      const node = NODES.find((n) => n.id === id);
      if (!node) return;
      const phase = phaseOfNode(id);
      if (focus.level >= 1 && focus.group === phase) {
        nav.openItem(phase, node.item);
        return;
      }
      nav.openGroup(phase);
    },
    [focus.group, focus.level, nav],
  );

  const onHover = useCallback((id: string | null) => nav.hover(id), [nav]);

  /**
   * ROVING BY LANE AND COLUMN, not by DOM order.
   *
   * `useRoving` walks a dense grid of `columns` cells; four lanes by six columns is half empty, so
   * a dense walk would send the right arrow from the bridge into nothing. The arrows move to the
   * NEXT OCCUPIED cell in that direction, which is what a reader of a lane diagram means, and what
   * the mouse means too.
   */
  const onNodeKey = useCallback(
    (event: KeyboardEvent<HTMLElement>, id: string) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen(id);
        return;
      }
      const dirs: Record<string, [number, number]> = {
        ArrowRight: [1, 0],
        ArrowLeft: [-1, 0],
        ArrowDown: [0, 1],
        ArrowUp: [0, -1],
      };
      const dir = dirs[event.key];
      if (!dir) return;
      const here = NODES.find((n) => n.id === id);
      if (!here) return;
      const laneIndex = (lane: string) => plan.lanes.findIndex((l) => l.id === lane);
      const [dx, dy] = dir;
      const candidates = NODES.filter((n) => {
        const dCol = n.col - here.col;
        const dLane = laneIndex(n.lane) - laneIndex(here.lane);
        if (dx !== 0) return Math.sign(dCol) === dx;
        return Math.sign(dLane) === dy;
      }).sort((a, b) => {
        const key = (n: typeof a) =>
          dx !== 0
            ? Math.abs(n.col - here.col) * 10 + Math.abs(laneIndex(n.lane) - laneIndex(here.lane))
            : Math.abs(laneIndex(n.lane) - laneIndex(here.lane)) * 10 + Math.abs(n.col - here.col);
        return key(a) - key(b);
      });
      const next = candidates[0];
      if (!next) return;
      event.preventDefault();
      document.querySelector<HTMLElement>(`[data-node-id="${next.id}"]`)?.focus();
    },
    [onOpen, plan.lanes],
  );

  const onCanvasKey = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.target === canvasRef.current) rig.bind.onKeyDown(event);
    },
    [rig],
  );

  /* ------------------------------------- the pane's origin box -------------------------------- */

  useEffect(() => {
    if (level < 2 || !focus.item) {
      reportOrigin(null);
      return;
    }
    const id = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-component="${focus.item}"]`);
      reportOrigin(el ? el.getBoundingClientRect() : null);
    });
    return () => cancelAnimationFrame(id);
  }, [focus.item, level, reportOrigin, zoomRead]);

  /* ------------------------------------------- the draw --------------------------------------- */

  const world = plan.world;
  const counts = useMemo(() => roleCounts(), []);
  const crossings = useMemo(() => mainErrorCrossings(runs), [runs]);
  const motionOwner = story && playing && !reduced ? "story" : undefined;

  return (
    <div
      className="al-stage"
      ref={setStage}
      data-theme={theme}
      data-band={band}
      data-level={level}
      data-phase={openPhase ?? undefined}
      data-view={view}
      data-story={story ? "" : undefined}
      data-motion-owner={motionOwner}
      data-reduced={reduced ? "" : undefined}
      data-driving={semantic.driving ?? undefined}
      data-crossings={crossings}
    >
      <div className="al-head">
        <TitleBand phase={openPhase} level={level} zoom={zoomRead} />
      <Toolbar
        theme={theme}
        onTheme={() => setTheme((was) => (was === "dark" ? "light" : "dark"))}
        story={story}
        onStory={() => {
          setStory((was) => !was);
          setPlaying(false);
        }}
        zoom={zoomRead}
        onZoom={(by) => rig.flyTo({ zoom: zoomRead * (by > 0 ? 1.25 : 0.8) })}
        onHome={() => rig.flyTo(poseFor({ level: 0, group: null, item: null }, frame.current))}
        level={level}
      />
      </div>

      <div
        className="al-canvas"
        ref={composeRefs<HTMLDivElement>(rig.bind.ref, (el) => {
          canvasRef.current = el;
        })}
        onPointerDown={rig.bind.onPointerDown}
        onPointerMove={rig.bind.onPointerMove}
        onPointerUp={rig.bind.onPointerUp}
        onPointerCancel={rig.bind.onPointerCancel}
        onWheel={rig.bind.onWheel}
        onKeyDown={onCanvasKey}
        tabIndex={rig.bind.tabIndex}
        style={rig.bind.style}
        data-camera={rig.bind["data-camera"]}
        role="application"
        aria-label="The turn in lanes. Rows are lanes, columns are when a step happens. Drag to pan, wheel to zoom, arrows to move between nodes."
      >
        {/*
          THE TRANSFORMED ELEMENT IS A POINT, AND THAT IS THE WHOLE FRAME OF REFERENCE.

          `docs/kit-camera-contract.md` states it once: `screen = centre + zoom · (world + pan)`,
          so `-pan` is the world point under the middle of the frame and `poseFor` is simply "look
          at this rectangle's centre". That identity only holds if the TRANSFORMED element's own
          origin sits at the middle of the frame: a sized element with `transform-origin: 50% 50%`
          scales about its own middle instead, and then `-pan` is off by half the world — which is
          exactly the drawing sliding into a corner. So `.al-world` is 0x0 at the centre of the
          canvas, and `.al-sheet` inside it carries the drawing at plain world coordinates.
        */}
        <div className="al-world" ref={worldRef}>
          <div className="al-sheet" style={{ width: `${world.w}px`, height: `${world.h}px` }}>
          <div className="al-paper" style={{ "--al-grid": `${GRID}px` } as CSSProperties} aria-hidden />

          <svg
            className="al-plate"
            width={world.w}
            height={world.h}
            viewBox={`0 0 ${world.w} ${world.h}`}
            aria-hidden
            focusable="false"
          >
            <RunMarkers />
            <Phases phases={plan.phases} open={band > 0 ? openPhase : null} />
            <Lanes lanes={plan.lanes} />
            <Runs runs={runs} near={near} revealed={revealed} />
            {story ? <Trail segments={trail} marks={marks} /> : null}
            <Legend rect={plan.legend} counts={counts} />
          </svg>

          {NODES.map((node) => {
            const rect = plan.byId.get(node.id);
            if (!rect) return null;
            return (
              <Node
                key={node.id}
                node={node}
                rect={rect}
                intent={intentOf(node.id)}
                dim={dimOf(node.id)}
                onMain={ON_MAIN.has(node.id)}
                presence={emphasis(focus, rect.phase, level === 2 ? node.item : null)}
                onOpen={onOpen}
                onHover={onHover}
                onKeyDown={onNodeKey}
              />
            );
            })}
          </div>
        </div>

      </div>

      {story ? (
        <StoryBar
          stop={stop}
          beat={beat}
          chapters={CHAPTER_VIEWS}
          chapter={chapter}
          playing={playing}
          reduced={reduced}
          counts={TRAIL_COUNTS}
          onPlay={() =>
            reduced ? setStop((s) => (s + 1) % BEAT_VIEWS.length) : setPlaying((p) => !p)
          }
          onStep={(to) => setStop(((to % BEAT_VIEWS.length) + BEAT_VIEWS.length) % BEAT_VIEWS.length)}
          onChapter={(i) => setStop(CHAPTER_VIEWS[i]?.from ?? 0)}
        />
      ) : (
        <Cards cards={CARDS} />
      )}

      {/* `read_turn` / `set_turn` — they mount and unmount with this drawing. */}
      <LanesTools
        stop={stop}
        setStop={setStop}
        story={story}
        setStory={setStory}
        playing={playing}
      />

      {/* The shell's pane, rendered LAST so it sits over the world (contract, rule 3, rule 11). */}
      {pane}
    </div>
  );
}

/** Named so a test can assert the phase ids the level model uses are the drawing's own. */
export const GROUPS: readonly string[] = PHASES.map((p) => p.id);
export const EDGE_LABELS: ReadonlyMap<string, string> = new Map(
  [...EDGE_BY_ID.values()].map((e) => [e.id, e.label]),
);
