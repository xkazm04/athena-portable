/**
 * FIXED CELL MATH, AND A DIFFERENCE-CONSTRAINT PASS OVER IT. Archify study §3, §7.4, §7.6.
 *
 * NO AUTO-LAYOUT LIBRARY, and that is archify's position rather than a shortcut: architecture
 * diagrams are laid out on a grid whose ROWS AND COLUMNS MEAN SOMETHING, and a force simulation
 * throws that meaning away in exchange for an arrangement that is different every time it runs.
 * Archify's `grid.mjs` is `{origin, cols, gapX, gapY, cellW, cellH}` and nothing more.
 *
 * WHAT THE TWO AXES MEAN HERE — this is the whole idea of this variant:
 *
 *     a ROW is a layer (README §3.1, surfaces at the top)
 *     a COLUMN is a KIND (`kinds.ts` — what the thing does in a turn)
 *
 * so a system's position is (where it sits, what it does) and the drawing answers a question the
 * round-4 blueprint could not: *where does the gate live?* It lives in one column, four rows tall,
 * and the rose `security-group` around it crosses four amber layer regions. A layer that uses one
 * kind (the lane, the contracts) is a short region; `core` spans backend to cloud. The ragged right
 * edge of the drawing is the model's own shape, not a packing artefact.
 *
 * THE SECOND VIEW, `stack`, is archify's literal `DEFAULT_GRID`: four columns, systems in part
 * order, wrapping. It exists to be compared with — the same nodes, the same runs, the kind axis
 * taken away — because a claim that an axis carries meaning is only worth making if the version
 * without it is on the switcher next to it.
 *
 * THE CONSTRAINT PASS (study §3, "spacing is a 1-D difference-constraint system over column ranks,
 * minimums from node widths and label widths"). Column lefts are the variables; the constraints are
 *
 *     X[c+1] − X[c] ≥ colW[c] + gapX                        a column holds its widest cell
 *     X[c₂+1] − X[c₁] ≥ labelWidth(group)                   a boundary's corner label fits its frame
 *     Y[r+1] − Y[r] ≥ rowH[r] + gapY                        a row holds its tallest cell
 *
 * and `solve()` is a longest-path relaxation over them rather than a prefix sum, so a constraint
 * that is not a chain link (the second one) is honoured instead of being rounded away. Routing
 * failures are fed back the same way: `widen()` raises a gap minimum and the caller re-solves.
 *
 * NO RAW `px` IN THIS FILE and none is needed: every number below is a WORLD UNIT, the components
 * emit them as inline `style` from these values, and `design/check-tokens.mjs` cannot mistake a
 * tested geometry for a design decision. That is the round-4 finding, kept.
 */
import {
  COMPONENTS,
  LAYER_ORDER,
  SYSTEMS,
  componentsOf,
  layerById,
  systemsOf,
  type Component,
  type LayerId,
  type System,
} from "@/data";

import {
  KINDS,
  KIND_COL,
  TRUST_LABEL,
  TRUST_SYSTEMS,
  componentText,
  inTrust,
  kindOfComponent,
  kindOfSystem,
  systemText,
  type Kind,
  type NodeText,
} from "./kinds";

/* ---------------------------------------- primitives ----------------------------------------- */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const centreOf = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export const contains = (r: Rect, p: { x: number; y: number }): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const unionOf = (rects: readonly Rect[]): Rect => {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export const padRect = (r: Rect, top: number, side: number, bottom: number): Rect => ({
  x: r.x - side,
  y: r.y - top,
  w: r.w + side * 2,
  h: r.h + top + bottom,
});

/* ------------------------------------------ the grid ----------------------------------------- */

/**
 * The cell math. Archify's `DEFAULT_GRID` in our units, plus the three paddings its boundary rule
 * asks for (30 top/left/right, 50 bottom) — which is why `gapY` is what it is: two regions whose
 * frames are 30 and 50 from their members cannot sit 44 apart without their dashes touching.
 */
export const GRID = {
  gapX: 46,
  gapY: 104,
  /**
   * Between two nodes sharing one cell, and between two components inside a node.
   *
   * BOTH ARE SET BY THE ROUTER, NOT BY THE EYE, and that is the round-5 finding this file owes the
   * formula: a gap narrower than twice the router's hard clearance (`routing.ts: CLEAR`) contains
   * no lane, so a box in the middle of a tight pack is UNREACHABLE — every route out of it is
   * blocked by its own neighbours. The first run of `test/archify.routing.test.ts` dropped three
   * runs inside `sys-studio` for exactly that reason. Spacing is a routing constraint first and a
   * rhythm second, which is archify's §3 relationship between the two read backwards.
   */
  cellGap: 34,
  partGap: 32,
  /** Study §3: a region frame is its members' bounding box padded 30 top/left/right, 50 bottom. */
  regionPad: 30,
  regionPadBottom: 50,
  /** The security-group is nested inside the regions it crosses, so it is padded less. */
  groupPad: 15,
  /** The sheet's own margin. */
  margin: 60,
} as const;

/** One node's anatomy, in world units. No title bar — study §2. */
export const NODE = {
  minW: 156,
  /** The sigil strip: the stroked semantic mark sits top-left, the tag top-right. */
  headH: 24,
  padX: 13,
  padY: 12,
  minH: 64,
} as const;

/** A component, drawn inside its system's node once the layer is open. */
export const PART = { w: 96, h: 34, maxCols: 3 } as const;

/**
 * Text advance, per tier, in world units per character.
 *
 * A measurement, not a guess: one typeface (the app's `--at-font-fig`, a monospace) at the three
 * archify sizes — label 11/600, sublabel 9, tag 7 — and a monospace advance is 0.6 em. Shrink-to-fit
 * is the other half of the rule (study §7.8) and lives in CSS as a clamp on the label's own scale;
 * what this number is for is the CONSTRAINT: a column must be wide enough that shrinking is never
 * asked for in the first place.
 */
export const ADVANCE = { label: 6.6, sub: 5.4, tag: 4.2 } as const;

export const textWidth = (t: NodeText): number =>
  Math.max(
    t.label.length * ADVANCE.label,
    t.sublabel.length * ADVANCE.sub,
    t.tag.length * ADVANCE.tag,
  );

/* ------------------------------------ the constraint solver ---------------------------------- */

/** `to − from ≥ gap`. The only shape of constraint this layout needs. */
export interface Constraint {
  from: number;
  to: number;
  gap: number;
}

/**
 * Longest path over the constraints, relaxed to a fixed point.
 *
 * `n` positions, every one starting at 0, every constraint relaxed until nothing moves or the
 * iteration cap is hit. With only chain constraints this is a prefix sum; the cap is `n` passes,
 * which is Bellman-Ford's bound and therefore exact for the acyclic systems this file builds.
 * A cycle would simply stop improving rather than diverge, which is the behaviour a layout wants.
 */
export function solve(n: number, constraints: readonly Constraint[]): number[] {
  const at = new Array<number>(n).fill(0);
  for (let pass = 0; pass < n; pass += 1) {
    let moved = false;
    for (const c of constraints) {
      const want = at[c.from]! + c.gap;
      if (want > at[c.to]! + 1e-9) {
        at[c.to] = want;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return at;
}

/* -------------------------------------------- views ------------------------------------------ */

export const VIEWS = ["sheet", "stack"] as const;
export type ViewId = (typeof VIEWS)[number];

export const VIEW_INFO: Record<ViewId, { label: string; note: string; runs: string }> = {
  sheet: {
    label: "Sheet",
    note: "Rows are layers, columns are kinds. The gate is one column, four rows tall.",
    runs: "a run is an authored dependency, orthogonal and labelled",
  },
  stack: {
    label: "Stack",
    note: "Archify's own four-column grid, part order, no kind axis — the control.",
    runs: "the same runs, re-routed for the new spacing",
  },
};

/** Which column a system takes, per view. The one place the two arrangements differ. */
function placeOf(view: ViewId, layer: LayerId): Map<string, { col: number; slot: number }> {
  const out = new Map<string, { col: number; slot: number }>();
  const rows = [...systemsOf(layer)].sort((a, b) => a.part.localeCompare(b.part));

  if (view === "stack") {
    /* Archify's `DEFAULT_GRID.cols = 4`, wrapping. One system per cell, stacked down. */
    rows.forEach((s, i) => out.set(s.id, { col: i % 4, slot: Math.floor(i / 4) }));
    return out;
  }

  /* `sheet`: the column IS the kind. Within a cell, a member of the trust boundary sorts first,
     which is what keeps the security-group's derived frame tight around its members instead of
     swallowing the node next door. */
  const byKind = new Map<Kind, System[]>();
  for (const s of rows) {
    const k = kindOfSystem(s.id);
    const bucket = byKind.get(k);
    if (bucket) bucket.push(s);
    else byKind.set(k, [s]);
  }
  for (const [kind, group] of byKind) {
    group
      .sort((a, b) => (inTrust(a.id) ? 0 : 1) - (inTrust(b.id) ? 0 : 1) || a.part.localeCompare(b.part))
      .forEach((s, slot) => out.set(s.id, { col: KIND_COL[kind], slot }));
  }
  return out;
}

/** How many columns a cell's slots are arranged in. `sheet` pairs them; `stack` stacks them. */
const cellCols = (view: ViewId, n: number): number => (view === "stack" ? 1 : Math.min(2, n));

/* -------------------------------------------- the plan --------------------------------------- */

export interface PartBox extends Rect {
  id: string;
  kind: Kind;
  text: NodeText;
  status: Component["status"];
}

export interface NodeBox extends Rect {
  id: string;
  kind: Kind;
  layer: LayerId;
  text: NodeText;
  status: System["status"];
  trust: boolean;
  /** The components inside, positioned in world units. Drawn from band 1, in the open layer. */
  parts: PartBox[];
}

export interface Boundary extends Rect {
  id: string;
  /** Archify's two boundary kinds. `region` is amber dash 8,4; `security-group` rose dash 4,4. */
  kind: "region" | "security-group";
  label: string;
  note: string;
  /** The ids the frame was DERIVED from. Never an authored rectangle (study §7.4). */
  wraps: readonly string[];
}

export interface Plan {
  view: ViewId;
  nodes: NodeBox[];
  boundaries: Boundary[];
  /** One layer's region, by id — what `poseFor` frames at L1. */
  frames: Partial<Record<LayerId, Rect>>;
  bounds: Rect;
}

const nodeSize = (s: System): { w: number; h: number } => {
  const n = componentsOf(s.id).length;
  const cols = Math.max(1, Math.min(PART.maxCols, Math.ceil(Math.sqrt(n))));
  const rows = Math.max(1, Math.ceil(n / cols));
  const innerW = cols * PART.w + (cols - 1) * GRID.partGap;
  const innerH = rows * PART.h + (rows - 1) * GRID.partGap;
  return {
    w: Math.max(NODE.minW, innerW + NODE.padX * 2, textWidth(systemText(s)) + NODE.padX * 2),
    h: Math.max(NODE.minH, NODE.headH + NODE.padY * 2 + innerH),
  };
};

function partsOf(s: System, box: Rect): PartBox[] {
  const parts = componentsOf(s.id);
  if (parts.length === 0) return [];
  const cols = Math.max(1, Math.min(PART.maxCols, Math.ceil(Math.sqrt(parts.length))));
  const innerW = cols * PART.w + (cols - 1) * GRID.partGap;
  const left = box.x + (box.w - innerW) / 2;
  const top = box.y + NODE.headH + NODE.padY;
  return parts.map((c, i) => ({
    id: c.id,
    kind: kindOfComponent(c),
    text: componentText(c),
    status: c.status,
    x: left + (i % cols) * (PART.w + GRID.partGap),
    y: top + Math.floor(i / cols) * (PART.h + GRID.partGap),
    w: PART.w,
    h: PART.h,
  }));
}

/**
 * Build one arrangement.
 *
 * `extraX` is the routing feedback channel (study §3, "routing failures fed back into spacing"):
 * a map of column index → additional minimum gap. The caller re-plans with it when a run could not
 * be routed through a corridor that was too narrow, which is the only honest fix — widening the
 * sheet rather than letting a line cross a box.
 */
export function buildPlan(view: ViewId, extraX: ReadonlyMap<number, number> = new Map()): Plan {
  const colCount = view === "stack" ? 4 : KINDS.length;
  const rowCount = LAYER_ORDER.length;

  /* Pass 1: what every system needs, and where it wants to sit. */
  const want = new Map<string, { row: number; col: number; slot: number; w: number; h: number }>();
  LAYER_ORDER.forEach((layer, row) => {
    const place = placeOf(view, layer);
    for (const s of systemsOf(layer)) {
      const at = place.get(s.id);
      if (!at) continue;
      want.set(s.id, { row, col: at.col, slot: at.slot, ...nodeSize(s) });
    }
  });

  /* Pass 2: a uniform node box per column (width) and per row (height) — the fixed cell math. */
  const nodeW = new Array<number>(colCount).fill(NODE.minW);
  const nodeH = new Array<number>(rowCount).fill(NODE.minH);
  const slots = new Map<string, number>(); // `${row}:${col}` → how many systems share the cell
  for (const w of want.values()) {
    nodeW[w.col] = Math.max(nodeW[w.col]!, w.w);
    nodeH[w.row] = Math.max(nodeH[w.row]!, w.h);
    const key = `${w.row}:${w.col}`;
    slots.set(key, Math.max(slots.get(key) ?? 0, w.slot + 1));
  }

  /* Pass 3: the constraint system. Column lefts and row tops, solved by relaxation. */
  const colW = new Array<number>(colCount).fill(0);
  const rowH = new Array<number>(rowCount).fill(0);
  for (let r = 0; r < rowCount; r += 1) {
    for (let c = 0; c < colCount; c += 1) {
      const n = slots.get(`${r}:${c}`) ?? 0;
      if (n === 0) continue;
      const cc = cellCols(view, n);
      const cr = Math.ceil(n / cc);
      colW[c] = Math.max(colW[c]!, cc * nodeW[c]! + (cc - 1) * GRID.cellGap);
      rowH[r] = Math.max(rowH[r]!, cr * nodeH[r]! + (cr - 1) * GRID.cellGap);
    }
  }

  const xs: Constraint[] = [];
  for (let c = 0; c + 1 < colCount; c += 1) {
    xs.push({ from: c, to: c + 1, gap: colW[c]! + GRID.gapX + (extraX.get(c) ?? 0) });
  }
  /* The boundary-label constraint: the security-group's corner label must fit across the columns
     its members occupy, or the label overruns a frame it is supposed to name. */
  if (view === "sheet") {
    const cols = TRUST_SYSTEMS.map((id) => want.get(id)?.col).filter((c): c is number => c != null);
    const lo = Math.min(...cols);
    const hi = Math.max(...cols);
    if (hi > lo) {
      xs.push({ from: lo, to: hi, gap: TRUST_LABEL.length * ADVANCE.tag - nodeW[hi]! });
    }
  }
  const X = solve(colCount, xs);

  const ys: Constraint[] = [];
  for (let r = 0; r + 1 < rowCount; r += 1) {
    ys.push({ from: r, to: r + 1, gap: rowH[r]! + GRID.gapY });
  }
  const Y = solve(rowCount, ys);

  /* Pass 4: the boxes. */
  const nodes: NodeBox[] = [];
  for (const s of SYSTEMS) {
    const w = want.get(s.id);
    if (!w) continue;
    const n = slots.get(`${w.row}:${w.col}`) ?? 1;
    const cc = cellCols(view, n);
    const box: Rect = {
      x: X[w.col]! + (w.slot % cc) * (nodeW[w.col]! + GRID.cellGap),
      y: Y[w.row]! + Math.floor(w.slot / cc) * (nodeH[w.row]! + GRID.cellGap),
      w: nodeW[w.col]!,
      h: nodeH[w.row]!,
    };
    nodes.push({
      ...box,
      id: s.id,
      kind: kindOfSystem(s.id),
      layer: s.layer,
      text: systemText(s),
      status: s.status,
      trust: inTrust(s.id),
      parts: partsOf(s, box),
    });
  }

  /* Pass 5: boundaries, DERIVED from membership and never authored (study §7.4). */
  const boundaries: Boundary[] = [];
  const frames: Partial<Record<LayerId, Rect>> = {};
  for (const layer of LAYER_ORDER) {
    const members = nodes.filter((n) => n.layer === layer);
    if (members.length === 0) continue;
    const frame = padRect(unionOf(members), GRID.regionPad, GRID.regionPad, GRID.regionPadBottom);
    frames[layer] = frame;
    boundaries.push({
      ...frame,
      id: layer,
      kind: "region",
      label: layerById(layer)?.name ?? layer,
      note: `${members.length} systems`,
      wraps: members.map((m) => m.id),
    });
  }

  const trust = nodes.filter((n) => n.trust);
  if (trust.length > 0) {
    boundaries.push({
      ...padRect(unionOf(trust), GRID.groupPad, GRID.groupPad, GRID.groupPad),
      id: "trust",
      kind: "security-group",
      label: TRUST_LABEL,
      note: "the gate, and the receipt it leaves",
      wraps: trust.map((m) => m.id),
    });
  }

  const bounds = padRect(unionOf(boundaries), GRID.margin, GRID.margin, GRID.margin);

  /* Centre the world on the origin, so the camera's `pan` is the negative of a world point and
     nothing downstream has to know the sheet's size (the round-4 arrangement, kept). */
  const dx = -(bounds.x + bounds.w / 2);
  const dy = -(bounds.y + bounds.h / 2);
  const shift = <T extends Rect>(r: T): T => ({ ...r, x: r.x + dx, y: r.y + dy });

  return {
    view,
    nodes: nodes.map((n) => ({ ...shift(n), parts: n.parts.map(shift) })),
    boundaries: boundaries.map(shift),
    frames: Object.fromEntries(
      Object.entries(frames).map(([k, v]) => [k, shift(v)]),
    ) as Partial<Record<LayerId, Rect>>,
    bounds: shift(bounds),
  };
}

/** The two plans, built once. A plan is a pure function of its view; nothing mutates one. */
export const PLANS: Record<ViewId, Plan> = {
  sheet: buildPlan("sheet"),
  stack: buildPlan("stack"),
};

/** The world box both views share, so a view switch is a re-arrangement and not a new sheet. */
export const WORLD = (() => {
  const w = Math.max(...VIEWS.map((v) => PLANS[v].bounds.w)) * 2;
  const h = Math.max(...VIEWS.map((v) => PLANS[v].bounds.h)) * 2;
  return { w, h };
})();

export const nodeIn = (view: ViewId, id: string): NodeBox | undefined =>
  PLANS[view].nodes.find((n) => n.id === id);

export const partIn = (view: ViewId, id: string): PartBox | undefined => {
  for (const n of PLANS[view].nodes) {
    const hit = n.parts.find((p) => p.id === id);
    if (hit) return hit;
  }
  return undefined;
};

/** Every component in the model has a box in every view — asserted by the layout test. */
export const PLACED_PARTS = COMPONENTS.length;
