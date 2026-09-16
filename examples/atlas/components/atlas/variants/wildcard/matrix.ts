/**
 * THE STRUCTURE MATRIX — the whole model as one square field of marks, in world units.
 *
 * ROUND 5, THE WILDCARD. The blueprint draws boxes and runs; archify draws rounded nodes and
 * labelled runs. Both are node-link drawings, and a node-link drawing of 68 modules and 120 edges
 * is a drawing of edges nobody traces. This variant draws the *other* canonical form for the same
 * data — a **design structure matrix**: both axes are the same ordered list of components, and an
 * edge is a MARK AT A POSITION rather than a line between two places. Nothing crosses, nothing is
 * routed, nothing is hidden behind anything, and all 120 edges are on screen at L0 at once.
 *
 * THE ORDER IS THE ARGUMENT. Both axes run in README §3.1's order — surfaces first, contracts
 * last — with systems contiguous inside their layer. `row` is the component that DEPENDS, `col`
 * the component DEPENDED ON. So an edge that runs down the stack (the lawful direction, README
 * §3.1: "packages depend on ports, never on concrete classes") lands strictly to the RIGHT of the
 * diagonal, and the whole lawful mass is an upper-right triangle. A mark to the LEFT of the
 * diagonal is a reach back up the stack — a *feedback mark*, in the matrix literature — and it is
 * found by looking rather than by following a line. That is the one thing this form does that no
 * arrangement of boxes can: it turns an architectural claim into a geometric one.
 *
 * WORLD UNITS, NOT PIXELS. Same law as everywhere in this app (`design/check-tokens.mjs`): a
 * pixel is a design decision and lives in the token block. Everything below is a dimensionless
 * world unit; the camera decides what one costs.
 *
 * NO GUTTER. The headers are not in this plane at all — `Rails.tsx` draws them in SCREEN space,
 * pinned to the edge of the frame and sliding with the camera, so a label is legible at every
 * band without a world-space gutter that is too small when far and absurd when near. The world is
 * therefore exactly the body: a square, centred on the origin, with the diagonal through it.
 *
 * Pure, total, no React and no DOM: `test/wildcard.matrix.test.ts` pins every consequence under
 * `node --test`.
 */
import {
  COMPONENTS,
  EDGES,
  LAYERS,
  LAYER_ORDER,
  SYSTEMS,
  componentById,
  componentsOf,
  systemById,
  systemsOf,
  type EdgeKind,
  type LayerId,
} from "@/data";

export interface Point {
  x: number;
  y: number;
}

/** Top-left origin. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const centreOf = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export const contains = (r: Rect, p: Point): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/* ------------------------------------- the dimensions ------------------------------------- */

/**
 * Every number the field is made of.
 *
 * `cell` is the only one chosen by looking. RULE 15 ("a place needs a floor size") bites
 * differently here than it does on a sheet: a matrix has no sparse region to fall into, because
 * every position on it is defined — what it can be is too FINE to read. 68 rows in a ~640 px
 * stage is 9 px a row whatever `cell` is, since the whole-field zoom is a fit; so `cell` is not
 * chosen to make L0 legible (the rails do that) but to set the relationship between a mark and a
 * label at the near band, where one cell is 78 px and a five-letter kind glyph sits in it with
 * room to spare.
 */
export const M = {
  /** One component's row and column. Square, because the two axes are the same list. */
  cell: 30,
  /** The mark drawn inside a cell, centred. */
  mark: 18,
  /** Blank world around the field, so the edge cells are not flush with the frame. */
  margin: 60,
} as const;

/* ---------------------------------------- the axis ---------------------------------------- */

/** A contiguous run of rows (and the identical run of columns) belonging to one group. */
export interface Span {
  id: string;
  name: string;
  /** The group's own part number, e.g. `S-04` or `L-1`. */
  part: string;
  /** First index on the axis. */
  start: number;
  /** How many components. Never zero — a group with no components is not on the axis. */
  count: number;
}

export interface LayerSpan extends Span {
  id: LayerId;
  /** The systems inside it, in order, already offset into axis coordinates. */
  systems: readonly Span[];
}

/**
 * THE AXIS. Both axes of the matrix are this one list, and every index in this module is an index
 * into it.
 *
 * Built by walking the model in README order — layers, then systems in the order `data/systems.ts`
 * prints them, then components in the order `data/components.ts` prints them. It is the model's
 * own order and not a sort, which is what makes the triangle an argument about the repository
 * rather than about a comparator.
 */
function buildAxis(): { ids: string[]; layers: LayerSpan[] } {
  const ids: string[] = [];
  const layers: LayerSpan[] = [];

  for (const layer of LAYERS) {
    const start = ids.length;
    const systems: Span[] = [];
    for (const system of systemsOf(layer.id)) {
      const parts = componentsOf(system.id);
      if (parts.length === 0) continue;
      systems.push({
        id: system.id,
        name: system.name,
        part: system.part,
        start: ids.length,
        count: parts.length,
      });
      for (const c of parts) ids.push(c.id);
    }
    const count = ids.length - start;
    if (count === 0) continue;
    layers.push({ id: layer.id, name: layer.name, part: layer.part, start, count, systems });
  }

  return { ids, layers };
}

const AXIS = buildAxis();

/** Component ids, in axis order. Row `i` and column `i` are both `AXIS_IDS[i]`. */
export const AXIS_IDS: readonly string[] = AXIS.ids;

/** The six layers as spans of the axis, surfaces first. */
export const LAYER_SPANS: readonly LayerSpan[] = AXIS.layers;

/** The nineteen systems as spans of the axis, flattened out of the layers. */
export const SYSTEM_SPANS: readonly Span[] = AXIS.layers.flatMap((l) => l.systems);

export const N = AXIS_IDS.length;

const INDEX = new Map(AXIS_IDS.map((id, i) => [id, i]));

/** Where a component sits on the axis, or `-1`. */
export const indexOf = (id: string | null): number => (id === null ? -1 : (INDEX.get(id) ?? -1));

export const idAt = (i: number): string | null => AXIS_IDS[i] ?? null;

const LAYER_SPAN_BY_ID = new Map(LAYER_SPANS.map((s) => [s.id as string, s]));
const SYSTEM_SPAN_BY_ID = new Map(SYSTEM_SPANS.map((s) => [s.id, s]));

export const layerSpan = (id: string | null): LayerSpan | null =>
  id === null ? null : (LAYER_SPAN_BY_ID.get(id) ?? null);
export const systemSpan = (id: string | null): Span | null =>
  id === null ? null : (SYSTEM_SPAN_BY_ID.get(id) ?? null);

/** Which layer row `i` belongs to. */
export function layerAt(i: number): LayerSpan | null {
  for (const span of LAYER_SPANS) {
    if (i >= span.start && i < span.start + span.count) return span;
  }
  return null;
}

/** How deep a layer sits in the stack. Surfaces is 0. */
export const depthOf = (layer: string): number => LAYER_ORDER.indexOf(layer as LayerId);

/* -------------------------------------- the geometry -------------------------------------- */

/** The side of the square field, in world units. */
export const SPAN = N * M.cell;

/** The field's top-left corner. The field is centred on the world origin, so the diagonal is too. */
export const FIELD: Rect = { x: -SPAN / 2, y: -SPAN / 2, w: SPAN, h: SPAN };

/** The whole drawing, margin included. What `homeZoom` fits. */
export const BOUNDS: Rect = {
  x: FIELD.x - M.margin,
  y: FIELD.y - M.margin,
  w: SPAN + M.margin * 2,
  h: SPAN + M.margin * 2,
};

/** One cell. `row` is the depender, `col` the depended-on. */
export const cellRect = (row: number, col: number): Rect => ({
  x: FIELD.x + col * M.cell,
  y: FIELD.y + row * M.cell,
  w: M.cell,
  h: M.cell,
});

/** A whole row of the field: one component's dependencies, all 68 columns of them. */
export const rowRect = (row: number, count = 1): Rect => ({
  x: FIELD.x,
  y: FIELD.y + row * M.cell,
  w: SPAN,
  h: count * M.cell,
});

/** A whole column: everything that depends on one component. */
export const colRect = (col: number, count = 1): Rect => ({
  x: FIELD.x + col * M.cell,
  y: FIELD.y,
  w: count * M.cell,
  h: SPAN,
});

/** The square where a span's rows meet its own columns. A group's own internal coupling. */
export const blockRect = (span: Span): Rect => ({
  x: FIELD.x + span.start * M.cell,
  y: FIELD.y + span.start * M.cell,
  w: span.count * M.cell,
  h: span.count * M.cell,
});

/** The square where span `a`'s rows meet span `b`'s columns — what `a` asks of `b`. */
export const pairRect = (a: Span, b: Span): Rect => ({
  x: FIELD.x + b.start * M.cell,
  y: FIELD.y + a.start * M.cell,
  w: b.count * M.cell,
  h: a.count * M.cell,
});

/** The centre of one component's diagonal cell — where `poseFor` stands to open it. */
export const diagonalCentre = (i: number): Point => centreOf(cellRect(i, i));

/* ---------------------------------------- the marks ---------------------------------------- */

/**
 * Which way an edge runs relative to the stack.
 *
 *   down  toward contracts — a dependency, and the lawful direction. Right of the diagonal.
 *   flat  inside one layer. Beside the diagonal.
 *   up    back toward surfaces — a reach. Left of the diagonal, and the reason to look.
 */
export type Sense = "down" | "flat" | "up";

/** One position on the field that carries at least one edge. */
export interface Mark {
  id: string;
  row: number;
  col: number;
  from: string;
  to: string;
  /** Every edge at this position. Two modules can be related two ways. */
  kinds: readonly EdgeKind[];
  /** The clause from the first edge here — the one-hop preview's whole text. */
  note: string;
  sense: Sense;
}

function buildMarks(): Mark[] {
  const at = new Map<string, Mark & { kinds: EdgeKind[] }>();
  for (const e of EDGES) {
    const row = indexOf(e.from);
    const col = indexOf(e.to);
    if (row < 0 || col < 0) continue;
    const key = `${row}:${col}`;
    const hit = at.get(key);
    if (hit) {
      if (!hit.kinds.includes(e.kind)) hit.kinds.push(e.kind);
      continue;
    }
    const fromLayer = systemById(componentById(e.from)?.system ?? "")?.layer ?? "";
    const toLayer = systemById(componentById(e.to)?.system ?? "")?.layer ?? "";
    const df = depthOf(fromLayer);
    const dt = depthOf(toLayer);
    at.set(key, {
      id: key,
      row,
      col,
      from: e.from,
      to: e.to,
      kinds: [e.kind],
      note: e.note,
      sense: dt > df ? "down" : dt < df ? "up" : "flat",
    });
  }
  return [...at.values()].sort((a, b) => a.row - b.row || a.col - b.col);
}

/** Every occupied position, in reading order. One per (row, col), never one per edge. */
export const MARKS: readonly Mark[] = buildMarks();

const MARK_AT = new Map(MARKS.map((m) => [`${m.row}:${m.col}`, m]));
export const markAt = (row: number, col: number): Mark | null =>
  MARK_AT.get(`${row}:${col}`) ?? null;

/** The marks in one component's row — what it depends on. */
export const marksInRow = (i: number): Mark[] => MARKS.filter((m) => m.row === i);
/** The marks in one component's column — what depends on it. */
export const marksInCol = (i: number): Mark[] => MARKS.filter((m) => m.col === i);

/** Out-degree and in-degree per axis index, for the rails' margin bars. */
function degrees(): { out: number[]; in: number[] } {
  const out = new Array<number>(N).fill(0);
  const into = new Array<number>(N).fill(0);
  for (const m of MARKS) {
    out[m.row] = (out[m.row] ?? 0) + m.kinds.length;
    into[m.col] = (into[m.col] ?? 0) + m.kinds.length;
  }
  return { out, in: into };
}

const DEG = degrees();

export const outDegree = (i: number): number => DEG.out[i] ?? 0;
export const inDegree = (i: number): number => DEG.in[i] ?? 0;
export const MAX_DEGREE = Math.max(1, ...DEG.out, ...DEG.in);

/** Every reach back up the stack, left of the diagonal. The exceptions the form is for. */
export const REACHES: readonly Mark[] = MARKS.filter((m) => m.sense === "up");

/* -------------------------------------- the aggregates -------------------------------------- */

/** One block of the coarser grains: a pair of spans and how much crosses between them. */
export interface Aggregate {
  id: string;
  from: string;
  to: string;
  rect: Rect;
  /** How many marks fall inside. */
  count: number;
  sense: Sense;
  /** `count` as a fraction of the busiest block at this grain — the fill. */
  weight: number;
}

function aggregate(spans: readonly Span[], grain: string, senseOf: (a: Span, b: Span) => Sense): Aggregate[] {
  const out: Aggregate[] = [];
  let top = 0;
  for (const a of spans) {
    for (const b of spans) {
      let count = 0;
      for (const m of MARKS) {
        if (m.row < a.start || m.row >= a.start + a.count) continue;
        if (m.col < b.start || m.col >= b.start + b.count) continue;
        count += 1;
      }
      if (count === 0) continue;
      if (count > top) top = count;
      out.push({
        id: `${grain}:${a.id}->${b.id}`,
        from: a.id,
        to: b.id,
        rect: pairRect(a, b),
        count,
        sense: senseOf(a, b),
        weight: 0,
      });
    }
  }
  return out.map((agg) => ({ ...agg, weight: top > 0 ? agg.count / top : 0 }));
}

const layerSense = (a: Span, b: Span): Sense => {
  const da = depthOf(a.id);
  const db = depthOf(b.id);
  return db > da ? "down" : db < da ? "up" : "flat";
};

const systemSense = (a: Span, b: Span): Sense => {
  const la = systemById(a.id)?.layer ?? "";
  const lb = systemById(b.id)?.layer ?? "";
  return layerSense(
    { ...a, id: la },
    { ...b, id: lb },
  );
};

/** The coarsest grain: 6 x 6. What a whole layer asks of a whole layer. Band 0 reads this. */
export const LAYER_CELLS: readonly Aggregate[] = aggregate(LAYER_SPANS, "layer", layerSense);

/** The middle grain: 19 x 19, only the occupied blocks. Band 1 reads this. */
export const SYSTEM_CELLS: readonly Aggregate[] = aggregate(SYSTEM_SPANS, "system", systemSense);

/**
 * THE ZONE THAT IS SUPPOSED TO BE EMPTY, and the reason this direction exists.
 *
 * Every pair of layers where the row's layer sits BELOW the column's layer in README §3.1's
 * stack. A mark in any of these fifteen blocks is a module reaching back up the stack — exactly
 * what *"packages depend on ports, never on concrete classes"* forbids. Together they are the
 * lower-left triangle of the field, and at the time of writing every one of them is empty: all
 * 120 edges in the model run down the stack or stay inside one layer.
 *
 * SO THE CLAIM IS DRAWN RATHER THAN ASSERTED. The surface hatches these fifteen blocks and puts
 * the tally on them; an architecture that started to fold back on itself would put a mark in a
 * hatched zone, and a reader would see it from across the room without reading anything. That is
 * the one thing a matrix does that no arrangement of boxes and lines can do at all: it gives the
 * ABSENCE of a relationship a position on the page.
 */
export interface Zone {
  id: string;
  from: LayerId;
  to: LayerId;
  rect: Rect;
  /** Marks inside. Zero is the architecture keeping its promise. */
  count: number;
}

function upwardZones(): Zone[] {
  const out: Zone[] = [];
  for (const a of LAYER_SPANS) {
    for (const b of LAYER_SPANS) {
      if (depthOf(a.id) <= depthOf(b.id)) continue;
      const rect = pairRect(a, b);
      let count = 0;
      for (const m of MARKS) {
        if (m.row < a.start || m.row >= a.start + a.count) continue;
        if (m.col < b.start || m.col >= b.start + b.count) continue;
        count += 1;
      }
      out.push({ id: `zone:${a.id}->${b.id}`, from: a.id, to: b.id, rect, count });
    }
  }
  return out;
}

export const UPWARD_ZONES: readonly Zone[] = upwardZones();

/** How many marks sit in a zone that is supposed to be empty. The headline figure. */
export const ZONE_BREACHES = UPWARD_ZONES.reduce((n, z) => n + z.count, 0);

/* ---------------------------------------- the counts ---------------------------------------- */

export const MATRIX_COUNTS = {
  axis: N,
  cells: N * N,
  marks: MARKS.length,
  edges: EDGES.length,
  reaches: REACHES.length,
  /** Marks standing in a zone the architecture says must be empty. See `UPWARD_ZONES`. */
  breaches: ZONE_BREACHES,
  zones: UPWARD_ZONES.length,
  layers: LAYER_SPANS.length,
  systems: SYSTEM_SPANS.length,
  /** Occupancy, as a percentage with one decimal. The honest headline of any matrix. */
  density: Math.round((MARKS.length / (N * N)) * 1000) / 10,
} as const;

/** Every component the model has, whether or not it reached the axis. The test compares them. */
export const MODEL_COMPONENTS: readonly string[] = COMPONENTS.map((c) => c.id);
export const MODEL_SYSTEMS: readonly string[] = SYSTEMS.map((s) => s.id);
