"use client";

/**
 * What is in the octant cube's canvas.
 *
 * The round-1 cube, kept, and split the only way nine cells fit in a cube
 * without one of them being a lie: eight octants and a core. The core is drawn
 * smaller and wired more firmly than the eight around it, because it is the one
 * cell that is not a corner and a reader has to be able to tell.
 *
 * Nothing here is copied from the slab and nothing imports it: the two
 * prototypes are deliberately separable, so that choosing one is a matter of
 * deleting a folder. What they share is `l0/contract.ts`.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { FLATTEN } from "../../beats";
import { clusterCentre, DB_OCTANT, RecordMark } from "../../model";
import {
  approach,
  dotScale,
  ease,
  INK,
  POSES,
  SETTLED,
  fillInk,
  fillOpacity,
  weightOf,
  type L0Cell,
  type L0Props,
} from "../contract";

/* --------------------------------------------------------------- geometry */

/** Half-extent of the whole cube. */
const R = 2;
/**
 * The gap between octants, and the reason it is wide.
 *
 * It is not a style choice: the ninth cell is a core at the origin, and a gap
 * narrower than the core's own half-extent would put the core INSIDE the eight
 * boxes around it. The gap is what makes room for it, which is the honest cost
 * of fitting nine cells into a shape that divides into eight.
 */
const GAP = 0.42;
const SIDE = R - 2 * GAP;
const CORE = 0.78;

function cellBox(id: string) {
  const at = DB_OCTANT[id] ?? { sx: -1, sy: 1, sz: 1, core: false };
  if (at.core) return { w: CORE, h: CORE, d: CORE, cx: 0, cy: 0, cz: 0, core: true };
  const c = GAP + SIDE / 2;
  return {
    w: SIDE,
    h: SIDE,
    d: SIDE,
    cx: at.sx * c,
    cy: at.sy * c,
    cz: at.sz * c,
    core: false,
  };
}

/**
 * Where a cell's table dots sit inside the volume, and where they land.
 *
 * A lattice rather than a plane, because the whole reason to keep a cube is that
 * its cells have depth; the flat targets are `clusterCentre`'s, the same
 * function `field/useLanding.ts` reads.
 */
function dotsOf(cell: L0Cell, id: string) {
  const box = cellBox(id);
  const n = Math.max(1, cell.dots.length);
  const side = Math.max(1, Math.ceil(Math.cbrt(n)));
  const solid = new Float32Array(n * 3);
  const flat = new Float32Array(n * 3);
  const spread = box.core ? 0.5 : 0.56;
  for (let i = 0; i < n; i += 1) {
    const ix = i % side;
    const iy = Math.floor(i / side) % side;
    const iz = Math.floor(i / (side * side));
    solid[i * 3] = box.cx + ((ix + 0.5) / side - 0.5) * box.w * spread;
    solid[i * 3 + 1] = box.cy + ((iy + 0.5) / side - 0.5) * box.h * spread;
    solid[i * 3 + 2] = box.cz + ((iz + 0.5) / side - 0.5) * box.d * spread;
    const target = clusterCentre(i, n);
    flat[i * 3] = target.x;
    flat[i * 3 + 1] = target.y;
    flat[i * 3 + 2] = 0;
  }
  return { solid, flat, count: n };
}

/* ------------------------------------------------------------------ parts */

function Rig({ pose, children }: { pose: number; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const invalidate = useThree((state) => state.invalidate);

  useFrame((_, delta) => {
    const g = ref.current;
    if (!g) return;
    const want = pose < 0 ? { x: 0, y: 0 } : (POSES[pose] ?? POSES[0]!);
    const rate = approach(delta, pose < 0 ? 3.6 : 4.2);
    g.rotation.y += (want.y - g.rotation.y) * rate;
    g.rotation.x += (want.x - g.rotation.x) * rate;
    if (Math.abs(want.y - g.rotation.y) > SETTLED || Math.abs(want.x - g.rotation.x) > SETTLED) {
      invalidate();
    } else {
      g.rotation.y = want.y;
      g.rotation.x = want.x;
    }
  });

  return <group ref={ref}>{children}</group>;
}

function Octant({
  cell,
  hovered,
  opening,
  onHover,
  onOpen,
  onSettled,
}: {
  cell: L0Cell;
  hovered: string | null;
  opening: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
  onSettled: () => void;
}) {
  const box = useMemo(() => cellBox(cell.id), [cell.id]);
  const { solid, flat, count } = useMemo(() => dotsOf(cell, cell.id), [cell]);
  const ink = fillInk(cell);
  /* The wash's strength is the database's share of the worst one's outstanding
     work — see `L0Cell.share`. The STATE is still binary; the strength is what
     stops nine tiles in fault reading as nine identical tiles. */
  const solidity = fillOpacity(cell);

  const wash = useRef<THREE.Mesh>(null);
  const wire = useRef<THREE.LineSegments>(null);
  const dots = useRef<THREE.InstancedMesh>(null);
  const weight = useRef(1);
  const progress = useRef(0);
  const dirty = useRef(true);
  const tinted = useRef(false);
  const announced = useRef(false);
  const invalidate = useThree((state) => state.invalidate);

  const edges = useMemo(() => {
    const source = new THREE.BoxGeometry(box.w, box.h, box.d);
    const out = new THREE.EdgesGeometry(source);
    source.dispose();
    return out;
  }, [box.w, box.h, box.d]);

  const colours = useMemo(
    () => ({
      clean: new THREE.Color(INK.graphite),
      bad: new THREE.Color(INK.redline),
      gold: new THREE.Color(INK.goldline),
    }),
    [],
  );
  const scratch = useMemo(() => new THREE.Matrix4(), []);
  const edgeRest = box.core ? 0.88 : 0.55;

  useFrame((_, delta) => {
    const mine = opening === cell.id;
    const want = weightOf(cell.id, hovered, opening);

    if (Math.abs(want - weight.current) > 0.002) {
      weight.current += (want - weight.current) * approach(delta, 6);
      const w = weight.current;
      if (wash.current) {
        (wash.current.material as THREE.MeshBasicMaterial).opacity = solidity * w;
      }
      if (wire.current) {
        (wire.current.material as THREE.LineBasicMaterial).opacity = edgeRest * w;
      }
      if (dots.current) {
        (dots.current.material as THREE.MeshBasicMaterial).opacity = 0.95 * w;
      }
      invalidate();
    }

    const wantProgress = mine ? 1 : 0;
    if (progress.current !== wantProgress) {
      const step = delta / (mine ? FLATTEN / 1000 : 0.34);
      progress.current = mine
        ? Math.min(1, progress.current + step)
        : Math.max(0, progress.current - step);
      dirty.current = true;
    }

    if (!dirty.current) return;
    invalidate();
    const mesh = dots.current;
    if (!mesh) return;
    const t = ease(progress.current);
    const paint = !tinted.current;
    for (let i = 0; i < count; i += 1) {
      const k = i * 3;
      const x = solid[k]! + (flat[k]! - solid[k]!) * t;
      const y = solid[k + 1]! + (flat[k + 1]! - solid[k + 1]!) * t;
      const z = solid[k + 2]! + (flat[k + 2]! - solid[k + 2]!) * t;
      // The dot's SIZE is how much is outstanding on that table, its COLOUR is
      // what kind of claim stands on it. See `L0Dot` in `l0/contract.ts`.
      const dot = cell.dots[i];
      const mark = dot?.mark ?? RecordMark.Clean;
      const scale = dotScale(dot?.weight ?? 0) * (1 + t * 0.4);
      scratch.makeScale(scale, scale, scale);
      scratch.setPosition(x, y, z);
      mesh.setMatrixAt(i, scratch);
      if (paint) {
        mesh.setColorAt(
          i,
          mark === RecordMark.Unadjudicated
            ? colours.gold
            : mark === RecordMark.Deviates
              ? colours.bad
              : colours.clean,
        );
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (paint) {
      tinted.current = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    dirty.current = progress.current !== wantProgress;

    if (mine && progress.current >= 1 && !announced.current) {
      announced.current = true;
      onSettled();
    }
    if (!mine) announced.current = false;
  });

  return (
    <group>
      <mesh
        ref={wash}
        position={[box.cx, box.cy, box.cz]}
        onPointerOver={(event) => {
          event.stopPropagation();
          if (opening === null) onHover(cell.id);
        }}
        onPointerOut={() => onHover(null)}
        onClick={(event) => {
          event.stopPropagation();
          if (opening === null) onOpen(cell.id);
        }}
      >
        <boxGeometry args={[box.w, box.h, box.d]} />
        <meshBasicMaterial
          color={ink}
          transparent
          opacity={solidity}
          depthWrite={false}
        />
      </mesh>

      <lineSegments ref={wire} geometry={edges} position={[box.cx, box.cy, box.cz]}>
        <lineBasicMaterial color={INK.graphite} transparent opacity={edgeRest} />
      </lineSegments>

      <instancedMesh ref={dots} args={[undefined, undefined, count]} frustumCulled={false}>
        <sphereGeometry args={[0.07, 10, 8]} />
        <meshBasicMaterial transparent opacity={0.95} />
      </instancedMesh>
    </group>
  );
}

export function OctantScene({
  cells,
  hovered,
  opening,
  onHover,
  onOpen,
  onFlattened,
  pose,
}: L0Props & { pose: number }) {
  return (
    <Rig pose={pose}>
      {cells.map((cell) => (
        <Octant
          key={cell.id}
          cell={cell}
          hovered={hovered}
          opening={opening}
          onHover={onHover}
          onOpen={onOpen}
          onSettled={onFlattened}
        />
      ))}
    </Rig>
  );
}
