"use client";

/**
 * The wheel, owned by the sheet rather than by the rig — and the ONE thing in
 * round 3 the camera contract could not carry.
 *
 * `zoomAt(pose, factor, anchor, frame)` keeps the scene point under the pointer
 * fixed, and it does it without knowing anything about the scene, from
 *
 *     a = z (w + pan)   ⇒   pan₂ = pan₁ + a (1/z₂ − 1/z₁)
 *
 * where `a` is the anchor's offset from the frame's centre IN PIXELS and `pan`
 * is in scene units. That identity is exact for an ORTHOGRAPHIC stage, where one
 * scene unit is one pixel at zoom 1 — which is what "DOM: px at zoom 1" in the
 * contract means, and it is the only stage the kit can assume.
 *
 * A PERSPECTIVE CAMERA HAS A SECOND CONSTANT. Here the screen offset of a point
 * on the plane the camera is looking at is
 *
 *     a = (focal / distance) · w_world = (focal / CAMERA_Z) · z · w_world
 *
 * so the kit's identity holds with `pan` measured in `CAMERA_Z / focal` world
 * units — and `focal` is `(frameHeight / 2) / tan(fov / 2)`, which the kit is
 * forbidden to know, because knowing it would mean knowing there is a camera.
 * With this scene's numbers the factor is about 118, so the kit's own wheel
 * anchors a hundred and eighteen times too hard and the cube leaves the frame on
 * the first notch.
 *
 * SO THE RIG'S WHEEL IS TURNED OFF (`wheel: "none"`) and this hook does the same
 * thing THROUGH THE KIT'S OWN `zoomAt`, handing it an anchor pre-converted into
 * the units its arithmetic is written in. Nothing is forked: the pure function
 * the kit tests is the function that runs. What the app supplies is the one
 * number the contract has no field for.
 *
 * The listener is native and non-passive, for the same reason the rig's is:
 * React registers `wheel` passively on its root, so a React `onWheel` cannot
 * `preventDefault()` and the page scrolls behind the zoom.
 *
 * Reported as a kit gap. The fix is small: `CameraRigOptions.unitsPerPixel?:
 * (pose, frame) => number`, defaulting to `1 / pose.zoom`, threaded into
 * `zoomAt` — after which a perspective scene gets the wheel, the pinch and the
 * shift-drag right and this file is deleted.
 */
import { useEffect, type RefObject } from "react";

import { zoomAt, type CameraRig } from "@athena/demo-kit/zoom";

import { CAMERA_FOV, CAMERA_Z } from "../model";

/** Zoom per pixel of wheel travel, through `exp` so up and down are exact inverses. */
const PER_PIXEL = 0.0016;
/** A line and a page of wheel delta, in pixels — Firefox reports both. */
const LINE = 16;
const PAGE = 400;

/** World units per pixel of anchor offset, at zoom 1, for a frame this tall. */
function worldPerPixel(frameHeight: number): number {
  const focal = frameHeight / 2 / Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);
  return CAMERA_Z / focal;
}

export function useWheelZoom(rig: CameraRig, frame: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = frame.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      const box = el.getBoundingClientRect();
      if (box.height === 0) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? PAGE : 1;
      const factor = Math.exp(-event.deltaY * unit * PER_PIXEL);

      /*
       * The anchor, converted into the units `zoomAt` is written in.
       *
       * `pan.x` is the target's offset along the camera's RIGHT, so moving it
       * toward +x moves the image the other way — hence the mirrored x. `pan.y`
       * is along UP and the screen's y runs down, and those two inversions
       * cancel, so y is only scaled. The arithmetic is derived in the header.
       */
      const k = worldPerPixel(box.height);
      const ax = event.clientX - box.left - box.width / 2;
      const ay = event.clientY - box.top - box.height / 2;
      rig.set(
        zoomAt(
          rig.get(),
          factor,
          { x: box.width / 2 - ax * k, y: box.height / 2 + ay * k },
          { w: box.width, h: box.height },
        ),
      );
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // `frame` is a ref object and never changes identity; the element it holds
    // is set by the same commit that mounts this hook's owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rig]);
}
