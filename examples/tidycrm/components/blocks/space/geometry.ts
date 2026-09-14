/**
 * ONE SPACE, three depths — the shape of it.
 *
 * Round 3's concept test. The nine databases are not a picture that hands over
 * to a DOM grid any more: they are eight octants and a core in one volume, and
 * opening a database is the camera flying INTO its octant, where the database's
 * tables are already standing as slabs. L0 and L1 are therefore the same scene
 * at two distances, and there is nothing to hand over.
 *
 * WHAT THAT DELETED. Round 2's `model/flatten.ts` published a plane, every L0
 * variant drew an inert `.bk-l0-plane` box at it, and `field/useLanding.ts`
 * measured that box so the arriving DOM cells could start life on top of the
 * dots the picture had just flattened. All of that existed to make a CUT look
 * like a move. A camera that never leaves the scene has no hand-off, so the
 * plane, the measurement and the landing beat are gone.
 *
 * EVERYTHING HERE IS PURE ARITHMETIC over world units, with no `three` and no
 * React in it, because it is the part that can be wrong: if the slab a table is
 * drawn as and the label projected onto it disagree about where that table is,
 * the level reads as two pictures of one place. `test/space.test.ts` pins it.
 */

import { DB_OCTANT, type OctantPlace } from "../model";

/* ------------------------------------------------------------- the volume */

/** Half-extent of the whole cube. */
export const R = 2;

/**
 * The gap between octants, and the reason it is wide.
 *
 * It is not a style choice: the ninth cell is a core at the origin, and a gap
 * narrower than the core's own half-extent would put the core INSIDE the eight
 * boxes around it. The gap is what makes room for it, which is the honest cost
 * of fitting nine cells into a shape that divides into eight.
 */
export const GAP = 0.42;

/** One octant's side. */
export const SIDE = R - 2 * GAP;

/** The core's side — the ninth database, the only cell that is not a corner. */
export const CORE = 0.78;

/** How far an octant's centre is from the origin, on each axis. */
export const OCTANT_C = GAP + SIDE / 2;

export interface CellBox {
  /** Side lengths. Every cell is a cube, so these three agree. */
  w: number;
  h: number;
  d: number;
  /** Centre, in world units. */
  cx: number;
  cy: number;
  cz: number;
  core: boolean;
}

export function boxOfPlace(at: OctantPlace): CellBox {
  if (at.core) return { w: CORE, h: CORE, d: CORE, cx: 0, cy: 0, cz: 0, core: true };
  return {
    w: SIDE,
    h: SIDE,
    d: SIDE,
    cx: at.sx * OCTANT_C,
    cy: at.sy * OCTANT_C,
    cz: at.sz * OCTANT_C,
    core: false,
  };
}

/** Where one database's cell is. The fallback is the far top-left corner, not
 *  the core: an id nobody placed must not land on top of the one that is. */
export function boxOf(id: string): CellBox {
  return boxOfPlace(DB_OCTANT[id] ?? { sx: -1, sy: 1, sz: 1, core: false });
}

/* -------------------------------------------------- L1: the tables, in place */

/**
 * The columns a database's tables are dealt into inside its octant.
 *
 * Three, the same three round 2's `FLAT_COLS` used, and for the same reason: a
 * database holds four to seven tables (`model/databases.ts` commits to the
 * band), which is two neat rows of three, or three rows with a short last one.
 * The number is repeated rather than imported because `FLAT_COLS` was about a
 * CSS grid that no longer exists.
 */
export const SLOT_COLS = 3;

/** The share of the octant's face the slab grid occupies. The remainder is the
 *  margin that keeps a slab off the volume's own wire edges, which is what lets
 *  a reader still see the box its tables are standing in. */
export const SLOT_FILL = 0.86;

/**
 * The share of a slot that is gap rather than slab, across and up.
 *
 * TWO NUMBERS, NOT ONE, and the second is the only place in this file where the
 * DOM decides the geometry rather than the other way round. A slot in a 3x2 grid
 * on a cube's face is half again as tall as it is wide; the card that stands on
 * it — a cluster, a name, an ident and three stacked figures at the sheet's own
 * type sizes — is nearer 1.7. A slab that does not carry its card's proportions
 * leaves the last figure hanging off the bottom of the box it is supposed to be
 * printed on, which is exactly what the first cut of this level did. So the
 * across gutter is wide and the up gutter is narrow, and the slab comes out at
 * about 1.75 — a shade taller than the card, because a box should contain its
 * ink and not the other way round.
 */
export const SLOT_GUTTER_X = 0.24;
export const SLOT_GUTTER_Y = 0.08;

/** A slab's thickness, in world units. Thin enough to read as a face-on card at
 *  the L1 pose, thick enough that orbiting away from it shows an object rather
 *  than a vanishing plane. */
export const SLAB_T = 0.05;

/**
 * How far in front of the octant's centre the slab grid stands.
 *
 * INSIDE the volume, not on its front face. A grid laid on the face would leave
 * the octant's own box behind it as a hollow shell; a grid at the centre would
 * be half-occluded by the wash from every angle but one. A fifth of the way
 * forward puts the tables visibly inside their database, which is the whole
 * claim the level is making.
 */
export const SLAB_DEPTH = 0.2;

export interface Slot {
  /** Offset across the viewing plane, from the cell's centre, in world units. */
  u: number;
  /** Offset up the viewing plane, from the cell's centre, in world units. */
  v: number;
  /** Offset toward the camera, along the view direction. */
  n: number;
  /** The slab's own size. */
  w: number;
  h: number;
}

/**
 * Where table `index` of `count` stands inside a cell.
 *
 * In the VIEWING PLANE's own basis rather than in world axes, which is the one
 * decision in this file worth arguing about. A grid laid on a world-axis face
 * of an octant is edge-on from three of the four snap poses and unreadable from
 * two of them; a grid laid perpendicular to the direction the camera arrives
 * from faces the reader on arrival and turns into a rank of slabs as they orbit
 * away — which is the same object seen from somewhere else, and is exactly what
 * the level is for. `world()` below composes it.
 */
export function slotOf(index: number, count: number, box: CellBox): Slot {
  const cols = Math.min(SLOT_COLS, Math.max(1, count));
  const rows = Math.max(1, Math.ceil(Math.max(1, count) / cols));
  const span = box.w * SLOT_FILL;
  const cw = span / cols;
  const ch = span / rows;
  return {
    u: -span / 2 + ((index % cols) + 0.5) * cw,
    v: span / 2 - (Math.floor(index / cols) + 0.5) * ch,
    n: box.w * SLAB_DEPTH,
    w: cw * (1 - SLOT_GUTTER_X),
    h: ch * (1 - SLOT_GUTTER_Y),
  };
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Basis {
  /** Across the viewing plane, to the reader's right. */
  right: Vec3;
  /** Up the viewing plane. */
  up: Vec3;
  /** From what is being looked at, toward the eye. */
  dir: Vec3;
}

/** A slot's centre in world units, given the basis it was laid out in. */
export function slotWorld(slot: Slot, box: CellBox, basis: Basis): Vec3 {
  return {
    x: box.cx + slot.u * basis.right.x + slot.v * basis.up.x + slot.n * basis.dir.x,
    y: box.cy + slot.u * basis.right.y + slot.v * basis.up.y + slot.n * basis.dir.y,
    z: box.cz + slot.u * basis.right.z + slot.v * basis.up.z + slot.n * basis.dir.z,
  };
}

/* ------------------------------------------------------ L0: the table dots */

/**
 * Where a cell's table dots sit inside its volume, as a lattice.
 *
 * A lattice rather than a plane, because the whole reason this is a cube is
 * that its cells have depth. They no longer travel anywhere — round 2's flatten
 * moved every dot onto a published plane so the DOM could take them over, and
 * there is no DOM to take them over any more — so this is a resting arrangement
 * and nothing else.
 */
export function latticeOf(count: number, box: CellBox): Float32Array {
  const n = Math.max(1, count);
  const side = Math.max(1, Math.ceil(Math.cbrt(n)));
  const out = new Float32Array(n * 3);
  const spread = box.core ? 0.5 : 0.56;
  for (let i = 0; i < n; i += 1) {
    const ix = i % side;
    const iy = Math.floor(i / side) % side;
    const iz = Math.floor(i / (side * side));
    out[i * 3] = box.cx + ((ix + 0.5) / side - 0.5) * box.w * spread;
    out[i * 3 + 1] = box.cy + ((iy + 0.5) / side - 0.5) * box.h * spread;
    out[i * 3 + 2] = box.cz + ((iz + 0.5) / side - 0.5) * box.d * spread;
  }
  return out;
}
