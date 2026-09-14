"use client";

/**
 * What is actually in the slab's canvas.
 *
 * Three things per cell and one thing around them: a translucent fill that is
 * both the state colour and the hit volume, a wireframe that says where the cell
 * ends, an instanced mesh of one dot per table, and a rig that holds whichever
 * of the four poses is chosen.
 *
 * EVERY LOOP STOPS. The canvas renders on demand (`Slab.tsx`), so each
 * `useFrame` below asks for the next frame while — and only while — it still has
 * somewhere to go. A settled slab draws zero frames, which is round 1's rule 9
 * and the one cost rule this direction has already paid for once.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { FLATTEN } from "../../beats";
import { clusterCentre, RecordMark } from "../../model";
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

/** The slab, in world units. One cell thick, so nothing is ever behind anything. */
const SLAB_W = 4.5;
const SLAB_H = 3.1;
const DEPTH = 0.62;
const GAP = 0.1;

const CELL_W = (SLAB_W - 2 * GAP) / 3;
const CELL_H = (SLAB_H - 2 * GAP) / 3;

function cellBox(index: number) {
  const col = index % 3;
  const row = Math.floor(index / 3);
  return {
    w: CELL_W,
    h: CELL_H,
    d: DEPTH,
    cx: (col - 1) * (CELL_W + GAP),
    cy: (1 - row) * (CELL_H + GAP),
    cz: 0,
  };
}

/**
 * Where a cell's table dots sit, and where they land when it is opened.
 *
 * The resting layout mirrors the L1 column count so the dots are already a
 * scaled copy of the grid they are about to become; the flat targets come from
 * `clusterCentre`, the same function `field/useLanding.ts` reads, which is what
 * makes the hand-off a move rather than a cut.
 */
function dotsOf(cell: L0Cell, index: number) {
  const box = cellBox(index);
  const n = Math.max(1, cell.dots.length);
  const cols = Math.min(3, n);
  const rows = Math.ceil(n / cols);
  const solid = new Float32Array(n * 3);
  const flat = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const ix = i % cols;
    const iy = Math.floor(i / cols);
    solid[i * 3] = box.cx + ((ix + 0.5) / cols - 0.5) * box.w * 0.7;
    solid[i * 3 + 1] = box.cy - ((iy + 0.5) / rows - 0.5) * box.h * 0.62;
    solid[i * 3 + 2] = box.d / 2 + 0.05;
    const target = clusterCentre(i, n);
    flat[i * 3] = target.x;
    flat[i * 3 + 1] = target.y;
    flat[i * 3 + 2] = 0;
  }
  return { solid, flat, count: n };
}

/* ------------------------------------------------------------------ parts */

/** The rig: one of four poses, approached and then snapped onto. */
function Rig({
  pose,
  children,
}: {
  /** An index into `POSES`, or -1 while a move squares the slab up. */
  pose: number;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const invalidate = useThree((state) => state.invalidate);

  useFrame((_, delta) => {
    const g = ref.current;
    if (!g) return;
    const want = pose < 0 ? { x: 0, y: 0 } : (POSES[pose] ?? POSES[0]!);
    const rate = approach(delta, pose < 0 ? 3.6 : 4.2);
    g.rotation.y += (want.y - g.rotation.y) * rate;
    g.rotation.x += (want.x - g.rotation.x) * rate;
    // An exponential approach never arrives; left to its own epsilon it spends
    // another second and a half rendering a thousandth of a radian.
    if (Math.abs(want.y - g.rotation.y) > SETTLED || Math.abs(want.x - g.rotation.x) > SETTLED) {
      invalidate();
    } else {
      g.rotation.y = want.y;
      g.rotation.x = want.x;
    }
  });

  return <group ref={ref}>{children}</group>;
}

/** One cell: the state wash, the wireframe, the dots, and the hit volume. */
function Cell({
  cell,
  index,
  hovered,
  opening,
  onHover,
  onOpen,
  onSettled,
}: {
  cell: L0Cell;
  index: number;
  hovered: string | null;
  opening: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
  onSettled: () => void;
}) {
  const box = useMemo(() => cellBox(index), [index]);
  const { solid, flat, count } = useMemo(() => dotsOf(cell, index), [cell, index]);
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
        (wire.current.material as THREE.LineBasicMaterial).opacity = 0.62 * w;
      }
      if (dots.current) {
        (dots.current.material as THREE.MeshBasicMaterial).opacity = 0.95 * w;
      }
      invalidate();
    }

    const wantProgress = mine ? 1 : 0;
    if (progress.current !== wantProgress) {
      // A fixed distance per second toward the target, so the move takes the
      // same time on every machine and the DOM can count on it. See
      // `beats.ts`; the unflatten is quicker because it is what saying no
      // looks like.
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
      // A table awaiting a person is drawn larger, and grows further as the
      // plane forms, because on the flat it is what a person is being asked to
      // look at.
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
        /* The wash IS the hit volume. A separate invisible mesh would be a
           second thing to keep in step, and `visible={false}` is not raycast. */
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
        <lineBasicMaterial color={INK.graphite} transparent opacity={0.62} />
      </lineSegments>

      <instancedMesh ref={dots} args={[undefined, undefined, count]} frustumCulled={false}>
        <sphereGeometry args={[0.075, 10, 8]} />
        <meshBasicMaterial transparent opacity={0.95} />
      </instancedMesh>
    </group>
  );
}

export function SlabScene({
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
      {cells.map((cell, i) => (
        <Cell
          key={cell.id}
          cell={cell}
          index={i}
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
