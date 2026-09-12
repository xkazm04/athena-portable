"use client";

/**
 * The wireframe of one quadrant, and the invisible volume that makes it
 * clickable.
 *
 * A line in WebGL cannot be thickened, so the frame says which zone the reader
 * is on entirely through opacity — see `motion.ts` for the three weights. The
 * hit volume is a fully transparent material rather than `visible={false}`,
 * because an invisible mesh is not raycast and a quadrant nobody can click is
 * not a control.
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import type { BkZone } from "../model";
import { GRAPHITE } from "./palette";
import { quadrantBox } from "./geometry";
import { EDGE_ASIDE, EDGE_LIT, EDGE_REST, approach } from "./motion";
import { Records } from "./Records";

/** The wireframe of one quadrant. It dissolves as its zone flattens. */
function Frame({
  zoneId,
  opening,
  hovered,
}: {
  zoneId: string;
  opening: string | null;
  hovered: string | null;
}) {
  const ref = useRef<THREE.LineSegments>(null);
  const shown = useRef(EDGE_REST);

  const geometry = useMemo(() => {
    const box = quadrantBox(zoneId);
    const source = new THREE.BoxGeometry(box.w, box.w, box.depth);
    const edges = new THREE.EdgesGeometry(source);
    source.dispose();
    edges.translate(box.cx, box.cy, 0);
    return edges;
  }, [zoneId]);

  useFrame((_, delta) => {
    const line = ref.current;
    if (!line) return;
    const want =
      opening !== null
        ? 0
        : hovered === null
          ? EDGE_REST
          : hovered === zoneId
            ? EDGE_LIT
            : EDGE_ASIDE;
    if (Math.abs(want - shown.current) < 0.002) return;
    shown.current += (want - shown.current) * approach(delta, 6);
    (line.material as THREE.LineBasicMaterial).opacity = shown.current;
  });

  return (
    <lineSegments ref={ref} geometry={geometry}>
      <lineBasicMaterial color={GRAPHITE} transparent opacity={EDGE_REST} />
    </lineSegments>
  );
}

export function Quadrant({
  zone,
  opening,
  hovered,
  onHover,
  onOpen,
  onSettled,
}: {
  zone: BkZone;
  opening: string | null;
  hovered: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
  onSettled: () => void;
}) {
  const box = quadrantBox(zone.id);

  return (
    <group>
      <Frame zoneId={zone.id} opening={opening} hovered={hovered} />
      <Records zone={zone} opening={opening} hovered={hovered} onSettled={onSettled} />

      {/* The hit volume. Invisible, but `visible={false}` would stop it being
          raycast, so it is a fully transparent material instead. */}
      {opening === null ? (
        <mesh
          position={[box.cx, box.cy, 0]}
          onPointerOver={(event) => {
            event.stopPropagation();
            onHover(zone.id);
          }}
          onPointerOut={() => onHover(null)}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(zone.id);
          }}
        >
          <boxGeometry args={[box.w, box.w, box.depth]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}
