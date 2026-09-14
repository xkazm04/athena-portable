"use client";

/**
 * THE CAMERA OVER THE SHEET: the kit's rig and the kit's semantic zoom, wired to this drawing.
 *
 * There is almost nothing here, and that is the measurement round 4 is for. The whole camera —
 * drag to pan, wheel anchored at the pointer, pinch, `+`/`-`, `Home`, inertia, the fly on a
 * token-read duration, and "camera distance IS the level" in both directions — comes from
 * `useCameraRig` and `useSemanticZoom`. This module supplies four callbacks and two bounds.
 *
 * THE BOUNDS ARE THE OWNER'S VERDICT, TYPED. `yaw: [0, 0]`, `pitch: [0, 0]`: the drawing cannot be
 * turned, because a blueprint has no perspective and round 3's conclusion is that there is no good
 * practice to invent for one. The kit does not need to know that — its pose is four numbers and
 * two of them are simply pinned.
 *
 * NO `snap`. Round 3's gap 2: a snap list carrying `zoom` un-zooms the reader the instant they
 * stop turning the wheel, so the band is never crossed and the symptom is "the wheel does
 * nothing". In a direction where distance is the level, the only safe snap is one that does not
 * touch zoom, and this surface wants none at all.
 *
 * THE FRAME. `poseFor` needs the canvas's size to fit the whole sheet at L0, and the contract
 * hands the resolve callbacks a pose and no frame (round 3's gap 5, still open) — so the size is
 * measured here with a `ResizeObserver` and read through a ref. Logged again in KIT-GAPS.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useCameraRig,
  useSemanticZoom,
  type CameraPose,
  type CameraRig,
  type Focus,
  type LevelFlight,
  type ZoomNav,
} from "@athena/demo-kit/zoom";

import { BANDS, ZOOM_BOUNDS, homeZoom, poseFor, resolveGroup, resolveItem, type Frame } from "./poses";
import { PLANS, type ViewId } from "./plan";
import { centreOf } from "./geometry";

export interface CanvasCamera {
  rig: CameraRig;
  /** The band the camera is in — 0 the whole sheet, 1 one layer, 2 one component. */
  band: 0 | 1 | 2;
  /** Who is leading: the wheel, or a click/tool. For the surface to style the difference. */
  driving: "camera" | "nav" | null;
  /** Attach to the element the camera measures and listens on. */
  measure: (el: HTMLElement | null) => void;
  /** Re-fit and re-centre for the view that just became current. */
  refit: (view: ViewId) => void;
}

export function useCanvasCamera(
  nav: ZoomNav,
  flight: Pick<LevelFlight, "flight" | "settle" | "claim">,
  view: ViewId,
): CanvasCamera {
  const frame = useRef<Frame>({ w: 0, h: 0 });
  /* The current view, for the three callbacks the kit holds across renders. Written from an
     effect and not during render: a ref write in a render body is a write React cannot see, and
     the callbacks below are only ever called from an event or a frame, which is after it. */
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) frame.current = { w: box.width, h: box.height };
    });
    ro.observe(el);
    frame.current = { w: el.clientWidth, h: el.clientHeight };
    return () => ro.disconnect();
  }, [el]);

  const rig = useCameraRig({
    bounds: {
      zoom: [ZOOM_BOUNDS[0], ZOOM_BOUNDS[1]],
      yaw: [0, 0],
      pitch: [0, 0],
    },
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
    poseFor: useCallback(
      (focus: Focus) => poseFor(focus, viewRef.current, frame.current),
      [],
    ),
    flight,
  });

  /**
   * A view switch is not a level change: the reader stays where they are in the model and the
   * blocks move under them. So the camera re-frames the SAME focus in the new arrangement — which
   * is a fly, not a cut, and is the one piece of camera work this app does by hand.
   */
  const refit = useCallback(
    (next: ViewId) => {
      viewRef.current = next;
      rig.flyTo(poseFor(nav.state.focus, next, frame.current));
    },
    [nav.state.focus, rig],
  );

  /* The first paint has no measured frame, so the home pose it computed fitted nothing. One
     re-fit, once the observer has answered, and only while the reader is still at L0 and has not
     touched anything. */
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    const id = requestAnimationFrame(() => {
      if (fitted.current || frame.current.w === 0) return;
      fitted.current = true;
      if (nav.state.focus.level !== 0) return;
      const plan = PLANS[viewRef.current];
      rig.set({ zoom: homeZoom(viewRef.current, frame.current), pan: { x: -centreOf(plan.bounds).x, y: -centreOf(plan.bounds).y } });
    });
    return () => cancelAnimationFrame(id);
  });

  return useMemo<CanvasCamera>(
    () => ({
      rig,
      band: semantic.level,
      driving: semantic.driving,
      measure: setEl,
      refit,
    }),
    [refit, rig, semantic.driving, semantic.level],
  );
}
