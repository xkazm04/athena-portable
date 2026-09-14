"use client";

/**
 * L0, prototype three — the cube kept, split into eight octants and a core.
 *
 * WHAT IT LOOKS LIKE. Round 1's object, with the quartering replaced: two by two
 * by two is eight cells, and the ninth database is a smaller core at the centre,
 * wired more firmly than the eight around it so it reads as the odd one rather
 * than as a mistake. Each cell carries a wash by state and one dot per table.
 *
 * HOW IT IS MANIPULATED. The free drag is gone; four poses, from the buttons or
 * the arrow keys inside them. That is this prototype's answer to the review's
 * first complaint, and it is also its weakness: a cube has cells behind cells,
 * so `front` alone never shows all nine and a reader has to change pose to be
 * sure. The slab does not have that problem, which is the trade the owner is
 * being asked to judge.
 *
 * WHAT IT COSTS. Identical to the slab's, because the parts are the same count:
 * `frameloop="demand"`, zero frames at rest, 27 draw calls in motion, 46 dot
 * instances in total.
 */

import { Canvas } from "@react-three/fiber";
import { useRef, useState, type CSSProperties } from "react";

import { CAMERA_FOV, CAMERA_Z, planeHeightFraction, PLANE_ASPECT } from "../../model";
import { POSES, type L0Props } from "../contract";
import { OctantScene } from "./Scene";

export function Octants(props: L0Props) {
  const { opening, out, reduced } = props;
  const [pose, setPose] = useState(0);
  const group = useRef<HTMLDivElement | null>(null);

  const shown = opening !== null ? -1 : pose;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (pose + step + POSES.length) % POSES.length;
    setPose(next);
    group.current?.querySelector<HTMLElement>(`[data-pose="${POSES[next]?.id}"]`)?.focus();
  };

  return (
    <div className="bk-l0-scene">
      <div className="bk-l0-canvas" data-opening={opening ?? ""}>
        <Canvas
          /* The camera is `model/flatten.ts`'s, not a second copy of it: the same
             two numbers decide where the published plane is, and a camera that
             drifted from them would put the L1 cells beside the dots rather
             than on them. */
          camera={{ position: [0, 0, CAMERA_Z], fov: CAMERA_FOV, near: 0.1, far: 100 }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true }}
          frameloop={opening !== null && !out ? "always" : "demand"}
          onPointerMissed={() => props.onHover(null)}
        >
          <OctantScene {...props} pose={shown} />
        </Canvas>

        <div
          className="bk-l0-plane"
          style={
            {
              "--plane-ar": PLANE_ASPECT,
              "--plane-h": planeHeightFraction(),
            } as CSSProperties
          }
          aria-hidden
        />
      </div>

      <div className="bk-pose" ref={group} onKeyDown={onKeyDown}>
        <span className="bk-pose-label" id="bk-pose-label-octants">
          Pose
        </span>
        <div className="bk-seg" role="radiogroup" aria-labelledby="bk-pose-label-octants">
          {POSES.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={i === pose}
              data-pose={p.id}
              className="bk-seg-option"
              tabIndex={i === pose ? 0 : -1}
              onClick={() => setPose(i)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="bk-pose-note">
          {reduced
            ? "Motion is turned down: the cube holds the front pose."
            : "Four poses, no free drag. A corner cell can hide behind another."}
        </span>
      </div>
    </div>
  );
}
