/**
 * THE MACHINE, IN SCENE UNITS. One layout, computed once, used by all three renderers.
 *
 * Atlas is a scene, not a set of pages: the six strata of README §3.1 are planes stacked in
 * depth, the systems that realise a stratum are blocks standing on it, the components inside a
 * system are parts inside its block, and an edge between two systems is a pipe running between
 * two blocks. Nothing below knows about React, the DOM, `three`, or a pixel — it is arithmetic
 * over `@/data`, so `test/layout.test.ts` can pin every number under `node --test`, and so the
 * webgl, css3d and hybrid renderers cannot drift from each other. THEY ALL DRAW THIS OBJECT.
 *
 * WHY ONE MODULE AND NOT THREE. The owner's round-3 instruction is that the three rendering
 * techniques are judged on the same machine and the same turn. If each renderer laid its own
 * scene out, the comparison would be between three drawings of three buildings. So the geometry
 * is decided here, in units, and a renderer's only freedom is how it puts a unit on a screen.
 *
 * THE AXES, once, so no call site has to guess:
 *
 *   +X  across a stratum, left to right
 *   +Y  up the stack toward the surfaces. README §3.1 prints surfaces first, so surfaces is the
 *       TOP plane and contracts is the floor, and "up the stack" in the model is +Y in the scene.
 *   +Z  toward the reader, the second axis of a stratum's floor
 *
 * An edge that runs +Y REACHES (a call up toward a surface); an edge that runs -Y DEPENDS (a call
 * down toward the contracts). That sign is the whole reason the machine is built vertically:
 * "packages depend on ports, never on concrete classes" (README §3.1) is a direction, and a
 * direction wants an axis.
 *
 * SCENE UNITS, NOT PIXELS. `design/check-tokens.mjs` bans a raw `px` in a `.ts` file and it is
 * right to: a length that is a pixel is a design decision and belongs in `tokens.css`. Everything
 * here is a dimensionless scene unit, and each renderer decides what a unit costs — the webgl
 * scene spends world units, the css3d scene multiplies by `--at-unit`.
 */
import {
  COMPONENTS,
  LAYERS,
  LAYER_ORDER,
  SYSTEMS,
  SYSTEM_EDGES,
  componentsOf,
  systemsOf,
  type LayerId,
  type Status,
  type SystemEdge,
} from "@/data";

/* ------------------------------------ the dimensions ------------------------------------ */

/**
 * Every number the machine is made of, in one block, so the shape can be tuned in one place and
 * `test/layout.test.ts` can assert the consequences rather than the constants.
 */
export const DIM = {
  /** A stratum's floor, across and deep. */
  planeW: 170,
  planeD: 62,
  /**
   * The vertical distance between two stratum planes. The six make a stack five gaps tall.
   *
   * It is large relative to the planes' depth ON PURPOSE, and the number was chosen by looking:
   * a plane 62 deep seen from 25 degrees above projects to a band about 26 units tall, so a gap
   * of 26 puts every floor edge-to-edge with the next one and the stack reads as a solid block
   * rather than as six storeys. Forty leaves daylight between them, which is what makes the word
   * "layers" visible in the picture instead of only in the labels.
   */
  stratumGap: 40,
  /** The plane's own slab thickness — a stratum is a floor, not a sheet of paper. */
  planeH: 1.2,
  /** How tall a block stands on its stratum. */
  blockH: 9,
  /** The clear space left between two blocks on the same stratum. */
  blockGap: 7,
  /** The clear space between a block's wall and the parts inside it. */
  blockPad: 2.4,
  /** A part's height, and the gap between two parts. */
  partH: 2.6,
  partGap: 1.1,
  /** How far outside the plane's edge a long pipe's riser stands. */
  riserOut: 22,
  /** How far a pipe leaves a block's face before it turns. */
  stub: 4.5,
  /** The most blocks a stratum puts in one row before it wraps onto a second. */
  maxCols: 4,
} as const;

/** The whole machine's bounding half-extents, for a camera that wants to frame it. */
export const SCENE_EXTENT = {
  x: DIM.planeW / 2 + DIM.riserOut,
  y: ((LAYER_ORDER.length - 1) * DIM.stratumGap) / 2 + DIM.blockH,
  z: DIM.planeD / 2,
} as const;

/** The centre of the stack, which is what the camera orbits. */
export const SCENE_CENTRE: Vec3 = {
  x: 0,
  y: ((LAYER_ORDER.length - 1) * DIM.stratumGap) / 2,
  z: 0,
};

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/* -------------------------------------- the pieces -------------------------------------- */

/** One of the six planes of README §3.1. */
export interface Stratum {
  id: LayerId;
  part: string;
  name: string;
  /** 0 = surfaces, 5 = contracts — the order the README prints them. */
  index: number;
  /** The plane's top face. Blocks stand ON this. */
  y: number;
  w: number;
  d: number;
  /** How many blocks and parts it carries — the figure the stratum's rail prints. */
  blocks: number;
  parts: number;
}

/** One system, standing on its stratum. */
export interface Block {
  id: string;
  part: string;
  name: string;
  layer: LayerId;
  status: Status;
  /** The centre of the block's footprint, on the stratum's top face. */
  x: number;
  z: number;
  /** The floor the block stands on; `y + h` is its lid. */
  y: number;
  w: number;
  d: number;
  h: number;
  /** The parts inside it, already laid out. */
  parts: readonly Part[];
}

/** One component, inside its block. */
export interface Part {
  id: string;
  part: string;
  name: string;
  block: string;
  status: Status;
  /** Centre of the part's footprint, in WORLD units (not block-relative — nothing has to compose). */
  x: number;
  z: number;
  /** The part's floor; it stands on the block's lid. */
  y: number;
  w: number;
  d: number;
  h: number;
}

/** Which way an edge runs up the stack. */
export type Flow = "reaches" | "depends" | "across";

/**
 * One pipe between two blocks, already routed as a polyline in world units.
 *
 * `points` is what every renderer draws: three.js sweeps a tube along it, the css3d scene
 * projects it into one SVG polyline, and the turn's light rides it. `length` is the summed
 * segment length, so a traveller can be placed at a fraction of the whole run.
 */
export interface Pipe {
  id: string;
  from: string;
  to: string;
  flow: Flow;
  /** How many component edges are bundled into this one pipe. */
  weight: number;
  points: readonly Vec3[];
  length: number;
}

export interface Scene {
  strata: readonly Stratum[];
  blocks: readonly Block[];
  pipes: readonly Pipe[];
}

/* -------------------------------------- the maths -------------------------------------- */

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

/** The distance along a polyline, and the cumulative distance at each vertex. */
export function measure(points: readonly Vec3[]): { length: number; at: number[] } {
  const at = [0];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += len(sub(points[i]!, points[i - 1]!));
    at.push(total);
  }
  return { length: total, at };
}

/**
 * The point a fraction `t` of the way along a polyline, and the direction it is travelling.
 *
 * This is the one function the turn's light is placed by, in every renderer. `t` is clamped, so
 * a scrub past either end parks the light on an endpoint rather than extrapolating off the
 * machine.
 */
export function pointOn(points: readonly Vec3[], t: number): { at: Vec3; dir: Vec3 } {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (points.length < 2) return { at: first, dir: { x: 0, y: 1, z: 0 } };
  const { length, at } = measure(points);
  if (length === 0) return { at: first, dir: { x: 0, y: 1, z: 0 } };
  const want = Math.min(1, Math.max(0, t)) * length;
  if (want <= 0) return { at: first, dir: norm(sub(points[1]!, first)) };
  if (want >= length) return { at: last, dir: norm(sub(last, points[points.length - 2]!)) };
  let i = 1;
  while (i < at.length - 1 && at[i]! < want) i += 1;
  const a = points[i - 1]!;
  const b = points[i]!;
  const span = at[i]! - at[i - 1]!;
  const f = span === 0 ? 0 : (want - at[i - 1]!) / span;
  return {
    at: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f },
    dir: norm(sub(b, a)),
  };
}

function norm(v: Vec3): Vec3 {
  const l = len(v);
  return l === 0 ? { x: 0, y: 1, z: 0 } : { x: v.x / l, y: v.y / l, z: v.z / l };
}

/* -------------------------------------- the build -------------------------------------- */

/** The y of a stratum's top face. Surfaces (index 0) is the highest plane. */
export const stratumY = (index: number): number =>
  (LAYER_ORDER.length - 1 - index) * DIM.stratumGap;

/**
 * Where the n-th of `count` cells sits in a grid that fills the plane.
 *
 * Blocks run across in X and wrap in Z, up to `DIM.maxCols` per row, because a reader reads a
 * stratum left to right and a second row is the concession, not the plan.
 */
export function cell(
  i: number,
  count: number,
  w: number,
  d: number,
  maxCols: number,
): { x: number; z: number; w: number; d: number } {
  const cols = Math.min(Math.max(1, count), maxCols);
  const rows = Math.ceil(count / cols);
  const col = i % cols;
  const row = Math.floor(i / cols);
  /* The last row is centred rather than left-aligned: a stratum with five blocks reads as
     four-over-one centred, not four-over-one-hanging-off-the-left. */
  const inRow = row === rows - 1 ? count - row * cols : cols;
  const cw = w / cols;
  const cd = d / rows;
  const offset = ((cols - inRow) * cw) / 2;
  return {
    x: (col + 0.5) * cw - w / 2 + offset,
    z: (row + 0.5) * cd - d / 2,
    w: cw,
    d: cd,
  };
}

function layoutParts(block: Omit<Block, "parts">): Part[] {
  const components = componentsOf(block.id);
  const n = components.length;
  if (n === 0) return [];
  const innerW = block.w - DIM.blockPad * 2;
  const innerD = block.d - DIM.blockPad * 2;
  /* Parts prefer to run across, like the blocks do, but a block is not much wider than it is
     deep, so the column count is the one that keeps a part closest to square. */
  const cols = Math.min(n, Math.max(1, Math.round(Math.sqrt(n * (innerW / innerD)))));
  return components.map((c, i) => {
    const g = cell(i, n, innerW, innerD, cols);
    return {
      id: c.id,
      part: c.part,
      name: c.name,
      block: block.id,
      status: c.status,
      x: block.x + g.x,
      z: block.z + g.z,
      y: block.y + block.h,
      w: Math.max(1, g.w - DIM.partGap),
      d: Math.max(1, g.d - DIM.partGap),
      h: DIM.partH,
    };
  });
}

function buildBlocks(): Block[] {
  const out: Block[] = [];
  for (const layer of LAYERS) {
    const systems = systemsOf(layer.id);
    const y = stratumY(LAYER_ORDER.indexOf(layer.id));
    systems.forEach((s, i) => {
      const g = cell(i, systems.length, DIM.planeW, DIM.planeD, DIM.maxCols);
      const shell: Omit<Block, "parts"> = {
        id: s.id,
        part: s.part,
        name: s.name,
        layer: layer.id,
        status: s.status,
        x: g.x,
        z: g.z,
        y,
        w: Math.max(4, g.w - DIM.blockGap),
        d: Math.max(4, g.d - DIM.blockGap),
        h: DIM.blockH,
      };
      out.push({ ...shell, parts: layoutParts(shell) });
    });
  }
  return out;
}

const BLOCKS = buildBlocks();
const BLOCK_AT = new Map(BLOCKS.map((b) => [b.id, b]));
const PART_AT = new Map(BLOCKS.flatMap((b) => b.parts).map((p) => [p.id, p]));

export const blockAt = (id: string | null | undefined): Block | undefined =>
  id == null ? undefined : BLOCK_AT.get(id);
export const partAt = (id: string | null | undefined): Part | undefined =>
  id == null ? undefined : PART_AT.get(id);

/** The lid of a block — where a pipe leaves when it reaches up, and where parts stand. */
export const lidOf = (b: Block): Vec3 => ({ x: b.x, y: b.y + b.h, z: b.z });
/** The floor of a block — where a pipe leaves when it depends downward. */
export const footOf = (b: Block): Vec3 => ({ x: b.x, y: b.y, z: b.z });

/**
 * ROUTE ONE PIPE. The single reason the machine reads as plumbing rather than as a hairball.
 *
 * Two shapes, and which one is used depends only on how far up the stack the edge runs:
 *
 *   ADJACENT (one stratum apart) — straight out of the source face, across the gap at the
 *   mid-height between the two strata, and into the target face. Four points, no detour: a
 *   short edge should look short.
 *
 *   LONG (two strata or more) — out of the face, sideways to a RISER standing outside the
 *   plane's edge, vertically along the riser past every stratum it skips, then back in. Six
 *   points. A long edge routed straight would pass through three floors and two dozen blocks
 *   and would be untraceable exactly where tracing matters most (the gate is four strata from
 *   the surface that asked).
 *
 * The riser's SIDE carries the direction: a pipe that REACHES up runs on the left, a pipe that
 * DEPENDS downward runs on the right. So "everything on the right-hand riser is a dependency"
 * is true by construction and a reader can learn it once.
 */
export function route(from: Block, to: Block): { points: Vec3[]; flow: Flow } {
  const up = to.y > from.y;
  const flow: Flow = to.y === from.y ? "across" : up ? "reaches" : "depends";
  const start = up ? lidOf(from) : footOf(from);
  const end = up ? footOf(to) : lidOf(to);
  const outward = up ? 1 : -1;
  const p0 = start;
  const p1 = { x: start.x, y: start.y + DIM.stub * outward, z: start.z };
  const p4 = { x: end.x, y: end.y - DIM.stub * outward, z: end.z };
  const p5 = end;

  const gaps = Math.abs(Math.round((to.y - from.y) / DIM.stratumGap));
  if (gaps <= 1) {
    const mid = (p1.y + p4.y) / 2;
    return {
      points: [p0, p1, { x: p1.x, y: mid, z: p1.z }, { x: p4.x, y: mid, z: p4.z }, p4, p5],
      flow,
    };
  }

  const side = up ? -1 : 1;
  const rx = side * (DIM.planeW / 2 + DIM.riserOut);
  /* The riser is offset in Z by the source block's own depth position, spread across the
     plane's depth, so two long pipes on the same side do not lie on top of each other. */
  const rz = (from.z + to.z) / 2;
  return {
    points: [
      p0,
      p1,
      { x: rx, y: p1.y, z: rz },
      { x: rx, y: p4.y, z: rz },
      p4,
      p5,
    ],
    flow,
  };
}

function buildPipes(): Pipe[] {
  const out: Pipe[] = [];
  for (const e of SYSTEM_EDGES as readonly SystemEdge[]) {
    const from = BLOCK_AT.get(e.from);
    const to = BLOCK_AT.get(e.to);
    if (!from || !to) continue;
    const { points, flow } = route(from, to);
    out.push({
      id: `${e.from}->${e.to}`,
      from: e.from,
      to: e.to,
      flow,
      weight: e.weight,
      points,
      length: measure(points).length,
    });
  }
  /* Heaviest last, so a renderer that draws in order puts the thick pipes on top. */
  return out.sort((a, b) => a.weight - b.weight);
}

function buildStrata(): Stratum[] {
  return LAYERS.map((l, index) => {
    const blocks = systemsOf(l.id);
    return {
      id: l.id,
      part: l.part,
      name: l.name,
      index,
      y: stratumY(index),
      w: DIM.planeW,
      d: DIM.planeD,
      blocks: blocks.length,
      parts: blocks.reduce((n, s) => n + componentsOf(s.id).length, 0),
    };
  });
}

/** THE MACHINE. Built once at module load; it is a constant, not a computation. */
export const SCENE: Scene = {
  strata: buildStrata(),
  blocks: BLOCKS,
  pipes: buildPipes(),
};

export const stratumAt = (id: string | null | undefined): Stratum | undefined =>
  id == null ? undefined : SCENE.strata.find((s) => s.id === id);

/** Every pipe touching a block, for the L1 stubs and for lighting a block's plumbing. */
export const pipesOf = (block: string): Pipe[] =>
  SCENE.pipes.filter((p) => p.from === block || p.to === block);

/** The blocks standing on one stratum, in the order they were laid out. */
export const blocksOn = (layer: string): Block[] => SCENE.blocks.filter((b) => b.layer === layer);

/**
 * The count the scene is worth checking against the model with. If a component never became a
 * part, the machine is lying about the repository and `test/layout.test.ts` fails.
 */
export const SCENE_COUNTS = {
  strata: SCENE.strata.length,
  blocks: SCENE.blocks.length,
  parts: SCENE.blocks.reduce((n, b) => n + b.parts.length, 0),
  pipes: SCENE.pipes.length,
  components: COMPONENTS.length,
  systems: SYSTEMS.length,
} as const;
