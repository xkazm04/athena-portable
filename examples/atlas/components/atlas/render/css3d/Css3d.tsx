"use client";

/**
 * VARIANT 1 — CSS 3D. The machine built out of the document.
 *
 * Every stratum is a `<div>` rotated flat, every block is five `<div>`s making a box, every part
 * is a plate on its block's lid, and every label is real text a reader can select, search with
 * the browser's own find, and read with a screen reader without anybody writing a description of
 * a picture. That is the case FOR this technique and it is a strong one.
 *
 * THE TWO THINGS THAT MAKE IT WORK, both of them non-obvious:
 *
 *   1. The transform is written to the DOM, not to React. A camera drag produces sixty poses a
 *      second; a React tree of ~250 transformed nodes re-rendered at that rate would be the
 *      slowest thing in the repository. So the world's transform, the billboard angles and every
 *      pipe's `points` attribute are set imperatively from the rig's subscription, and React
 *      renders only when the MODEL changes — the level, the lens, the turn's stop.
 *   2. The pipes cannot be CSS. A polyline routed through six points in space does not lie in any
 *      one plane, and a `<div>` is a plane. So they are one screen-space `<svg>` whose points come
 *      from `project()` — the same pinhole `cssView()` is derived to agree with, which is why the
 *      lines land on the faces of the boxes instead of near them.
 *
 * THE HONEST WEAKNESS, stated where the code is rather than only in the report: the SVG overlay
 * has no depth. A pipe that runs behind a block is drawn over it. `--at-c3-fade` softens the
 * pipes so the boxes still read as solid, but the machine has no true occlusion and at some
 * angles a pipe appears to pass in front of a stratum it goes behind.
 */
import { memo, useCallback, useEffect, useMemo, useRef } from "react";

import { turnAt } from "../../scene/turn";
import {
  DIM,
  blockAt,
  type Block,
  type Part,
  type Stratum,
} from "../../scene/layout";
import { cssPoint, cssView, project, viewOf, type Pose } from "../../scene/project";
import type { SceneProps, Weight } from "../contract";
import { composeRefs, useFrameSize, useTap } from "../useFrameSize";

/* --------------------------------- the imperative half --------------------------------- */

/** Four decimals is under a tenth of a pixel at any zoom the bounds allow. */
const n = (v: number): string => v.toFixed(2);

export function Css3d(props: SceneProps) {
  const { rig, transport, focus, weights, onHover, onOpenStratum, onOpenPart, scene } = props;
  const frameRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pipeRefs = useRef(new Map<string, SVGPolylineElement>());
  const lightRef = useRef<SVGGElement | null>(null);
  const legRef = useRef<SVGPolylineElement | null>(null);
  const size = useFrameSize(frameRef);
  const tap = useTap();

  /* One draw, from a pose and a beat. Called on every rig frame and every transport frame, and
     it touches the DOM directly: no setState, no reconciliation, no garbage per frame. */
  const draw = useCallback(
    (pose: Pose, beat: number) => {
      const world = worldRef.current;
      const stage = stageRef.current;
      if (!world || !stage || size.h === 0) return;
      const css = cssView(pose, size);
      stage.style.perspective = `${n(css.perspective)}px`;
      world.style.transform = css.transform;
      /* ONE write for every billboard on the surface: the labels counter-rotate through these
         two custom properties, so a thousand labels cost two style writes rather than a
         thousand transforms. */
      world.style.setProperty("--at-c3-yaw", `${n((pose.yaw * 180) / Math.PI)}deg`);
      world.style.setProperty("--at-c3-pitch", `${n((-pose.pitch * 180) / Math.PI)}deg`);

      const view = viewOf(pose);
      for (const pipe of scene.pipes) {
        const el = pipeRefs.current.get(pipe.id);
        if (!el) continue;
        const pts = pipe.points.map((p) => project(p, view, size));
        el.setAttribute(
          "points",
          pts.every((p) => p.visible) ? pts.map((p) => `${n(p.x)},${n(p.y)}`).join(" ") : "",
        );
      }

      const f = turnAt(beat);
      const light = lightRef.current;
      if (light) {
        const at = project(f.at, view, size);
        light.setAttribute("transform", `translate(${n(at.x)} ${n(at.y)})`);
        light.style.opacity = at.visible ? "1" : "0";
        light.setAttribute("data-kind", f.stop.kind);
        light.setAttribute("data-parked", f.parked ? "" : "false");
      }
      const leg = legRef.current;
      if (leg) {
        const pts = f.stop.leg?.points ?? [];
        const drawn = pts.map((p) => project(p, view, size));
        leg.setAttribute(
          "points",
          drawn.length > 1 && drawn.every((p) => p.visible)
            ? drawn.map((p) => `${n(p.x)},${n(p.y)}`).join(" ")
            : "",
        );
      }
    },
    [scene.pipes, size],
  );

  useEffect(() => {
    draw(rig.get(), transport.beat());
    const offPose = rig.subscribe((pose) => draw(pose, transport.beat()));
    const offBeat = transport.subscribe((beat) => draw(rig.get(), beat));
    return () => {
      offPose();
      offBeat();
    };
  }, [draw, rig, transport]);

  /* ------------------------------------ the tree ------------------------------------ */

  const open = focus.group;
  const pick = useCallback(
    (kind: "stratum" | "part", id: string) => () => {
      if (!tap.wasTap()) return;
      if (kind === "stratum") onOpenStratum(id);
      else onOpenPart(id);
    },
    [onOpenPart, onOpenStratum, tap],
  );

  return (
    <div
      className="at-c3"
      {...rig.bind}
      {...tap.handlers}
      /* Both refs: the rig's (its non-passive wheel listener) and ours (the measured frame).
         Spreading `bind` over a plain `ref` would silently drop one of them. */
      ref={composeRefs<HTMLDivElement>(frameRef, rig.bind.ref)}
      role="application"
      aria-label="The machine. Drag to orbit, wheel to zoom, Home to reset."
    >
      <div className="at-c3-stage" ref={stageRef}>
        <div className="at-c3-world" ref={worldRef}>
          {scene.strata.map((s) => (
            <Plane
              key={s.id}
              stratum={s}
              w={weights.stratum(s)}
              onPick={pick("stratum", s.id)}
              onHover={onHover}
            />
          ))}
          {scene.blocks.map((b) => (
            <Box
              key={b.id}
              block={b}
              w={weights.block(b)}
              opened={open === b.layer && focus.level > 0}
              parts={b.parts.map((p) => ({ part: p, w: weights.part(p) }))}
              onPickBlock={pick("stratum", b.layer)}
              onPickPart={onOpenPart}
              wasTap={tap.wasTap}
              onHover={onHover}
            />
          ))}
        </div>
      </div>

      <svg
        className="at-c3-pipes"
        ref={svgRef}
        viewBox={`0 0 ${Math.max(1, size.w)} ${Math.max(1, size.h)}`}
        width={size.w}
        height={size.h}
        aria-hidden
        focusable="false"
      >
        {scene.pipes.map((p) => (
          <polyline
            key={p.id}
            ref={(el) => {
              if (el) pipeRefs.current.set(p.id, el);
              else pipeRefs.current.delete(p.id);
            }}
            className="at-c3-pipe"
            data-flow={p.flow}
            data-live={
              blockAt(p.from)?.layer === open || blockAt(p.to)?.layer === open ? "" : undefined
            }
            style={{ strokeWidth: Math.min(3, 1 + p.weight / 4) }}
          />
        ))}
        <polyline ref={legRef} className="at-c3-leg" />
        <g ref={lightRef} className="at-c3-light">
          <circle className="at-c3-light-halo" r={DIM.partH * 5} />
          <circle className="at-c3-light-core" r={DIM.partH * 1.6} />
        </g>
      </svg>
    </div>
  );
}

/* -------------------------------------- the pieces -------------------------------------- */

const Plane = memo(function Plane({
  stratum,
  w,
  onPick,
  onHover,
}: {
  stratum: Stratum;
  w: Weight;
  onPick: () => void;
  onHover: (id: string | null) => void;
}) {
  return (
    <div
      className="at-c3-plane"
      data-open={w.open ? "" : undefined}
      data-lit={w.lit ? "" : undefined}
      style={{
        opacity: w.presence,
        width: stratum.w,
        height: stratum.d,
        /* ROTATE, THEN CENTRE. CSS applies a transform list outermost-first, so a
           `translate(-50%, -50%)` written before `rotateX(90deg)` shifts the plane in the world's
           vertical axis — it moves UP THE STACK by half its depth instead of back in depth. The
           whole machine leans by 37 units and the pipes stop meeting the faces. */
        transform: `${cssPoint({ x: 0, y: stratum.y, z: 0 })} rotateX(90deg) translate(-50%, -50%)`,
      }}
    >
      <button
        type="button"
        className="at-c3-plane-tab"
        onClick={onPick}
        onPointerEnter={() => onHover(stratum.id)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(stratum.id)}
        onBlur={() => onHover(null)}
      >
        <span className="at-c3-plane-part">{stratum.part}</span>
        <span className="at-c3-plane-name">{stratum.name}</span>
        <span className="at-c3-plane-fig">
          {stratum.blocks}&thinsp;/&thinsp;{stratum.parts}
        </span>
      </button>
    </div>
  );
});

const Box = memo(function Box({
  block,
  w,
  opened,
  parts,
  onPickBlock,
  onPickPart,
  wasTap,
  onHover,
}: {
  block: Block;
  w: Weight;
  opened: boolean;
  parts: { part: Part; w: Weight }[];
  onPickBlock: () => void;
  onPickPart: (id: string) => void;
  wasTap: () => boolean;
  onHover: (id: string | null) => void;
}) {
  const walls = useMemo(
    () => [
      { t: `translate3d(0px, ${-block.h / 2}px, ${block.d / 2}px)`, w: block.w, h: block.h },
      {
        t: `translate3d(0px, ${-block.h / 2}px, ${-block.d / 2}px) rotateY(180deg)`,
        w: block.w,
        h: block.h,
      },
      {
        t: `translate3d(${block.w / 2}px, ${-block.h / 2}px, 0px) rotateY(90deg)`,
        w: block.d,
        h: block.h,
      },
      {
        t: `translate3d(${-block.w / 2}px, ${-block.h / 2}px, 0px) rotateY(-90deg)`,
        w: block.d,
        h: block.h,
      },
    ],
    [block.d, block.h, block.w],
  );

  return (
    <div
      className="at-c3-block"
      data-status={block.status}
      data-lit={w.lit ? "" : undefined}
      data-turn={w.onTurn ? "" : undefined}
      data-live={w.live ? "" : undefined}
      data-open={opened ? "" : undefined}
      data-hot={w.hot ? "" : undefined}
      style={{ opacity: w.presence, transform: cssPoint({ x: block.x, y: block.y, z: block.z }) }}
    >
      {walls.map((wall, i) => (
        <i
          key={i}
          className="at-c3-wall"
          style={{
            width: wall.w,
            height: wall.h,
            transform: `${wall.t} translate(-50%, -50%)`,
          }}
        />
      ))}
      <div
        className="at-c3-lid"
        style={{
          width: block.w,
          height: block.d,
          transform: `translate3d(0px, ${-block.h}px, 0px) rotateX(90deg) translate(-50%, -50%)`,
        }}
      />
      {/* The anchor and the billboard are two elements ON PURPOSE. The anchor carries the inline
          translate that puts it on the block's lid; the button carries the counter-rotation, in
          CSS. Putting both on one element means the inline style wins and the label silently
          renders unrotated and unscaled at its full 3D size — which is exactly what happened, and
          it took a `getComputedStyle` to see, because a too-big label looks like a design
          decision. */}
      <i className="at-c3-tag-at" style={{ transform: `translate3d(0px, ${-block.h}px, 0px)` }}>
        <button
          type="button"
          className="at-c3-block-tag"
          onClick={() => wasTap() && onPickBlock()}
          onPointerEnter={() => onHover(block.id)}
          onPointerLeave={() => onHover(null)}
          onFocus={() => onHover(block.id)}
          onBlur={() => onHover(null)}
          tabIndex={opened ? 0 : -1}
        >
          {block.name}
        </button>
      </i>

      {parts.map(({ part, w: pw }) => (
        <button
          key={part.id}
          type="button"
          className="at-c3-part"
          data-status={part.status}
          data-lit={pw.lit ? "" : undefined}
          data-turn={pw.onTurn ? "" : undefined}
          data-live={pw.live ? "" : undefined}
          data-open={pw.open ? "" : undefined}
          title={part.name}
          tabIndex={opened ? 0 : -1}
          style={{
            width: part.w,
            height: part.d,
            opacity: pw.presence,
            transform: `translate3d(${part.x - block.x}px, ${-(part.y - block.y)}px, ${part.z - block.z}px) rotateX(90deg) translate(-50%, -50%)`,
          }}
          onClick={() => wasTap() && onPickPart(part.id)}
          onPointerEnter={() => onHover(part.id)}
          onPointerLeave={() => onHover(null)}
          onFocus={() => onHover(part.id)}
          onBlur={() => onHover(null)}
        >
          <span className="at-c3-part-name">{part.name}</span>
        </button>
      ))}
    </div>
  );
});
