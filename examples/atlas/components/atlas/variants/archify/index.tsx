"use client";

/**
 * ARCHIFY — the architecture grammar of https://github.com/tt-a1i/archify (MIT), transposed onto
 * this repository's own model. `docs/archify-study.md` is the study; NO CODE WAS COPIED, and the
 * clone was read for its practices and its screenshots only.
 *
 * WHAT THIS VARIANT IS AN ARGUMENT ABOUT. The round-4 blueprint draws WHERE things are. Archify's
 * grammar draws WHAT THINGS ARE: a closed seven-kind enum with one colour per meaning, a stroked
 * sigil instead of a title bar, boundaries derived from membership, and orthogonal labelled runs
 * with one style per relationship. Transposed onto six layers and nineteen systems, that grammar
 * makes one claim the blueprint could not: **rows are layers, columns are kinds**, so the gate is
 * a single column four rows tall and the rose security-group around it crosses four amber layer
 * regions. That is this variant's whole thesis, and `layout.ts` is where it is computed.
 *
 * THE THREE BANDS (contract: the kit's rig + `useSemanticZoom`, rule 14 and rule 16):
 *
 *   band 0  nineteen systems as nodes inside six dashed layer regions; runs are the DERIVED
 *           system relationships, labelled with the relationship and its count.
 *   band 1  the open layer's systems open into their components — nodes inside a node's region —
 *           and the runs become the module edges, including the ones that leave the layer.
 *   band 2  the open part reports its screen rect through `reportOrigin` and the shell's `pane`
 *           is rendered last, over the world, growing out of that box.
 *
 * INTENT OVERRIDES THE BAND (study §4). The band sets a default detail tier through `data-band` on
 * the stage; hover, focus, the claim lens, a PATH endpoint and the active story beat all set
 * `data-intent` on a node, and the CSS re-reveals every tier for that node at any distance.
 *
 * ONE MOTION OWNER (study §7.9). `data-motion-owner` on the stage names the single feature allowed
 * to animate — the story, or nothing. Reduced motion parks all of it and the static frame carries
 * the whole meaning: the trail is numbered, the beats are lettered past/active/next, and every
 * chapter's delta is printed rather than played.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  poseToTransform,
  secs,
  useCameraRig,
  useRoving,
  useSemanticZoom,
  useTokens,
  type CameraPose,
  type Focus,
} from "@athena/demo-kit/zoom";

import { COMPONENT_BY_ID, SYSTEM_BY_ID, type LayerId } from "@/data";

import type { VariantMeta, VariantProps } from "../contract";
import { usePublishViews } from "../viewBus";

import "./archify.css";
import { Frames, PartNode, SystemNode, type Intent } from "./Nodes";
import { Legend, Minimap, ProbeReceipt, StoryBar, Toolbar, type Mode } from "./Chrome";
import { ArchifyTools } from "./Tools";
import { PathOverlay, RunMarkers, Runs, Trail, type TrailSegment } from "./RunLayer";
import { KINDS, kindOfComponent, kindOfSystem, type Kind } from "./kinds";
import { PLANS, VIEWS, VIEW_INFO, WORLD, centreOf, type Rect, type ViewId } from "./layout";
import {
  BANDS,
  ZOOM_BOUNDS,
  poseFor,
  quantise,
  resolveGroup,
  resolveItem,
  type Frame,
} from "./poses";
import { COMPONENT_GRAPH, SYSTEM_GRAPH, hopsOf, probe, type Probe } from "./path";
import { runsFor } from "./runs";
import { runPath, type Run } from "./routing";
import { BEATS, CHAPTERS, beatState, chapterOf, stopAt } from "./story";

export const meta: VariantMeta = { slug: "archify", views: [...VIEWS] };

/** Archify's presets are CSS-variable reskins of identical geometry (study §2, §7.2). */
const PRESETS = ["classic", "blueprint"] as const;
type Preset = (typeof PRESETS)[number];

/**
 * The story's clock, as a multiple of the app's own view duration.
 *
 * NO MILLISECOND IS TYPED HERE (formula §1 rule 4, and `design/check-tokens.mjs` enforces it).
 * Archify's guided view runs at 3200 ms with an 1100 ms follow dwell; this reads `--at-dur-view`
 * out of the cascade and multiplies, which lands on 3360 and 1120 and — more to the point — moves
 * with the app's clock instead of beside it.
 */
const BEAT_VIEWS = 6;
const DWELL_VIEWS = 2;

/** The cap on a LENS comparison. Past this a comparison is a picture of the whole graph again. */
const LENS_CAP = 24;

/** The label may grow this much as the reader pulls back before it clips (study §7.8). */
const CS_MAX = 4;

function composeRefs<T>(...refs: ((el: T | null) => void)[]) {
  return (el: T | null) => {
    for (const ref of refs) ref(el);
  };
}

export default function Archify({
  nav,
  flight,
  focus,
  level,
  lens,
  lit,
  reduced,
  pane,
  reportOrigin,
}: VariantProps) {
  /* ----------------------------------------- the stage ---------------------------------------- */

  const [stage, setStage] = useState<HTMLElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const frame = useRef<Frame>({ w: 0, h: 0 });

  const [view, setView] = useState<ViewId>("sheet");
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const [preset, setPreset] = useState<Preset>("classic");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mode, setMode] = useState<Mode>("none");

  usePublishViews({
    views: useMemo(() => VIEWS.map((id) => ({ id, ...VIEW_INFO[id] })), []),
    current: view,
    onSet: useCallback((id: string) => {
      if ((VIEWS as readonly string[]).includes(id)) setView(id as ViewId);
    }, []),
  });

  /* ----------------------------------------- the camera --------------------------------------- */

  /**
   * THE FRAME IS MEASURED IN THE FIRST EFFECT PASS, BEFORE THE CAMERA EXISTS — and that ordering is
   * the whole fix for a bug round 4 papered over with a re-fit.
   *
   * `poseFor(HOME)` needs the canvas's size to fit the sheet, and the contract hands the resolve
   * callbacks a pose and no frame (round 3's gap 5, still open — KIT-GAPS). Round 4 measured it
   * from a `ResizeObserver` and then corrected the camera with `rig.set` in a `requestAnimationFrame`
   * — but `rig.set` CANCELS the fly `useSemanticZoom` starts on mount, its `onDone` never runs, and
   * the hook is left believing the nav is still leading. `lead === "nav"` suppresses every
   * camera-driven level change, so the wheel changes the detail band and never the level, which is
   * the contract's headline claim silently two-thirds true again.
   *
   * So: no re-fit. This effect is declared before `useCameraRig`, runs before the hook's own effects
   * in the same commit, and reads the element from a ref the commit has already written — so the
   * first `poseFor` is already correct and nothing has to be corrected afterwards. Logged as R5-A2.
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

  const semantic = useSemanticZoom(nav, rig, {
    bands: BANDS,
    resolveGroup: useCallback((pose: CameraPose) => resolveGroup(pose, viewRef.current), []),
    resolveItem: useCallback(
      (pose: CameraPose, group: string) => resolveItem(pose, viewRef.current, group),
      [],
    ),
    poseFor: useCallback((f: Focus) => poseFor(f, viewRef.current, frame.current), []),
    flight,
  });
  const band = semantic.level;

  /* The transform, written straight onto one element — never through React state. */
  const [zoomRead, setZoomRead] = useState(1);
  const [viewport, setViewport] = useState<Rect | null>(null);
  const lastQuant = useRef(0);
  useEffect(
    () =>
      rig.subscribe((pose) => {
        const el = worldRef.current;
        if (!el) return;
        el.style.transform = poseToTransform(pose);
        const q = quantise(pose.zoom);
        if (q !== lastQuant.current) {
          lastQuant.current = q;
          el.style.setProperty("--ar-cs", String(Math.min(CS_MAX, Math.round((1 / q) * 1000) / 1000)));
        }
        setZoomRead(pose.zoom);
        const f = frame.current;
        if (f.w > 0) {
          setViewport({
            x: -pose.pan.x - f.w / (2 * pose.zoom),
            y: -pose.pan.y - f.h / (2 * pose.zoom),
            w: f.w / pose.zoom,
            h: f.h / pose.zoom,
          });
        }
      }),
    [rig],
  );

  /* A view switch is a RE-ARRANGEMENT, not a level change: the reader keeps their focus and the
     camera re-frames the same thing in the new sheet. */
  /**
   * A "SKIP THE FIRST RUN" BOOLEAN IS A BUG IN STRICT MODE, and it cost an hour to find.
   *
   * `useRef(true)` flipped to `false` inside the effect looks like "only on a change" and is not:
   * React's development double-invoke runs the effect, cleans up, and runs it again, so the SECOND
   * mount run sees `false` and fires. Here that meant a stray `rig.flyTo` on mount, which cancelled
   * the flight `useSemanticZoom` had just started — and a cancelled fly never calls its `onDone`,
   * so the hook was left believing the nav was leading and suppressed every camera-driven level
   * change from then on. The visible symptom was three levels' worth of wheel that only ever
   * changed the detail band. (The same shape is in the round-4 canvas; noted in KIT-GAPS R5-A3.)
   *
   * The fix is to remember the VALUE rather than the visit: a re-run with the same view is not a
   * change, whoever caused it.
   */
  const lastView = useRef<ViewId | null>(null);
  useEffect(() => {
    if (lastView.current === view) return;
    const had = lastView.current;
    lastView.current = view;
    if (had === null) return;
    rig.flyTo(poseFor(nav.state.focus, view, frame.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  /* ------------------------------------------- the plan --------------------------------------- */

  const plan = PLANS[view];
  const open = level > 0 ? (focus.group as LayerId | null) : null;
  const opened = band > 0 ? open : null;
  const { runs } = useMemo(() => runsFor(view, opened), [view, opened]);

  const kindOf = useCallback((id: string): Kind => {
    const component = COMPONENT_BY_ID.get(id);
    if (component) return kindOfComponent(component);
    return kindOfSystem(id);
  }, []);

  const nameOf = useCallback(
    (id: string): string =>
      COMPONENT_BY_ID.get(id)?.name ?? SYSTEM_BY_ID.get(id)?.name.replace(/^The /, "") ?? id,
    [],
  );

  /* ------------------------------------------- the lens --------------------------------------- */

  const [picked, setPicked] = useState<Kind[]>([]);
  const pickKind = useCallback((kind: Kind) => {
    setPicked((was) =>
      was.includes(kind) ? was.filter((k) => k !== kind) : [...was, kind].slice(-2),
    );
  }, []);

  const { revealed, capped } = useMemo(() => {
    if (mode !== "lens" || picked.length === 0) return { revealed: null, capped: false };
    const hits: string[] = [];
    for (const run of runs) {
      const a = kindOf(run.from);
      const b = kindOf(run.to);
      const hit =
        picked.length === 1
          ? a === picked[0] || b === picked[0]
          : (a === picked[0] && b === picked[1]) || (a === picked[1] && b === picked[0]);
      if (hit) hits.push(run.id);
    }
    return { revealed: new Set(hits.slice(0, LENS_CAP)), capped: hits.length > LENS_CAP };
  }, [kindOf, mode, picked, runs]);

  const counts = useMemo(() => {
    const tally = new Map<Kind, number>();
    for (const n of plan.nodes) {
      const here = opened === n.layer ? n.parts.map((p) => p.kind) : [n.kind];
      for (const k of here) tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    return KINDS.filter((k) => (tally.get(k) ?? 0) > 0).map((kind) => ({ kind, n: tally.get(kind)! }));
  }, [opened, plan.nodes]);

  /* -------------------------------------------- PATH ------------------------------------------ */

  const [pick, setPick] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<Probe | null>(null);

  /**
   * Leaving a mode clears what that mode was holding — IN THE EVENT, not in an effect.
   *
   * An effect that watches `mode` and calls `setState` is the cascading-render shape the React
   * compiler's lint correctly refuses: the state does not need to SYNCHRONISE with the mode, it
   * needs to be reset by the thing that changed the mode. One handler, three resets, no second
   * render behind the first.
   */
  const changeMode = useCallback((next: Mode) => {
    setMode(next);
    setPick(null);
    setProbeResult(null);
    setPicked([]);
  }, []);

  const onPickNode = useCallback(
    (id: string) => {
      if (pick === null) {
        setPick(id);
        setProbeResult(null);
        return;
      }
      setProbeResult(probe(opened ? COMPONENT_GRAPH : SYSTEM_GRAPH, pick, id));
      setPick(null);
    },
    [opened, pick],
  );

  /* ------------------------------------------ the story --------------------------------------- */

  const t = useTokens(["--at-dur-view"] as const, stage);
  const beatMs = secs(t["--at-dur-view"].ms) * BEAT_VIEWS * 1000;
  const dwellMs = secs(t["--at-dur-view"].ms) * DWELL_VIEWS * 1000;

  const [story, setStory] = useState(false);
  const [stop, setStop] = useState(0);
  const [playing, setPlaying] = useState(false);
  const beat = stopAt(stop);
  const chapter = chapterOf(stop);

  useEffect(() => {
    if (!playing || reduced || beatMs <= 0) return;
    const id = setInterval(() => setStop((s) => (s + 1) % BEATS.length), beatMs);
    return () => clearInterval(id);
  }, [beatMs, playing, reduced]);

  /* The follow camera, with a dwell: the story moves the NAV, and the nav moves the camera through
     `useSemanticZoom`, so a guided view and a reader's own click take the same path. */
  useEffect(() => {
    if (!story) return;
    const id = setTimeout(() => {
      const layer = SYSTEM_BY_ID.get(beat.system)?.layer;
      if (layer) nav.openGroup(layer);
    }, reduced ? 0 : dwellMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat.system, dwellMs, reduced, story]);

  const trail = useMemo<TrailSegment[]>(() => {
    if (!story) return [];
    const boxFor = (componentId: string): Rect | null => {
      if (opened) {
        for (const n of plan.nodes) {
          const hit = n.parts.find((p) => p.id === componentId);
          if (hit && n.layer === opened) return hit;
        }
      }
      const system = COMPONENT_BY_ID.get(componentId)?.system;
      return plan.nodes.find((n) => n.id === system) ?? null;
    };
    const byPair = new Map(runs.map((r) => [`${r.from}->${r.to}`, r]));
    const out: TrailSegment[] = [];
    for (let i = 1; i < BEATS.length; i += 1) {
      const from = boxFor(BEATS[i - 1]!.part);
      const to = boxFor(BEATS[i]!.part);
      if (!from || !to || from === to) continue;
      const fromId = opened ? BEATS[i - 1]!.part : BEATS[i - 1]!.system;
      const toId = opened ? BEATS[i]!.part : BEATS[i]!.system;
      const authored = byPair.get(`${fromId}->${toId}`);
      const a = centreOf(from);
      const b = centreOf(to);
      out.push({
        id: `${i}`,
        index: i,
        authored: Boolean(authored) && BEATS[i]!.authored,
        state: beatState(i, stop),
        /* The overlay is drawn ON the authored run where there is one, and as a derived elbow
           where README asserts a hop the edge list does not carry. */
        d: authored
          ? runPath(authored.points)
          : `M ${a.x} ${a.y} L ${a.x} ${(a.y + b.y) / 2} L ${b.x} ${(a.y + b.y) / 2} L ${b.x} ${b.y}`,
      });
    }
    return out;
  }, [opened, plan.nodes, runs, stop, story]);

  const marks = useMemo(() => {
    if (!story) return [];
    return BEATS.map((b) => {
      const box = opened
        ? plan.nodes.flatMap((n) => (n.layer === opened ? n.parts : [])).find((p) => p.id === b.part)
        : plan.nodes.find((n) => n.id === b.system);
      if (!box) return null;
      const c = centreOf(box);
      return { id: `beat-${b.index}`, x: c.x, y: c.y, n: b.index + 1, state: beatState(b.index, stop) };
    }).filter((m): m is NonNullable<typeof m> => m !== null);
  }, [opened, plan.nodes, stop, story]);

  const probeSegments = useMemo(() => {
    if (!probeResult?.found) return [];
    const byPair = new Map(runs.map((r) => [`${r.from}->${r.to}`, r]));
    return hopsOf(probeResult).map((hop, i) => {
      const run = byPair.get(`${hop.from}->${hop.to}`);
      return { id: `hop-${i}`, d: run ? runPath(run.points) : "", authored: Boolean(run) };
    }).filter((s) => s.d !== "");
  }, [probeResult, runs]);

  /* ----------------------------------------- what is lit -------------------------------------- */

  const hover = nav.state.hover;
  const storyIds = useMemo(
    () => (story ? new Set([beat.part, beat.system]) : new Set<string>()),
    [beat.part, beat.system, story],
  );
  const probeIds = useMemo(() => new Set(probeResult?.nodes ?? []), [probeResult]);

  const intentOf = useCallback(
    (id: string): Intent => {
      if (focus.item === id || focus.group === id) return "focus";
      if (hover === id) return "hover";
      if (storyIds.has(id)) return "story";
      if (probeIds.has(id) || pick === id) return "path";
      if (lit.has(id)) return "lens";
      return undefined;
    },
    [focus.group, focus.item, hover, lit, pick, probeIds, storyIds],
  );

  const dimOf = useCallback(
    (id: string): boolean => {
      if (mode === "lens" && picked.length > 0) return !picked.includes(kindOf(id));
      if (probeResult?.found) return !probeIds.has(id);
      if (story) return !storyIds.has(id);
      return false;
    },
    [kindOf, mode, picked, probeIds, probeResult, story, storyIds],
  );

  /* ------------------------------------------ interaction ------------------------------------- */

  const onOpenNode = useCallback(
    (id: string) => {
      /* In PATH mode a node is an ENDPOINT, not a door. Same control, two meanings, disambiguated
         by the mode the reader turned on — which is archify's own arrangement, and the reason the
         node reports its own id rather than its layer. */
      if (mode === "path") {
        onPickNode(id);
        return;
      }
      const layer = SYSTEM_BY_ID.get(id)?.layer;
      if (!layer) return;
      if (focus.level >= 1 && focus.group === layer) return;
      nav.openGroup(layer);
    },
    [focus.group, focus.level, mode, nav, onPickNode],
  );

  const onOpenPart = useCallback(
    (id: string) => {
      if (mode === "path") {
        onPickNode(id);
        return;
      }
      const layer = SYSTEM_BY_ID.get(COMPONENT_BY_ID.get(id)?.system ?? "")?.layer;
      if (layer) nav.openItem(layer, id);
    },
    [mode, nav, onPickNode],
  );

  const onHover = useCallback((id: string | null) => nav.hover(id), [nav]);

  const roving = useRoving(worldRef, { selector: "[data-roving]", columns: KINDS.length });
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.target === canvasRef.current) {
        rig.bind.onKeyDown(event);
        return;
      }
      roving.onKeyDown(event);
      if (!event.defaultPrevented && ["+", "-", "=", "Home"].includes(event.key)) {
        rig.bind.onKeyDown(event);
      }
    },
    [rig, roving],
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

  /* --------------------------------------------- draw ----------------------------------------- */

  const motionOwner = story && playing && !reduced ? "story" : undefined;

  return (
    <div
      className="ar-stage"
      ref={setStage}
      data-preset={preset}
      data-theme={theme}
      data-band={band}
      data-level={level}
      data-view={view}
      data-mode={mode}
      data-story={story ? "" : undefined}
      data-motion-owner={motionOwner}
      data-reduced={reduced ? "" : undefined}
      data-driving={semantic.driving ?? undefined}
    >
      <div
        className="ar-canvas"
        ref={composeRefs<HTMLDivElement>(rig.bind.ref, (el) => {
          canvasRef.current = el;
        })}
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
        aria-label="The archify sheet. Rows are layers, columns are kinds. Drag to pan, wheel to zoom, arrows to move between nodes."
      >
        <div
          className="ar-world"
          ref={worldRef}
          style={{
            width: `${WORLD.w}px`,
            height: `${WORLD.h}px`,
            marginLeft: `${-WORLD.w / 2}px`,
            marginTop: `${-WORLD.h / 2}px`,
          }}
        >
          <div className="ar-paper" aria-hidden />
          <div className="ar-origin">
            <Frames boundaries={plan.boundaries} open={open} lit={lit} />

            <svg
              className="ar-plate"
              style={{ transform: `translate(${plan.bounds.x}px, ${plan.bounds.y}px)` }}
              width={plan.bounds.w}
              height={plan.bounds.h}
              viewBox={`${plan.bounds.x} ${plan.bounds.y} ${plan.bounds.w} ${plan.bounds.h}`}
              aria-hidden
              focusable="false"
            >
              <RunMarkers />
              <Runs
                runs={runs as readonly Run[]}
                revealed={revealed}
                near={useMemo(() => new Set(hover ? [hover] : []), [hover])}
                hidden={false}
              />
              {probeSegments.length > 0 ? <PathOverlay segments={probeSegments} /> : null}
              {story ? <Trail segments={trail} marks={marks} /> : null}
            </svg>

            {plan.nodes.map((node) => (
              <SystemNode
                key={node.id}
                node={node}
                open={opened === node.layer}
                intent={intentOf(node.id)}
                dim={dimOf(node.id)}
                onOpen={onOpenNode}
                onHover={onHover}
              />
            ))}

            {/* THE PARTS ARE SIBLINGS OF THE NODES, NOT CHILDREN. Their boxes are world
                coordinates from the same pass that placed the node, so nesting them inside a
                transformed parent would apply the node's own translate a second time. "Nodes
                inside a node's region" is a fact about the GEOMETRY, and the geometry is flat. */}
            {opened
              ? plan.nodes
                  .filter((n) => n.layer === opened)
                  .flatMap((n) => n.parts)
                  .map((part) => (
                    <PartNode
                      key={part.id}
                      part={part}
                      intent={intentOf(part.id)}
                      dim={dimOf(part.id)}
                      onOpen={onOpenPart}
                      onHover={onHover}
                    />
                  ))
              : null}
          </div>
        </div>
      </div>

      <Legend
        counts={counts}
        picked={picked}
        capped={capped}
        active={mode === "lens"}
        claim={lens?.concept ? `${lens.concept.part} ${lens.concept.name}` : null}
        onPick={pickKind}
      />

      {mode === "map" ? (
        <Minimap
          bounds={plan.bounds}
          nodes={plan.nodes}
          viewport={viewport}
          onGo={(x, y) => rig.flyTo({ pan: { x: -x, y: -y } })}
        />
      ) : null}

      {mode === "path" ? (
        <ProbeReceipt
          probe={probeResult}
          picking={pick}
          names={nameOf}
          onClear={() => {
            setPick(null);
            setProbeResult(null);
          }}
        />
      ) : null}

      {story ? (
        <StoryBar
          stop={stop}
          chapter={chapter}
          playing={playing}
          beat={beat}
          reduced={reduced}
          onPlay={() => (reduced ? setStop((s) => (s + 1) % BEATS.length) : setPlaying((p) => !p))}
          onStep={(to) => setStop(((to % BEATS.length) + BEATS.length) % BEATS.length)}
          onChapter={(i) => setStop(BEATS.indexOf(CHAPTERS[i]!.beats[0]!))}
        />
      ) : null}

      <Toolbar
        mode={mode}
        onMode={changeMode}
        preset={preset}
        theme={theme}
        presets={PRESETS}
        onPreset={(p) => setPreset(p as Preset)}
        onTheme={() => setTheme((was) => (was === "dark" ? "light" : "dark"))}
        zoom={zoomRead}
        onZoom={(by) => rig.flyTo({ zoom: zoomRead * (by > 0 ? 1.25 : 0.8) })}
        onHome={() => rig.flyTo(poseFor({ level: 0, group: null, item: null }, view, frame.current))}
        story={story}
        onStory={() => {
          setStory((was) => !was);
          setPlaying(false);
        }}
      />

      {/* `read_turn` / `set_turn` — the two capabilities only a drawing that tells the turn can
          answer. They mount and unmount with this variant (see `./Tools.tsx`). */}
      <ArchifyTools
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
