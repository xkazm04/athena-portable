"use client";

/**
 * THE CAMERA, AND WHY DISTANCE IS THE LEVEL.
 *
 * The camera contract's §3 is the round's real idea: "camera distance is the level". Atlas's
 * three depths stop being three screens and become three distances from one machine — L0 is far
 * enough to see the whole stack, L1 is close enough that one stratum fills the frame, L2 is close
 * enough that a part is a thing you could read. A reader who turns the wheel does not change
 * page; they walk toward the machine, and the level changes because they did.
 *
 * THE KIT OWNS THE RIG AND THE LOOP. `useCameraRig` holds the pose, the drag, the wheel, the
 * inertia, the snaps and the keyboard; `useSemanticZoom` owns the two-way binding between the
 * camera and the nav, including the marker that stops the two echoing each other and the claim
 * and settle of the flight. Atlas contributes only what is ITS opinion — where the bands are,
 * what the camera may do, where it stands for a focus, and which stratum is under it — which is
 * the right seam, and a much smaller file than the one it replaced.
 *
 * `poseFor` is the interesting half. The pan is what aims the camera: panning by the target's
 * offset from the scene centre, resolved onto the camera's own right/up axes, is how a point that
 * is not the orbit centre ends up in the middle of the frame WITHOUT moving the orbit centre —
 * which matters, because moving it would make the reader's next drag spin around the wrong axis.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useCameraRig,
  useSemanticZoom,
  type CameraPose,
  type CameraRig,
  type Focus,
  type LevelFlight,
  type ZoomNav,
} from "@athena/demo-kit/zoom";

import { poseFor, strataUnder } from "./aim";
import { BANDS, BOUNDS, HOME_POSE, SNAPS, snapPose } from "./poses";
import type { Pose } from "./project";

export type { CameraRig, CameraPose };
export { BANDS, BOUNDS, HOME_POSE, SNAPS, snapPose } from "./poses";
export { poseFor, strataUnder } from "./aim";

/* ---------------------------------------- the hook ---------------------------------------- */

export interface AtlasCamera {
  rig: CameraRig;
  /** Which side is currently leading the level, for a surface that wants to style the difference. */
  driving: "camera" | "nav" | null;
}

export function useAtlasCamera(
  nav: Pick<ZoomNav, "state" | "openGroup" | "openItem" | "up">,
  flight: Pick<LevelFlight, "flight" | "settle" | "claim">,
): AtlasCamera {
  const rig = useCameraRig({
    initial: HOME_POSE,
    bounds: BOUNDS,
    drag: "orbit",
    wheel: "zoom",
    inertia: 0.88,
    /* A FUNCTION, not the list: a snap that carried `zoom` would undo the reader's wheel the
       instant they stopped turning it, and in a direction where distance is the level that means
       the level never changes. See `snapPose`. */
    snap: snapPose,
    keyboard: true,
    reducedMotion: "user",
    /* Rule 4: the flight's duration and curve are the app's ONE clock, read out of the cascade
       by the kit rather than typed here. The camera's move IS the level change in this
       direction, so it must be the level change's duration. */
    flyToken: "--at-dur-move",
    easeToken: "--at-ease",
  });

  const options = useMemo(
    () => ({
      bands: BANDS,
      resolveGroup: strataUnder,
      /*
       * THE CAMERA CANNOT OPEN AN ITEM AND DOES NOT PRETEND TO.
       *
       * At the distance where the L2 band is crossed, every part of the block in frame is under
       * the camera; picking one would be picking arbitrarily and then flying somewhere the reader
       * did not choose. So the wheel stops at L1 and a part is opened by clicking it or by a
       * tool. Logged in KIT-GAPS round 3: the contract's `resolveItem` assumes the item under the
       * camera is a question with an answer, and for a scene whose items are inside a container
       * it is not.
       */
      resolveItem: () => null,
      poseFor: (focus: Focus) => poseFor(focus, rig.get()),
      flight,
    }),
    [flight, rig],
  );

  const { driving } = useSemanticZoom(nav, rig, options);
  return { rig, driving };
}

/**
 * A pose subscription for a React surface that genuinely needs to re-render.
 *
 * Almost nothing does — the renderers write the DOM and the canvas imperatively from
 * `rig.subscribe`, which is the whole reason a drag costs no reconciliation. This exists for the
 * one case that cannot: a control whose disabled state depends on where the camera is.
 */
export function usePose(rig: CameraRig, when: "always" | "settled" = "always"): Pose {
  const [pose, setPose] = useState<Pose>(rig.get());
  const raf = useRef(0);
  const next = useRef<Pose | null>(null);
  useEffect(() => {
    return rig.subscribe((p, moving) => {
      if (when === "settled" && moving) return;
      next.current = p;
      if (raf.current !== 0) return;
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        if (next.current) setPose(next.current);
      });
    });
  }, [rig, when]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return pose;
}

