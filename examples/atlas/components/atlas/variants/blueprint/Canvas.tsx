"use client";

/**
 * THE SHEET. One 2D world, one camera, four arrangements, three bands of detail.
 *
 * ONE ELEMENT CARRIES THE TRANSFORM and it is written straight onto `style` from `rig.subscribe`,
 * never through React state — sixty renders a second of nineteen blocks and sixty-eight parts is
 * the motion-cost score round 1 paid for. The world's `transform-origin` stays at the centre,
 * which is what `zoomAt` solves about.
 *
 * TYPE IS SCREEN-SPACE, GEOMETRY IS WORLD-SPACE (rule 13). The same subscription writes `--at-cs`,
 * the quantised inverse of the zoom, and every label in the drawing scales by it — including, from
 * round 5, the labels on the runs themselves. Quantised in steps of ~26% (`poses.ts`), because an
 * un-quantised counter-scale re-lays-out every label on every wheel tick.
 *
 * ARROWS MOVE FOCUS, NOT THE CAMERA — unless the canvas itself is what has focus. A drawing with
 * nineteen blocks in it is a thing a keyboard reader TRAVERSES, so `←↑→↓` with a block focused move
 * to the neighbouring block (`useRoving`, `DIM.cols` columns, walls at the edges). The camera's own
 * arrow keys are reached the way a reader reaches a canvas in any drawing tool: by focusing the
 * canvas itself, at which point `←↑→↓` pan and `+`/`-`/`Home` zoom.
 *
 * THE BAND IS ON THE CANVAS AND THE DETAIL RULES READ IT (round 5). `data-band` was already here;
 * what is new is that the stylesheet now uses it to decide which `data-detail` tier is drawn,
 * instead of every component deciding for itself what "far" means.
 */
import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { poseToTransform, useRoving, type Focus } from "@athena/demo-kit/zoom";

import { EDGES, type Lens } from "@/data";

import { DIM } from "./geometry";
import { WORLD, partRuns, planOf, type ViewId } from "./plan";
import { quantise } from "./poses";
import { blockBeat } from "./story";
import { Block } from "./Block";
import { Runs } from "./Runs";
import type { CanvasCamera } from "./useCanvasCamera";
import { TURN } from "./turn";

export interface CanvasProps {
  view: ViewId;
  camera: CanvasCamera;
  focus: Focus;
  lens: Lens;
  /** The turn's current stop, 0-based. The Turn view lights its block. */
  stop: number;
  /** True while the turn is being told as a story rather than scrubbed. */
  story: boolean;
  /** `packages` starts with its runs hidden. */
  runsHidden: boolean;
  /** What the legend's filter, the story or a hover has pushed into the background. */
  dimBlocks: ReadonlySet<string>;
  dimRuns: ReadonlySet<string>;
  /** What the one-hop hover preview is lighting. */
  hopBlocks: ReadonlySet<string>;
  hopRuns: ReadonlySet<string>;
  hover: string | null;
  onOpenLayer: (layer: string) => void;
  onOpenPart: (id: string, at: DOMRect) => void;
  onHover: (id: string | null) => void;
}

/**
 * Two refs on one element.
 *
 * `rig.bind` carries a `ref` (for the non-passive wheel listener) that the camera contract does
 * not list, so spreading `bind` over an element that already has a ref drops one of them and the
 * failure is invisible — the camera still works and the page also scrolls underneath. Written for
 * the third round running; logged again in KIT-GAPS.
 */
function composeRefs<T>(...refs: ((el: T | null) => void)[]) {
  return (el: T | null) => {
    for (const ref of refs) ref(el);
  };
}

export function Canvas({
  view,
  camera,
  focus,
  lens,
  stop,
  story,
  runsHidden,
  dimBlocks,
  dimRuns,
  hopBlocks,
  hopRuns,
  hover,
  onOpenLayer,
  onOpenPart,
  onHover,
}: CanvasProps) {
  const plan = planOf(view);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const { rig } = camera;

  /* The camera, written onto one element. `subscribe` fires once immediately, so there is no
     initial-paint special case. */
  const lastScale = useRef(0);
  useEffect(
    () =>
      rig.subscribe((pose) => {
        const el = worldRef.current;
        if (!el) return;
        el.style.transform = poseToTransform(pose);
        const q = quantise(pose.zoom);
        if (q !== lastScale.current) {
          lastScale.current = q;
          el.style.setProperty("--at-cs", String(Math.round((1 / q) * 1000) / 1000));
        }
      }),
    [rig],
  );

  const roving = useRoving(worldRef, { selector: "[data-roving]", columns: DIM.cols });

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      /* The canvas itself has focus: the keys are the camera's. Anything inside it has focus: the
         keys are the drawing's, and the camera keeps `+` / `-` / `Home`, which no block wants. */
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

  const open = focus.level > 0 ? focus.group : null;

  /* Component runs exist only for the layer that is open, and only above band 0. */
  const runs = useMemo(
    () => (open && camera.band > 0 ? partRuns(view, open as never, EDGES) : []),
    [camera.band, open, view],
  );

  const stopsBy = useMemo(() => {
    const out = new Map<string, number[]>();
    if (view !== "turn") return out;
    for (const s of TURN) {
      const bucket = out.get(s.block);
      if (bucket) bucket.push(s.index + 1);
      else out.set(s.block, [s.index + 1]);
    }
    return out;
  }, [view]);

  const liveBlock = view === "turn" ? (TURN[stop]?.block ?? null) : null;
  const b = plan.bounds;
  const world = WORLD;

  return (
    <div
      className="at-canvas"
      ref={composeRefs<HTMLDivElement>(rig.bind.ref, (el) => {
        canvasRef.current = el;
        camera.measure(el);
      })}
      data-band={camera.band}
      data-view={view}
      data-story={story ? "" : undefined}
      data-driving={camera.driving ?? undefined}
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
      aria-label="The blueprint. Drag to pan, wheel to zoom, arrows to move between blocks."
    >
      <div
        className="at-world"
        ref={worldRef}
        style={{
          width: `${world.w}px`,
          height: `${world.h}px`,
          marginLeft: `${-world.w / 2}px`,
          marginTop: `${-world.h / 2}px`,
        }}
      >
        <div className="at-sheet" aria-hidden />

        {/* Everything below is positioned by a `translate` from the middle of the sheet, which is
            where the plans' coordinates are centred. One zero-sized element holds that origin so
            no child needs to know the world's size. */}
        <div className="at-origin">
          {plan.regions.map((r) => (
            <div
              key={`${view}:${r.id}`}
              className="at-region"
              data-kind={r.kind}
              data-depth={r.depth}
              data-open={open === r.id ? "" : undefined}
              data-lit={lens.layers.has(r.id) ? "" : undefined}
              style={{
                transform: `translate(${r.x}px, ${r.y}px)`,
                width: `${r.w}px`,
                height: `${r.h}px`,
              }}
            >
              <span className="at-region-head" style={{ height: `${DIM.regionHead}px` }}>
                <span className="at-scaled">
                  <span className="at-region-name">{r.name}</span>
                  <span className="at-region-note" data-detail="context">
                    {r.note}
                  </span>
                </span>
              </span>
            </div>
          ))}

          <svg
            className="at-runs-box"
            style={{ transform: `translate(${b.x}px, ${b.y}px)` }}
            width={b.w}
            height={b.h}
            viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}
            aria-hidden
            focusable="false"
          >
            <Runs
              plan={plan}
              parts={runs}
              liveStop={view === "turn" ? stop + 1 : null}
              hidden={runsHidden}
              story={story}
              dimmed={dimRuns}
              hopped={hopRuns}
            />
          </svg>

          {plan.blocks.map((block) => (
            <Block
              key={block.id}
              block={block}
              focus={focus}
              lens={lens}
              open={open === block.layer}
              stops={stopsBy.get(block.id) ?? []}
              live={liveBlock === block.id}
              beat={story ? blockBeat(block.id, stop) : null}
              dim={dimBlocks.has(block.id)}
              hop={hopBlocks.has(block.id)}
              hovered={hover === block.id}
              onOpenLayer={onOpenLayer}
              onOpenPart={onOpenPart}
              onHover={onHover}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
