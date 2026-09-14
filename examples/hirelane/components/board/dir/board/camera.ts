"use client";

/**
 * The control variant's one new thing: a free camera over L0.
 *
 * WHAT IT IS FOR. `rooms` and `constellation` both put a camera at the centre of
 * their concept, so a round that only built those two could not tell a good
 * concept from a good rig. This is the rig on its own, over a surface whose
 * composition has already been reviewed twice: drag to pan, wheel to zoom
 * anchored at the pointer, arrows and `+`/`-` from the keyboard, and one band —
 * zoom past it and the group row under the camera opens.
 *
 * WHY THE CAMERA HOLDS ONLY L0. The board's level change is an ECHO (rule 1):
 * the outgoing copy carries the whole gesture and the arriving level mounts at
 * full size. A camera that also scaled the arriving carousel would be a second
 * gesture on the same move, and the carousel's cards are laid out in pixels
 * against a `--card` token — read at 1.4x they stop being the deck the round-2
 * review passed. So the scene under the rig is the board and nothing else; the
 * carousel and the echo are siblings of it, untransformed.
 *
 * That has a consequence worth stating rather than hiding: at L1 the camera is
 * parked at a zoom that shows an empty scene. It is parked there ON PURPOSE —
 * `poseFor` has to agree with `bands` or the hook flaps, dispatching `up` on the
 * frame after `openGroup` — and Escape flies it back out as the board arrives.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  REST_POSE,
  poseToTransform,
  useCameraRig,
  useSemanticZoom,
  type CameraPose,
  type CameraRig,
  type Focus,
  type LevelFlight,
  type ZoomNav,
} from "@athena/demo-kit/zoom";

/**
 * The one band: past this zoom the camera is inside a group.
 *
 * 1.55 rather than 2: a board that has to be doubled in size before it admits
 * you are looking at one row makes the wheel feel like a magnifier rather than
 * like a move. The second band is out of reach of the bounds below, because this
 * direction's L1 → L2 is a click on a card and a camera has nothing to add to it.
 */
const BAND_GROUP = 1.55;
const BAND_ITEM = 99;

/** How far out and in the reader may take the board. */
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 2.4;
/** How far the board may be pushed off centre, in scene units at zoom 1. */
const PAN_LIMIT = 420;

export interface BoardCamera {
  bind: CameraRig["bind"];
  rig: CameraRig;
  /** False until the reader has actually moved the camera: the hint reads it. */
  touched: boolean;
}

export function useBoardCamera({
  nav,
  flight,
  sceneRef,
}: {
  nav: ZoomNav;
  flight: LevelFlight;
  sceneRef: React.RefObject<HTMLElement | null>;
}): BoardCamera {
  const rig = useCameraRig({
    bounds: {
      zoom: [ZOOM_MIN, ZOOM_MAX],
      pan: { x: [-PAN_LIMIT, PAN_LIMIT], y: [-PAN_LIMIT, PAN_LIMIT] },
    },
    /* One pointer pans. There is nothing to orbit: the board is a flat sheet and
       a yaw on it would be a skew pretending to be depth. */
    drag: "pan",
    wheel: "zoom",
    /* No inertia and no snap. A board is read, not flown — and a surface that
       keeps drifting after the reader has stopped is a surface that cannot be
       pointed at, which is the one thing L0 exists to let them do. */
    inertia: 0,
    snap: null,
    keyboard: true,
    reducedMotion: "user",
    flyToken: "--bd-dur-4",
  });

  /*
   * WHICH GROUP IS UNDER THE CAMERA, read off the DOM rather than off the pose.
   *
   * The rig writes the scene's transform itself, so a row's
   * `getBoundingClientRect()` already answers in the camera's terms — which
   * means the inverse projection this would otherwise need does not have to be
   * written, or kept in step with the transform when the transform changes.
   * Nearest row centre to the middle of the frame; a frame with no rows in it
   * (every column filtered away) answers `null` and the crossing is ignored.
   */
  const resolveGroup = useCallback((): string | null => {
    const scene = sceneRef.current;
    if (!scene) return null;
    const box = scene.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    let best: string | null = null;
    let bestD = Infinity;
    for (const row of scene.querySelectorAll<HTMLElement>("[data-group]")) {
      const id = row.dataset.group;
      if (!id) continue;
      const r = row.getBoundingClientRect();
      const dx = r.left + r.width / 2 - cx;
      const dy = r.top + r.height / 2 - cy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }, [sceneRef]);

  const poseFor = useCallback(
    (at: Focus): Partial<CameraPose> =>
      at.level === 0 ? REST_POSE : { zoom: BAND_GROUP * 1.12 },
    [],
  );

  useSemanticZoom(nav, rig, {
    bands: [BAND_GROUP, BAND_ITEM],
    resolveGroup,
    /* L1 → L2 is a click on a card in this direction. Answering `null` leaves the
       camera at L1 rather than inventing a second way in. */
    resolveItem: () => null,
    poseFor,
    flight,
  });

  /*
   * THE POSE ONTO THE SCENE, and not through a render.
   *
   * The kit's one-line stage: the rig calls back on every pose change and the
   * transform is written to the element. Forty group rows re-rendered sixty
   * times a second while a wheel is turning would be rule 9 failing from the
   * other end — and the pose is not something any component's OUTPUT depends on,
   * only this one string is.
   */
  useEffect(
    () =>
      rig.subscribe((pose) => {
        const el = sceneRef.current;
        if (el) el.style.transform = poseToTransform(pose);
      }),
    [rig, sceneRef],
  );

  /*
   * The hint goes away the first time the reader touches the camera, and it has
   * to be told by the rig rather than by a click handler on the scene: a wheel
   * over the board is a use of the camera and is not a click on anything.
   */
  const [touched, setTouched] = useState(false);
  const seen = useRef(false);
  useEffect(
    () =>
      rig.subscribe((_, moving) => {
        if (!moving || seen.current) return;
        seen.current = true;
        setTouched(true);
      }),
    [rig],
  );

  return { bind: rig.bind, rig, touched };
}

/** The bands, exported so a test can assert they are ordered and reachable. */
export const BOARD_BANDS: readonly [number, number] = [BAND_GROUP, BAND_ITEM];
export const BOARD_ZOOM: readonly [number, number] = [ZOOM_MIN, ZOOM_MAX];
