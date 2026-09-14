"use client";

/**
 * ONE SCENE, TWO LEVELS — what is inside the canvas.
 *
 * Eight octants and a core, the nine databases; inside each octant, that
 * database's tables standing as slabs. Both are always there. L0 is the camera
 * far enough out to see all nine volumes and the table dots inside them; L1 is
 * the camera inside one of them, close enough that its slabs are the picture.
 * Nothing mounts, unmounts, flattens or hands over between the two — the only
 * thing that changes is where the eye is, which is the whole of round 3's
 * concept test.
 *
 * THE OTHER EIGHT DO NOT LEAVE. `emphasis()` is the kit's one presence rule
 * (formula §1 rule 7) and it is what fades them; they go quiet, not absent, so a
 * reader inside `billing` can still see the cube they are inside and which
 * corner of it they are in. That is the continuity axis, paid for in eight
 * meshes that are still drawn.
 *
 * THE CAMERA IS NOT THREE'S. `@athena/demo-kit/zoom` owns the pose by contract
 * and never imports `three`; `Eye` below is the consumer — it reads `rig.get()`
 * and writes the camera, and `space/camera.ts` is the arithmetic between them.
 *
 * WHAT IT COSTS. `frameloop="demand"`: the scene draws when the rig says the
 * pose moved, when a hover changes a weight, and at no other time. Zero frames
 * and zero draw calls at rest, measured in `examples/journey/shots/round3-tidycrm`.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { emphasis, type CameraRig, type Focus } from "@athena/demo-kit/zoom";


import { RecordMark, type BkDatabase } from "../../model";
import { basisOf, eyeOf, faceOf } from "../../space/camera";
import { boxOf, latticeOf, slotOf, slotWorld, SLAB_T, type CellBox } from "../../space/geometry";
import {
  approach,
  dotScale,
  INK,
  fillInk,
  fillOpacity,
  type L0Cell,
} from "../contract";

/* -------------------------------------------------------------------- eye */

/**
 * The rig's pose, on three's camera.
 *
 * Subscribed rather than polled: `invalidate()` on every pose the rig emits is
 * exactly the set of frames the scene owes, and `frameloop="demand"` draws
 * nothing in between. The camera is written in `useFrame` as well, because a
 * frame invalidated by something else (a hover) must still be drawn from the
 * current pose.
 */
function Eye({ rig }: { rig: CameraRig }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => rig.subscribe(() => invalidate()), [rig, invalidate]);

  useFrame(() => {
    const { eye, target } = eyeOf(rig.get());
    camera.position.set(eye.x, eye.y, eye.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(target.x, target.y, target.z);
  });

  return null;
}

/* ----------------------------------------------------------------- octant */

/** How solid a cell's wire is at rest. The core is drawn firmer: it is the one
 *  cell that is not a corner and a reader has to be able to tell. */
const edgeRest = (core: boolean) => (core ? 0.88 : 0.55);

function Octant({
  cell,
  box,
  present,
  inside,
  dotted,
  reduced,
  onHover,
  onOpen,
}: {
  cell: L0Cell;
  box: CellBox;
  /** 0..1, from `emphasis()` through the sheet's own floor. */
  present: number;
  /** The camera is IN this cell. Its wash stops being a fill and becomes a room. */
  inside: boolean;
  /** How present the table dots are. Zero at L1: a dot BECOMES a slab. */
  dotted: number;
  /** Motion is turned down: every change lands on its final state at frame zero. */
  reduced: boolean;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const { solid, count } = useMemo(() => {
    const n = Math.max(1, cell.dots.length);
    return { solid: latticeOf(n, box), count: n };
  }, [cell.dots.length, box]);

  const ink = fillInk(cell);
  const solidity = fillOpacity(cell);

  const wash = useRef<THREE.Mesh>(null);
  const wire = useRef<THREE.LineSegments>(null);
  const dots = useRef<THREE.InstancedMesh>(null);
  const weight = useRef(1);
  const dotWeight = useRef(1);
  const placed = useRef(false);

  /*
   * INSIDE A CELL, THE WASH IS A ROOM AND NOT A FILL.
   *
   * At L0 the wash is the whole reading — "which database is in fault, at a
   * glance" — and it is laid on at `fillOpacity`. At L1 the camera is INSIDE
   * that cell, so the same wash is a coloured fog between the reader and the
   * five slabs they came to read, and the first cut of this level printed black
   * type on a red wall. A quarter of it keeps the hue, which is what says which
   * database you are standing in, and gives the type its contrast back.
   */
  const washK = inside ? 0.25 : 1;
  const invalidate = useThree((s) => s.invalidate);

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
    const mesh = dots.current;
    if (mesh && !placed.current) {
      placed.current = true;
      for (let i = 0; i < count; i += 1) {
        const k = i * 3;
        const dot = cell.dots[i];
        const s = dotScale(dot?.weight ?? 0);
        scratch.makeScale(s, s, s);
        scratch.setPosition(solid[k]!, solid[k + 1]!, solid[k + 2]!);
        mesh.setMatrixAt(i, scratch);
        const mark = dot?.mark ?? RecordMark.Clean;
        mesh.setColorAt(
          i,
          mark === RecordMark.Unadjudicated ? colours.gold : mark === RecordMark.Deviates ? colours.bad : colours.clean,
        );
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      invalidate();
    }

    if (Math.abs(present - weight.current) > 0.002) {
      weight.current += (present - weight.current) * (reduced ? 1 : approach(delta, 6));
      const w = weight.current;
      if (wash.current) (wash.current.material as THREE.MeshBasicMaterial).opacity = solidity * w * washK;
      if (wire.current) (wire.current.material as THREE.LineBasicMaterial).opacity = edgeRest(box.core) * w;
      invalidate();
    }

    /*
     * A DOT BECOMES A SLAB. At L0 one dot is one table; at L1 that same table is
     * a slab with its name on it. Drawing both would count every table twice and
     * hang a field of out-of-focus spheres in front of the type, so the dots go
     * out as the camera goes in — which is the semantic zoom stated in the one
     * place a reader can see it.
     */
    if (Math.abs(dotted - dotWeight.current) > 0.002) {
      dotWeight.current += (dotted - dotWeight.current) * (reduced ? 1 : approach(delta, 6));
      if (mesh) {
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * dotWeight.current;
        mesh.visible = dotWeight.current > 0.01;
      }
      invalidate();
    }
  });

  return (
    <group>
      <mesh
        ref={wash}
        position={[box.cx, box.cy, box.cz]}
        onPointerOver={(event) => {
          event.stopPropagation();
          onHover(cell.id);
        }}
        onPointerOut={() => onHover(null)}
        onClick={(event) => {
          event.stopPropagation();
          onOpen(cell.id);
        }}
      >
        <boxGeometry args={[box.w, box.h, box.d]} />
        <meshBasicMaterial color={ink} transparent opacity={solidity * washK} depthWrite={false} />
      </mesh>

      <lineSegments ref={wire} geometry={edges} position={[box.cx, box.cy, box.cz]}>
        <lineBasicMaterial color={INK.graphite} transparent opacity={edgeRest(box.core)} />
      </lineSegments>

      <instancedMesh ref={dots} args={[undefined, undefined, count]} frustumCulled={false}>
        <sphereGeometry args={[0.07, 10, 8]} />
        <meshBasicMaterial transparent opacity={0.95} />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------------------------------------- the slabs */

/**
 * One database's tables, as slabs standing inside its octant.
 *
 * THE BOX, and only the box. Every word a table carries at this depth — its
 * name, its ident, its three figures, its cluster of record dots — is DOM
 * projected onto this slab by `field/useProjector.ts`, and the argument for
 * that split is in `Field.tsx`. What is here is the ground the type stands on:
 * a near-opaque sheet-coloured face so the lettering reads, a rule around it,
 * and the leading edge in the table's own tone, which is the same three inks
 * the cell carried in round 2.
 *
 * They are drawn only for the database the camera is in, and they come up with
 * the flight rather than after it: the box arrives first and the ink follows,
 * which is rule 3 with the two halves in two technologies.
 */
/**
 * The four edges of one slab's face, cached by size.
 *
 * Five or six slabs in a database and nine databases, but only one or two
 * distinct sizes between them, so the geometries are shared rather than built
 * per slab and disposed per re-render.
 */
const EDGES = new Map<string, THREE.BufferGeometry>();
function slabEdges(w: number, h: number): THREE.BufferGeometry {
  const key = `${w.toFixed(4)}x${h.toFixed(4)}`;
  const had = EDGES.get(key);
  if (had) return had;
  const source = new THREE.PlaneGeometry(w, h);
  const made = new THREE.EdgesGeometry(source);
  source.dispose();
  EDGES.set(key, made);
  return made;
}

function Slabs({
  database,
  present,
  reduced,
}: {
  database: BkDatabase;
  present: number;
  reduced: boolean;
}) {
  const box = useMemo(() => boxOf(database.id), [database.id]);
  const basis = useMemo(() => {
    const face = faceOf(database.id);
    return basisOf(face.yaw, face.pitch);
  }, [database.id]);

  const group = useRef<THREE.Group>(null);
  const shown = useRef(0);
  const invalidate = useThree((s) => s.invalidate);

  const slabs = useMemo(
    () =>
      database.tables.map((table, i) => {
        const slot = slotOf(i, database.tables.length, box);
        const at = slotWorld(slot, box, basis);
        return {
          ident: table.ident,
          at,
          w: slot.w,
          h: slot.h,
          tone:
            table.attention ? INK.goldline : table.deviationTotal > 0 ? INK.redline : INK.greenline,
        };
      }),
    [basis, box, database.tables],
  );

  /** The slabs face the camera's arrival direction, which is the basis they
   *  were laid out in. Orbiting away from it turns them into a rank of cards
   *  standing in the volume, which is the same object seen from elsewhere. */
  const quaternion = useMemo(() => {
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(basis.right.x, basis.right.y, basis.right.z),
      new THREE.Vector3(basis.up.x, basis.up.y, basis.up.z),
      new THREE.Vector3(basis.dir.x, basis.dir.y, basis.dir.z),
    );
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }, [basis]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    if (Math.abs(present - shown.current) > 0.002) {
      shown.current += (present - shown.current) * (reduced ? 1 : approach(delta, 5));
      g.traverse((node) => {
        const mesh = node as THREE.Mesh;
        const material = mesh.material as THREE.MeshBasicMaterial | undefined;
        if (material && "opacity" in material) {
          material.opacity = (mesh.userData.base as number) * shown.current;
        }
      });
      g.visible = shown.current > 0.01;
      invalidate();
    }
  });

  return (
    <group ref={group}>
      {slabs.map((slab) => (
        <group key={slab.ident} position={[slab.at.x, slab.at.y, slab.at.z]} quaternion={quaternion}>
          <mesh userData={{ base: 0.93 }}>
            <boxGeometry args={[slab.w, slab.h, SLAB_T]} />
            <meshBasicMaterial color={INK.sheet} transparent opacity={0} />
          </mesh>
          {/* The rule ROUND the face. `wireframe` was the obvious spelling and the
              wrong one: a plane is two triangles, so it draws its own diagonal
              across the card and every table came with a line through it. */}
          <lineSegments geometry={slabEdges(slab.w, slab.h)} position={[0, 0, SLAB_T / 2 + 0.001]} userData={{ base: 0.3 }}>
            <lineBasicMaterial color={INK.graphite} transparent opacity={0} />
          </lineSegments>
          {/* The leading edge, in the table's own tone — the same claim the L1
              cell's inner rule made in round 2. */}
          <mesh
            position={[-slab.w / 2 + slab.w * 0.012, 0, SLAB_T / 2 + 0.002]}
            userData={{ base: 0.95 }}
          >
            <planeGeometry args={[slab.w * 0.024, slab.h]} />
            <meshBasicMaterial color={slab.tone} transparent opacity={0} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------ the scene */

export function OctantScene({
  cells,
  database,
  focus,
  hovered,
  rig,
  showSlabs,
  reduced,
  onHover,
  onOpen,
}: {
  cells: L0Cell[];
  /** The database the camera is inside, or undefined at L0. */
  database: BkDatabase | undefined;
  focus: Focus;
  hovered: string | null;
  rig: CameraRig;
  /** False while the camera is still outside the band, so the slabs of a
   *  database an agent jumped to do not appear before the flight has begun. */
  showSlabs: boolean;
  /**
   * Motion is turned down. Formula §1 rule 8: the final state at frame zero,
   * never a faster animation — and in a scene that means the per-frame lerps
   * below, not only the DOM's transitions. A reader who asked for less motion
   * was still being shown half a second of eight octants fading, which is also
   * half a second of draw calls they did not need.
   */
  reduced: boolean;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <Eye rig={rig} />
      {cells.map((cell) => (
        <Octant
          key={cell.id}
          cell={cell}
          box={boxOf(cell.id)}
          /* Presence comes from the model. `emphasis()` is the kit's answer;
             the floor is this sheet's, because a reader inside one database
             must still be able to see the cube they are inside — the eight they
             did not choose recede and do not disappear. Hover is the one
             channel `emphasis()` has no answer for, so it is added here (logged
             as a kit gap in round 2 and still open). */
          present={presenceOfCell(focus, hovered, cell.id)}
          inside={focus.level >= 1 && focus.group === cell.id}
          dotted={focus.level === 0 ? presenceOfCell(focus, hovered, cell.id) : 0}
          reduced={reduced}
          onHover={onHover}
          onOpen={onOpen}
        />
      ))}
      {database ? <Slabs database={database} present={showSlabs ? 1 : 0} reduced={reduced} /> : null}
    </>
  );
}

/**
 * How present one octant is, in one place.
 *
 * `emphasis()` returns the kit's three words; this sheet maps them to a number
 * with a floor of 0.3 rather than the kit's 0.22, for the same reason the L0
 * legend overrode it in round 2: these are not a board that has receded behind
 * a card, they are the walls of the room the reader is standing in.
 */
function presenceOfCell(focus: Focus, hovered: string | null, id: string): number {
  // At L0 nothing is opened, so `emphasis()` says 1 for all nine and the only
  // channel left is hover — which the kit has no answer for (logged in round 2,
  // still open). Inside a database the kit decides, with a floor.
  if (focus.level === 0) return hovered === null || hovered === id ? 1 : 0.34;
  // 0.24 rather than the kit's 0.22 — barely a correction, and deliberate: the
  // eight the reader did not choose are the walls of the room they are standing
  // in, so they have to be visible enough to say WHERE the room is and quiet
  // enough not to argue with five slabs of type.
  return Math.max(0.24, emphasis(focus, id, null));
}
