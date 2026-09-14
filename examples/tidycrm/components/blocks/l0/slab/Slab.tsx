"use client";

/**
 * L0, prototype two — nine databases as a 3x3x1 slab, in WebGL.
 *
 * WHAT IT LOOKS LIKE. One object, not nine: a slab the thickness of one cell,
 * ruled into a three-by-three. Each cell is a translucent solid — a quiet wash
 * when nothing inside is outstanding, a subtle redline wash when any of its
 * tables is — with its tables drawn as dots floating on its front face. The
 * shape is the reason to prefer it over the octant cube: nine cells on one face
 * means nothing is ever behind anything, so a reader never has to turn the
 * object to be sure they have seen all nine.
 *
 * HOW IT IS MANIPULATED. Four poses and nothing else. The review's finding was
 * that the cube was "tough to manipulate with mouse drags"; a drag offers an
 * infinity of poses, all but a few worse than the one you started from, and no
 * way back. The four below are reachable by button, by arrow key inside the pose
 * control, and named in the caption, so a reader always knows which one they are
 * in and can always get back to `front`.
 *
 * WHAT IT COSTS. `frameloop="demand"`, so a settled slab draws nothing at all —
 * round 1's rule 9, kept. In motion it is 27 draw calls: nine fills, nine
 * wireframes and nine instanced dot meshes of five or six instances each. The
 * cube it replaces drew 800 instances; there are 46 dots here, one per table,
 * which is the review's other request and happens to be sixteen times less
 * geometry.
 */

import { Canvas } from "@react-three/fiber";
import { useRef, useState, type CSSProperties } from "react";

import { CAMERA_FOV, CAMERA_Z, planeHeightFraction, PLANE_ASPECT } from "../../model";
import { POSES, type L0Props } from "../contract";
import { SlabScene } from "./Scene";

export function Slab(props: L0Props) {
  const { opening, out, reduced } = props;
  const [pose, setPose] = useState(0);
  const group = useRef<HTMLDivElement | null>(null);

  /* A move squares the slab up: the plane the dots land in has to be face-on,
     or it is a parallelogram. The pose the reader chose is restored when the
     move is abandoned, because they chose it. */
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
          /* See the file header and round 1's rule 9. `always` only while the
             flatten is a duration the DOM is waiting on, because a stalled
             flatten is a reader stranded on the plate. */
          frameloop={opening !== null && !out ? "always" : "demand"}
          onPointerMissed={() => props.onHover(null)}
        >
          <SlabScene {...props} pose={shown} />
        </Canvas>

        {/* The plane every variant publishes. Sized from the camera arithmetic
            in `model/flatten.ts` rather than from a percentage somebody
            measured, so the box and the dots cannot drift. */}
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
        <span className="bk-pose-label" id="bk-pose-label-slab">
          Pose
        </span>
        <div className="bk-seg" role="radiogroup" aria-labelledby="bk-pose-label-slab">
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
            ? "Motion is turned down: the slab holds the front pose."
            : "Four poses, no free drag. Arrow keys move between them."}
        </span>
      </div>
    </div>
  );
}
