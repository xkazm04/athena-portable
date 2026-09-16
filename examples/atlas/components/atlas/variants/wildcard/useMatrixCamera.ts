"use client";

/**
 * THE CAMERA OVER THE FIELD: the kit's rig and the kit's semantic zoom, wired to a matrix.
 *
 * Almost nothing here, which is the measurement the round is for. Drag to pan, wheel anchored at
 * the pointer, pinch, `+`/`-`/`Home`, inertia, the fly on a token-read duration, and "camera
 * distance IS the level" in both directions all come from `useCameraRig` and `useSemanticZoom`.
 * This module supplies four callbacks, two pinned bounds and one measured frame.
 *
 * THE FRAME IS PUBLIC HERE, and that is the difference from round 4. The blueprint measured its
 * canvas privately because only `poseFor` needed it; this direction's HEADER RAILS live in screen
 * space and have to project world coordinates into the same box the camera is transforming, so
 * the measurement is part of the camera's public shape. Round 3's gap 5 — *"the resolve callbacks
 * get a pose but no frame"* — is why `poseFor` still has to close over a ref instead of being
 * handed one, and it is logged again in KIT-GAPS.
 *
 * NO `snap`, `yaw: [0, 0]`, `pitch: [0, 0]`. The first is round 3's gap 2 (a snap list carrying
 * `zoom` defeats semantic zoom); the second and third are the owner's round-3 verdict on 3D,
 * typed as bounds. A matrix has no perspective to want.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  useCameraRig,
  useSemanticZoom,
  type CameraPose,
  type CameraRig,
  type Focus,
  type LevelFlight,
  type ZoomNav,
} from "@athena/demo-kit/zoom";

import { BOUNDS, centreOf } from "./matrix";
import {
  BANDS,
  ZOOM_BOUNDS,
  homeZoom,
  poseFor,
  resolveGroup,
  resolveItem,
  type Frame,
} from "./poses";

export interface MatrixCamera {
  rig: CameraRig;
  /** The band the camera is in — 0 the whole field, 1 one layer, 2 one component. */
  band: 0 | 1 | 2;
  /** Who is leading: the wheel, or a click/tool. For the surface to style the difference. */
  driving: "camera" | "nav" | null;
  /** Attach to the element the camera measures and listens on. */
  measure: (el: HTMLElement | null) => void;
  /** That element's box, in CSS pixels. Read from a frame callback; never a render dependency. */
  frame: RefObject<Frame>;
  /**
   * Bumped whenever the frame is re-measured.
   *
   * The rails project world coordinates into this box on the camera's own frame callback, and a
   * resize moves every one of them without the camera moving at all — so the one thing they
   * cannot read from a ref is *when to look again*. This is that signal, and it is a render
   * dependency rather than a ref precisely because it must re-run an effect.
   */
  frameTick: number;
}

export function useMatrixCamera(
  nav: ZoomNav,
  flight: Pick<LevelFlight, "flight" | "settle" | "claim">,
): MatrixCamera {
  const frame = useRef<Frame>({ w: 0, h: 0 });
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [frameTick, setFrameTick] = useState(0);

  /* The size the tick was last bumped for. `ResizeObserver` delivers its first callback right
     after `observe`, which is where the mount's tick comes from — so nothing here sets state
     synchronously in an effect body, and the eager write below is a ref, not a render. */
  const reported = useRef("");
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (!box) return;
      frame.current = { w: box.width, h: box.height };
      const key = `${box.width}x${box.height}`;
      if (reported.current === key) return;
      reported.current = key;
      setFrameTick((n) => n + 1);
    });
    ro.observe(el);
    frame.current = { w: el.clientWidth, h: el.clientHeight };
    return () => ro.disconnect();
  }, [el]);

  const rig = useCameraRig({
    bounds: { zoom: [ZOOM_BOUNDS[0], ZOOM_BOUNDS[1]], yaw: [0, 0], pitch: [0, 0] },
    drag: "pan",
    wheel: "zoom",
    inertia: 0.86,
    snap: null,
    keyboard: true,
    flyToken: "--wc-dur-move",
    easeToken: "--wc-ease",
  });

  const semantic = useSemanticZoom(nav, rig, {
    bands: BANDS,
    resolveGroup: useCallback((pose: CameraPose) => resolveGroup(pose), []),
    resolveItem: useCallback((pose: CameraPose, group: string) => resolveItem(pose, group), []),
    poseFor: useCallback((focus: Focus) => poseFor(focus, frame.current), []),
    flight,
  });

  /* The first paint has no measured frame, so the home pose it computed fitted nothing. One
     re-fit once the observer has answered, and only while the reader is still at L0. */
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    const id = requestAnimationFrame(() => {
      if (fitted.current || frame.current.w === 0) return;
      fitted.current = true;
      if (nav.state.focus.level !== 0) return;
      const mid = centreOf(BOUNDS);
      rig.set({ zoom: homeZoom(frame.current), pan: { x: -mid.x, y: -mid.y } });
    });
    return () => cancelAnimationFrame(id);
  });

  return useMemo<MatrixCamera>(
    () => ({ rig, band: semantic.level, driving: semantic.driving, measure: setEl, frame, frameTick }),
    [frameTick, rig, semantic.driving, semantic.level],
  );
}
