"use client";

/**
 * The particle field: dust that has not landed yet, and then has.
 *
 * It begins as a shell of scatter and converges onto the cube's own edges, so
 * the decoration resolves into the shape the page is about rather than
 * decorating it forever. One start buffer, one target buffer and one progress
 * value: the whole field is a single interpolation.
 *
 * Its motes carry the zone they belong to on a vertex-colour buffer, so when
 * the reader points at a key the dust of that quadrant stays in ink while the
 * rest washes toward the paper.
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { GRAPHITE_3, SHEET, rng } from "./palette";
import { edgePoints } from "./geometry";
import { approach, ease } from "./motion";

/**
 * The particle field. It is the cube's own frame, so it leaves with it.
 *
 * Each mote knows which quadrant's edges it landed on, so when a zone is being
 * read its dust holds full graphite and the rest of the field washes out toward
 * the paper. Carried on a vertex-colour buffer rewritten only while a hover is
 * actually moving — the convergence itself is untouched, and a settled field
 * with nobody pointing at it still costs one position write per breath.
 */
export function Particles({
  zones,
  reduced,
  opening,
  hovered,
}: {
  zones: string[];
  reduced: boolean;
  opening: string | null;
  hovered: string | null;
}) {
  const ref = useRef<THREE.Points>(null);
  const progress = useRef(reduced ? 1 : 0);
  const fade = useRef(1);
  const level = useRef<number[]>([]);

  const { positions, starts, targets, count, tints, zoneAt } = useMemo(() => {
    const target: number[] = [];
    const owner: number[] = [];
    zones.forEach((zone, index) => {
      for (const p of edgePoints(zone, 240)) {
        target.push(p.x, p.y, p.z);
        owner.push(index);
      }
    });
    const n = target.length / 3;
    const start = new Float32Array(n * 3);
    const next = rng(0x5eed);
    for (let i = 0; i < n; i += 1) {
      // A shell rather than a ball: a uniform cloud reads as fog, and what this
      // wants to look like is dust that has not landed yet.
      const theta = next() * Math.PI * 2;
      const phi = Math.acos(2 * next() - 1);
      const r = 6 + next() * 5;
      start[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      start[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      start[i * 3 + 2] = r * Math.cos(phi);
    }
    const ink = new THREE.Color(GRAPHITE_3);
    const colour = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      colour[i * 3] = ink.r;
      colour[i * 3 + 1] = ink.g;
      colour[i * 3 + 2] = ink.b;
    }
    return {
      positions: new Float32Array(start),
      starts: start,
      targets: new Float32Array(target),
      count: n,
      tints: colour,
      zoneAt: new Uint8Array(owner),
    };
  }, [zones]);

  const palette = useMemo(
    () => ({ ink: new THREE.Color(GRAPHITE_3), paper: new THREE.Color(SHEET) }),
    [],
  );

  useFrame((_, delta) => {
    const points = ref.current;
    if (!points) return;

    const wantFade = opening === null ? 1 : 0;
    if (Math.abs(wantFade - fade.current) > 0.001) {
      fade.current += (wantFade - fade.current) * approach(delta, 6);
      (points.material as THREE.PointsMaterial).opacity = 0.75 * fade.current;
    }

    // --- who is being read
    if (level.current.length !== zones.length) level.current = zones.map(() => 1);
    let tinted = false;
    const swatch = new THREE.Color();
    for (let z = 0; z < zones.length; z += 1) {
      const want = hovered === null || opening !== null || zones[z] === hovered ? 1 : 0.2;
      const now = level.current[z] ?? 1;
      if (Math.abs(want - now) < 0.004) continue;
      level.current[z] = now + (want - now) * approach(delta, 6);
      tinted = true;
    }
    if (tinted) {
      const colour = points.geometry.getAttribute("color") as THREE.BufferAttribute;
      for (let i = 0; i < count; i += 1) {
        swatch.copy(palette.paper).lerp(palette.ink, level.current[zoneAt[i] ?? 0] ?? 1);
        colour.array[i * 3] = swatch.r;
        colour.array[i * 3 + 1] = swatch.g;
        colour.array[i * 3 + 2] = swatch.b;
      }
      colour.needsUpdate = true;
    }

    const attr = points.geometry.getAttribute("position") as THREE.BufferAttribute;
    if (progress.current < 1) {
      progress.current = Math.min(1, progress.current + delta * 0.55);
      const t = ease(progress.current);
      for (let i = 0; i < count * 3; i += 1) {
        attr.array[i] = starts[i]! + (targets[i]! - starts[i]!) * t;
      }
      attr.needsUpdate = true;
      return;
    }
    if (reduced || opening !== null) return;
    // Settled: a slow breath along the shape, a fraction of a unit wide.
    const time = performance.now() * 0.0004;
    for (let i = 0; i < count; i += 1) {
      const k = i * 3;
      attr.array[k + 2] = targets[k + 2]! + Math.sin(time + i * 0.4) * 0.02;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[tints, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.075} vertexColors transparent opacity={0.75} sizeAttenuation />
    </points>
  );
}
