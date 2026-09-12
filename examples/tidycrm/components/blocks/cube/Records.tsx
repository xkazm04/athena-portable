"use client";

/**
 * One quadrant's records: eight hundred dots, in one instanced mesh.
 *
 * This is where the flatten actually happens. Every dot holds two positions —
 * where it sits inside the cube and where it lands on the plate — and one
 * progress value walks it from the first to the second, so the whole move is a
 * single interpolation rather than eight hundred animations.
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import type { BkZone } from "../model";
import { GOLDLINE, GRAPHITE, REDLINE } from "./palette";
import { positionsOf } from "./geometry";
import { FLATTEN, UNFLATTEN, approach, ease } from "./motion";

/**
 * One quadrant's records.
 *
 * The instance matrices are rebuilt every frame only while something is
 * moving — the flatten, or the arrival. At rest the buffer is left alone, so a
 * settled cube costs nothing.
 */
export function Records({
  zone,
  opening,
  hovered,
  onSettled,
}: {
  zone: BkZone;
  opening: string | null;
  hovered: string | null;
  onSettled: () => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { solid, flat, mark, count } = useMemo(() => positionsOf(zone), [zone]);
  const progress = useRef(0);
  const fade = useRef(1);
  const dirty = useRef(true);
  const announced = useRef(false);

  const colours = useMemo(
    () => ({
      clean: new THREE.Color(GRAPHITE),
      bad: new THREE.Color(REDLINE),
      gold: new THREE.Color(GOLDLINE),
    }),
    [],
  );

  useFrame((_, delta) => {
    const mesh = ref.current;
    if (!mesh) return;

    const mine = opening === zone.id;
    const wantProgress = mine ? 1 : 0;
    // Three claims on the same value, in order of authority: a zone being
    // opened owns the frame outright, a hovered zone is read while its
    // neighbours step back, and at rest every quadrant is drawn alike.
    const wantFade =
      opening !== null
        ? mine
          ? 1
          : 0
        : hovered === null || hovered === zone.id
          ? 1
          : 0.22;

    // A fixed distance per second toward the target, so the move takes the same
    // time on every machine and can be counted on by the DOM waiting for it.
    if (progress.current !== wantProgress) {
      const step = delta / (mine ? FLATTEN : UNFLATTEN);
      progress.current = mine
        ? Math.min(1, progress.current + step)
        : Math.max(0, progress.current - step);
      dirty.current = true;
    }

    if (Math.abs(wantFade - fade.current) > 0.001) {
      fade.current += (wantFade - fade.current) * approach(delta, 6);
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity = 0.95 * fade.current;
    }

    if (!dirty.current) return;
    const t = ease(progress.current);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i += 1) {
      const k = i * 3;
      const x = solid[k]! + (flat[k]! - solid[k]!) * t;
      const y = solid[k + 1]! + (flat[k + 1]! - solid[k + 1]!) * t;
      const z = solid[k + 2]! + (flat[k + 2]! - solid[k + 2]!) * t;
      // A record in an unadjudicated pair is drawn a little larger, and grows
      // further as the plane forms, because on the flat it is what a person is
      // being asked to look at.
      const scale = (mark[i] === 2 ? 1.25 : 1) * (1 + t * 0.5);
      m.makeScale(scale, scale, scale);
      m.setPosition(x, y, z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, mark[i] === 2 ? colours.gold : mark[i] === 1 ? colours.bad : colours.clean);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    dirty.current = progress.current !== wantProgress;

    if (mine && progress.current >= 1 && !announced.current) {
      announced.current = true;
      onSettled();
    }
    if (!mine) announced.current = false;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <sphereGeometry args={[0.035, 8, 6]} />
      <meshBasicMaterial transparent opacity={0.95} />
    </instancedMesh>
  );
}
