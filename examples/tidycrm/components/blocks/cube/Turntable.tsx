"use client";

/**
 * The slow turn, and the preference that switches it off.
 *
 * The cube reads as a solid because it is off-axis; the grid it becomes has to
 * be face-on, or the plane the records land in is a parallelogram. So the same
 * value that flattens the dots squares the room up.
 *
 * The reduced-motion preference is read as the external state it is. An effect
 * that mirrors a media query into component state renders once with the wrong
 * answer and then again with the right one, which for this scene means the
 * particles start converging and then stop.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";

import { approach } from "./motion";

/** Near enough to the target pose to be put ON it, in radians: 0.4 of a degree. */
const SETTLED = 0.007;

/**
 * A slow turn, which squares up as a zone opens.
 *
 * The cube reads as a solid because it is off-axis; the grid it becomes has to
 * be face-on, or the plane the records land in is a parallelogram. So the same
 * value that flattens the dots also rotates the room to zero.
 */
export function Turntable({
  children,
  reduced,
  opening,
}: {
  children: React.ReactNode;
  reduced: boolean;
  opening: string | null;
}) {
  const ref = useRef<THREE.Group>(null);
  const { pointer, invalidate, gl } = useThree();

  /*
   * THE SCENE IS DEMAND-DRIVEN AT REST (see `Cube3D.tsx`), so a pointer move has
   * to ask for the frame that answers it. React's own commits invalidate, and
   * every animating `useFrame` in `cube/` keeps itself alive by invalidating
   * while it still has somewhere to go — but the pointer changes nothing in
   * React and nothing in the tree, so without this the cube would simply stop
   * following the cursor.
   */
  useEffect(() => {
    const canvas = gl.domElement;
    const wake = () => invalidate();
    canvas.addEventListener("pointermove", wake);
    return () => canvas.removeEventListener("pointermove", wake);
  }, [gl, invalidate]);

  useFrame((_, delta) => {
    const g = ref.current;
    if (!g) return;
    const squaring = opening !== null;
    // The pointer nudges the cube rather than driving it: a scene that tracks
    // the cursor exactly feels like a toy, and one that ignores it feels dead.
    const wantY = squaring ? 0 : reduced ? -0.62 : -0.62 + pointer.x * 0.28;
    const wantX = squaring ? 0 : reduced ? 0.42 : 0.42 - pointer.y * 0.18;
    const rate = approach(delta, squaring ? 3.4 : 3);
    g.rotation.y += (wantY - g.rotation.y) * rate;
    g.rotation.x += (wantX - g.rotation.x) * rate;
    // Still travelling: ask for the next frame. Otherwise SNAP to the target and
    // stop asking, because an exponential approach never actually arrives — left
    // to its own epsilon it spends another second and a half rendering a
    // thousandth of a radian, which is precisely the perpetual cost this scene
    // is not allowed to have. A fortieth of a degree is not a pose anyone can
    // see; it is only a number that has not finished.
    if (Math.abs(wantY - g.rotation.y) > SETTLED || Math.abs(wantX - g.rotation.x) > SETTLED) {
      invalidate();
    } else {
      g.rotation.y = wantY;
      g.rotation.x = wantX;
    }
  });

  return <group ref={ref}>{children}</group>;
}

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeMotion(onChange: () => void): () => void {
  const query = window.matchMedia(MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * The reduced-motion preference, read as the external state it is.
 *
 * An effect that mirrors a media query into component state renders once with
 * the wrong answer and then again with the right one, which for this scene
 * means the particles start converging and then stop.
 */
export function useReducedMotionQuery(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(MOTION_QUERY).matches,
    () => false,
  );
}
