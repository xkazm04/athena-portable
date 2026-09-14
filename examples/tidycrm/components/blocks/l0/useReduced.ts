"use client";

/**
 * The reduced-motion preference, read as the external state it is.
 *
 * An effect that mirrors a media query into component state renders once with
 * the wrong answer and then again with the right one, which for a WebGL scene
 * means it starts a move and then stops it. It lived in `cube/Turntable.tsx` in
 * round 1 and is here now because all three prototypes ask the same question.
 */

import { useSyncExternalStore } from "react";

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useReducedMotionQuery(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOTION_QUERY).matches,
    () => false,
  );
}
