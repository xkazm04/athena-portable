"use client";

/**
 * ARCHIFY-DENSITY — the editorial sheet. Proposal A of `docs/archify-study.md` part 2 §5.
 *
 * WHAT THIS VARIANT EXISTS TO PROVE, in one sentence: **the abstraction rule is the design.** The
 * baseline variant copied archify's grammar faithfully and the owner still called the result
 * "significantly degraded from visual archify", because the grammar was never the thing that made
 * archify's frames read — the CEILING was. Nineteen example diagrams, none over twelve nodes, none
 * over fourteen edges, none over four boundaries, and a camera that starts at 100 % and refuses to
 * go further out. Round 5 drew nineteen systems, sixty-eight components and a hundred and twenty
 * edges at 28 %.
 *
 * So the five numbers this variant is:
 *
 *      12 nodes · 2 boundaries · 14 runs · one emphasised spine · scale 1
 *
 * and the one rule that follows from them: **no node ever opens.** The sixty-eight components are
 * absorbed by the node's own text tiers and by three cards below the canvas (`sheet.ts`), not by
 * sixty-eight more boxes. L1 is the same twelve boxes with the sublabel and the tag revealed and
 * one layer band lit; L2 is one component's passport over the sheet. The drawing at L2 is the
 * drawing at L0, closer — which is the thing round 5's L1 could not be, because it turned twelve
 * boxes into sixty-eight exactly where reading should have got easier.
 *
 * THE LEVELS, THROUGH THE CONTRACT (rules 12, 14 and 16):
 *
 *   L0  the sheet at home. `data-detail-level="map"`: the label alone.
 *   L1  band >= 1.45, or a layer band opened by a click or a tool. `read`: sublabel and tag.
 *       The group is a LAYER ID, because the shell's mast and `read_view` both read `focus.group`
 *       through `layerById` and a variant that answered in its own vocabulary would hand an agent
 *       an empty projection. The rows of this sheet ARE the layers, so that answer is also true.
 *   L2  band >= 2.25. The node under the camera reports its screen rect through `reportOrigin` and
 *       the shell's `pane` — the one details destination in the whole app (study §7.13) — grows out
 *       of it.
 *
 * INTENT ADVANCES THE TIER ONE STEP rather than replacing the band. That is round 5's evolved
 * blueprint's finding, kept in `docs/layered-ui-formula.md`, and here it is also what keeps the
 * success condition true: a hovered node at the map band gains its 9-unit sublabel and not its
 * 7-unit tag, so nothing is ever drawn under 9 px on screen.
 *
 * ONE MOTION OWNER, AND ALMOST NO MOTION. There is no story, no ambient trace and no view switch:
 * transform, opacity and colour only, all on `--ad-*` aliases of the app's clock, and reduced
 * motion parks every transition so the static frame carries the whole meaning.
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
  useCameraRig,
  useRoving,
  useSemanticZoom,
  type CameraPose,
  type Focus,
} from "@athena/demo-kit/zoom";

import type { LayerId } from "@/data";

import type { VariantMeta, VariantProps } from "../contract";

import "./density.css";
import { Cards, Controls, Legend, Title } from "./Chrome";
import { Frames, Node, RunMarkers, Runs, type Intent } from "./Draw";
import type { Kind } from "./kinds";
import { PLAN_RUNS } from "./plan";
import {
  BANDS,
  HOME_MIN,
  ZOOM_MAX,
  homeZoom,
  nodeOf,
  poseFor,
  resolveGroup,
  resolveItem,
  type Frame,
} from "./poses";
import {
  BOUNDARIES,
  BOXES,
  CARDS,
  EDGES_OMITTED,
  RUNS,
  SHEET_COUNTS,
  WORLD,
  legendCounts,
} from "./sheet";

export const meta: VariantMeta = { slug: "archify-density" };

/** The reading column, and the gutters the sheet keeps at every width. `--at-space-5` is 24. */
const COLUMN_MAX = 1440;
const GUTTER = 24;
/** What the column spends on chrome before the canvas gets what is left. Measured, not guessed. */
const MIN_CANVAS_H = 320;

/** Archify's wheel steps, for the two buttons. The wheel itself is the rig's, anchored at the pointer. */
const STEP = 1.25;

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

const composeRefs =
  <T,>(...refs: ((el: T | null) => void)[]) =>
  (el: T | null) => {
    for (const ref of refs) ref(el);
  };

/** Which hops README §3.2 asserts and `data/edges.ts` does not carry. Drawn dotted, and counted. */
const DERIVED = new Set(RUNS.filter((r) => r.emphasis && r.weight === 0).map((r) => r.id));

export default function Density({
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
  /* ---------------------------------------- the fit ------------------------------------------- */

  /**
   * THE ONE MEASUREMENT THE WHOLE VARIANT TURNS ON.
   *
   * Archify has no fit pass because its author is made to make the world fit; this app is inside a
   * shell whose stage is whatever the viewport leaves after the mast and the claims rail, so the
   * fit has to be computed — but it is computed archify's way round. The world is FIXED and the
   * scale is `min(frameW/worldW, frameH/worldH)` clamped to [1, 1.6], so the answer is "100 % or
   * more", never "28 %". `sheet.ts` sized the world to make that true at 1440 × 900.
   */
  const [stage, setStage] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const chrome = useRef<{ title: number; footer: number }>({ title: 0, footer: 0 });
  const [chromeH, setChromeH] = useState(0);

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const read = () => {
      const sheet = sheetRef.current;
      if (sheet) setStage({ w: sheet.clientWidth, h: sheet.clientHeight });
      const next = {
        title: titleRef.current?.offsetHeight ?? 0,
        footer: footerRef.current?.offsetHeight ?? 0,
      };
      if (next.title !== chrome.current.title || next.footer !== chrome.current.footer) {
        chrome.current = next;
        setChromeH(next.title + next.footer);
      }
    };
    const ro = new ResizeObserver(read);
    for (const el of [sheetRef.current, titleRef.current, footerRef.current]) if (el) ro.observe(el);
    read();
    return () => ro.disconnect();
  }, []);

  const column = Math.max(0, Math.min(stage.w, COLUMN_MAX) - GUTTER * 2);
  const room = Math.max(MIN_CANVAS_H, stage.h - chromeH - GUTTER * 3);
  const home = column > 0 ? homeZoom({ w: column, h: room }) : HOME_MIN;
  const viewport: Frame = {
    w: column,
    h: Math.round(WORLD.h * home),
  };

  /**
   * The two values the camera's callbacks read but do not re-render for: the measured frame, and
   * the passport the reader is standing in. Both are written in an effect DECLARED BEFORE the rig,
   * so they are current by the time `useSemanticZoom`'s own effects run in the same commit — and
   * never during render, which React's `react-hooks/refs` rule correctly refuses.
   */
  const frame = useRef<Frame>(viewport);
  const standing = useRef<string | null>(focus.item);
  useEffect(() => {
    frame.current = viewport;
    standing.current = focus.item;
  });

  /* --------------------------------------- the camera ----------------------------------------- */

  const worldRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  /**
   * THE ZOOM FLOOR IS THE HOME SCALE, and that is `viewer-camera.js`'s own rule: zoom-out below 1
   * is disabled, because there is nothing out there — the drawing IS the frame. The bounds are read
   * from a ref at event time by the rig, so a resize moves the floor with the fit.
   */
  const rig = useCameraRig({
    bounds: { zoom: [home, ZOOM_MAX], yaw: [0, 0], pitch: [0, 0] },
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
    resolveGroup: useCallback((pose: CameraPose) => resolveGroup(pose), []),
    resolveItem: useCallback((pose: CameraPose) => resolveItem(pose, standing.current), []),
    poseFor: useCallback((f: Focus) => poseFor(f, frame.current), []),
    flight,
  });
  const band = semantic.level;

  /* The transform, written straight onto one element — never through React state (rule 9). The
     first write is made here rather than as an inline `style`, because an inline transform is
     re-applied on every render and would snap a reader standing at L2 back to the home pose. */
  const [zoomRead, setZoomRead] = useState(home);
  useEffect(() => {
    const write = (pose: CameraPose) => {
      const el = worldRef.current;
      if (el) el.style.transform = poseToTransform(pose);
      setZoomRead(pose.zoom);
    };
    write(rig.get());
    return rig.subscribe(write);
  }, [rig]);

  /* A resize changes the floor and therefore the home pose. Re-fit only when the reader is at
     home: someone standing inside a layer must not be thrown back out by a window drag. */
  const lastHome = useRef(home);
  useEffect(() => {
    if (lastHome.current === home) return;
    lastHome.current = home;
    if (nav.state.focus.level === 0) rig.flyTo(poseFor({ level: 0, group: null, item: null }, frame.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home]);

  /* ---------------------------------------- the lens ------------------------------------------ */

  const [picked, setPicked] = useState<Kind[]>([]);
  const pickKind = useCallback((kind: Kind) => {
    setPicked((was) => (was.includes(kind) ? was.filter((k) => k !== kind) : [...was, kind].slice(-2)));
  }, []);

  const counts = useMemo(() => legendCounts(), []);

  /* A node is lit by the shell's claim lens when any component it absorbed carries the claim. */
  const litNodes = useMemo(() => {
    const out = new Set<string>();
    if (!lens) return out;
    for (const box of BOXES) {
      if (box.components.some((c) => lit.has(c.id))) out.add(box.id);
      else if (box.spec.systems.some((s) => lit.has(s))) out.add(box.id);
    }
    return out;
  }, [lens, lit]);

  /* ------------------------------------- what is open ----------------------------------------- */

  const openLayer = (level > 0 || band > 0 ? focus.group : null) as LayerId | null;
  const openNode = focus.item ? (nodeOf(focus.item)?.id ?? null) : null;
  const hover = nav.state.hover;

  const intentOf = useCallback(
    (id: string): Intent => {
      if (openNode === id || focus.group === id) return "focus";
      if (hover === id) return "hover";
      if (litNodes.has(id)) return "lens";
      return undefined;
    },
    [focus.group, hover, litNodes, openNode],
  );

  const dimOf = useCallback(
    (id: string): boolean => {
      if (picked.length > 0) {
        const box = BOXES.find((b) => b.id === id);
        return !box || !picked.includes(box.kind);
      }
      if (lens) return !litNodes.has(id);
      return false;
    },
    [lens, litNodes, picked],
  );

  /* ------------------------------------- interaction ------------------------------------------ */

  /**
   * A NODE NEVER OPENS INTO ITS PARTS, so a click means one of two things and the reader's current
   * depth decides which: from the sheet it opens the node's layer band (L1); from inside that band
   * it opens the node's own entry module's passport (L2). Two levels, one control, no new graph.
   */
  const onOpenNode = useCallback(
    (id: string) => {
      const box = BOXES.find((b) => b.id === id);
      if (!box) return;
      if (nav.state.focus.level >= 1 && nav.state.focus.group === box.layer) {
        if (box.primary) nav.openItem(box.layer, box.primary);
        return;
      }
      nav.openGroup(box.layer);
    },
    [nav],
  );

  const onHover = useCallback((id: string | null) => nav.hover(id), [nav]);

  const roving = useRoving(worldRef, { selector: "[data-roving]", columns: 4 });
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

  /* ------------------------------ the pane's origin box (rule 3, rule 11) ---------------------- */

  useEffect(() => {
    if (level < 2 || !focus.item) {
      reportOrigin(null);
      return;
    }
    const id = requestAnimationFrame(() => {
      const box = nodeOf(focus.item!);
      const el = box ? document.querySelector<HTMLElement>(`[data-node-id="${box.id}"]`) : null;
      reportOrigin(el ? el.getBoundingClientRect() : null);
    });
    return () => cancelAnimationFrame(id);
  }, [focus.item, level, reportOrigin, zoomRead]);

  /* ----------------------------------------- chrome ------------------------------------------- */

  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [present, setPresent] = useState(false);

  const detail = band >= 2 ? "full" : band >= 1 ? "read" : "map";
  const subtitle = `${SHEET_COUNTS.nodes} nodes for ${SHEET_COUNTS.systems} systems and ${SHEET_COUNTS.components} components · ${SHEET_COUNTS.runs} runs for ${SHEET_COUNTS.edges} authored edges · one turn, ten hops`;

  const near = useMemo(() => new Set(hover ? [hover] : []), [hover]);
  const openCard = openLayer ? (BOXES.find((b) => b.layer === openLayer)?.id ?? null) : null;

  return (
    <div
      className="ad-sheet"
      ref={sheetRef}
      data-variant="archify-density"
      data-theme={theme}
      data-band={band}
      data-level={level}
      data-present={present ? "" : undefined}
      data-reduced={reduced ? "" : undefined}
      data-driving={semantic.driving ?? undefined}
    >
      <div className="ad-column">
        <div ref={titleRef}>
          <Title
            subtitle={subtitle}
            theme={theme}
            present={present}
            onTheme={() => setTheme((was) => (was === "dark" ? "light" : "dark"))}
            onPresent={() => setPresent((was) => !was)}
          />
        </div>

        <div className="ad-canvas">
          <div
            className="ad-viewport"
            ref={composeRefs<HTMLDivElement>(rig.bind.ref, (el) => {
              canvasRef.current = el;
            })}
            style={{ ...rig.bind.style, height: `${viewport.h}px` }}
            onPointerDown={rig.bind.onPointerDown}
            onPointerMove={rig.bind.onPointerMove}
            onPointerUp={rig.bind.onPointerUp}
            onPointerCancel={rig.bind.onPointerCancel}
            onWheel={rig.bind.onWheel}
            onKeyDown={onKeyDown}
            tabIndex={rig.bind.tabIndex}
            data-camera={rig.bind["data-camera"]}
            role="application"
            aria-label="The Athena sheet: twelve nodes, two boundaries, and the turn as an emphasised spine. Drag to pan, wheel to zoom, arrows to move between nodes."
          >
            <div
              className="ad-world"
              ref={worldRef}
              data-detail-level={detail}
              style={{
                width: `${WORLD.w}px`,
                height: `${WORLD.h}px`,
                marginLeft: `${-WORLD.w / 2}px`,
                marginTop: `${-WORLD.h / 2}px`,
              }}
            >
              <div className="ad-paper" aria-hidden />

              <Frames boundaries={BOUNDARIES} lit={litNodes} />

              <svg
                className="ad-plate"
                width={WORLD.w}
                height={WORLD.h}
                viewBox={`0 0 ${WORLD.w} ${WORLD.h}`}
                aria-hidden
                focusable="false"
              >
                <RunMarkers />
                <Runs runs={PLAN_RUNS} near={near} derived={DERIVED} />
              </svg>

              {BOXES.map((box) => (
                <Node
                  key={box.id}
                  node={box}
                  open={openLayer === box.layer}
                  intent={intentOf(box.id)}
                  dim={dimOf(box.id)}
                  lit={litNodes.has(box.id)}
                  onOpen={onOpenNode}
                  onHover={onHover}
                />
              ))}
            </div>
          </div>

          <div className="ad-footer" ref={footerRef}>
            <Legend
              counts={counts}
              picked={picked}
              omitted={EDGES_OMITTED}
              derived={DERIVED.size}
              onPick={pickKind}
            />
            <Controls
              zoom={zoomRead}
              home={home}
              onZoom={(by) =>
                rig.flyTo({ zoom: clamp(zoomRead * (by > 0 ? STEP : 1 / STEP), home, ZOOM_MAX) })
              }
              onHome={() => nav.home()}
            />
          </div>
        </div>

        <Cards cards={CARDS} open={openCard} />
      </div>

      {/* The shell's pane, rendered LAST so it sits over the world (contract, rule 3, rule 11). */}
      {pane}
    </div>
  );
}
