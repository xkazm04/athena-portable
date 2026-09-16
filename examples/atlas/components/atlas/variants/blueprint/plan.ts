/**
 * THE FOUR ARRANGEMENTS. One set of blocks, laid out four ways, computed once, pure.
 *
 * Atlas is a blueprint: nineteen system blocks, each holding its components as parts, drawn on one
 * sheet. A **view** is an arrangement of those same blocks and a set of runs between them —
 * *"the same blocks, re-arranged"* (DESIGN.md §3) — so a view switch is a layout transition and
 * not a new drawing. That is only true if a block's SIZE never depends on the view, which is why
 * `geometry.ts` sizes it from the model alone and why every builder below may choose only x and y.
 *
 *   layers    the six strata of README §3.1 as bands, surfaces at the top, contracts at the
 *             bottom, dependency runs going down. The default, and the only view whose regions
 *             ARE the level model's groups.
 *   turn      README §3.2's twelve stops in order, the path numbered, the gate and the ledger
 *             marked, everything the turn does not touch on a shelf below.
 *   trust     the six invariants of README §2 as regions; a block stands in the one it serves
 *             most and tethers to the others it also serves.
 *   packages  the file tree — `src/athena/**`, `apps/desktop`, `packages/**`, `examples` — as
 *             nested rectangles. Runs are hidden until asked for.
 *
 * THE LEVEL MODEL IS THE SAME IN ALL FOUR. L1's group is always a LAYER, whatever the view groups
 * its regions by, because `open_group` has to mean one thing to an agent on every surface in
 * `examples/`. Each view therefore publishes a `frame` per layer — the bounding box of that
 * layer's blocks wherever they ended up — and `poses.ts` centres the camera on it. In the layers
 * view the frame IS the band; in the other three it is wherever those blocks landed, which is
 * exactly the question "where does this layer live in this arrangement" and is worth being able
 * to ask.
 *
 * Pure, total, no React: `test/plan.test.ts` pins overlap-freedom, edge endpoints, band
 * membership and the poseFor/resolve inverses under `node --test`.
 */
import {
  COMPONENTS,
  CONCEPTS,
  LAYERS,
  LAYER_ORDER,
  SYSTEMS,
  SYSTEM_EDGES,
  componentsOf,
  systemById,
  systemsOf,
  type Component,
  type LayerId,
  type Status,
  type System,
} from "@/data";

import {
  DIM,
  balancedCols,
  blockHeight,
  boundsOf,
  centreOf,
  packRows,
  partRect,
  textBox,
  type Point,
  type Rect,
  type Run,
} from "./geometry";
import { Router, type Corridors, type Obstacle, type Routed } from "./route";
import { TURN, TURN_BLOCKS } from "./turn";

/* ---------------------------------------- the views ---------------------------------------- */

export const VIEWS = ["layers", "turn", "trust", "packages"] as const;
export type ViewId = (typeof VIEWS)[number];

export const isView = (v: unknown): v is ViewId =>
  typeof v === "string" && (VIEWS as readonly string[]).includes(v);

export interface ViewMeta {
  id: ViewId;
  /** The segmented control's label. */
  label: string;
  /** One line under the mast: what this arrangement is an argument about. */
  note: string;
  /** What the runs mean here, for the legend. */
  runs: string;
}

export const VIEW_META: Record<ViewId, ViewMeta> = {
  layers: {
    id: "layers",
    label: "Layers",
    note: "README §3.1 — six strata, surfaces on top, contracts at the floor. Runs go down: a run that leaves a block's foot is a dependency.",
    runs: "depends on",
  },
  turn: {
    id: "turn",
    label: "Turn",
    note: "README §3.2 — one request, twelve stops, in order. The gate waits; the ledger is written whatever happens.",
    runs: "then",
  },
  trust: {
    id: "trust",
    label: "Trust",
    note: "README §2 — the six invariants. A block stands in the one it serves most and tethers to the others it also serves.",
    runs: "enforces",
  },
  packages: {
    id: "packages",
    label: "Packages",
    note: "The tree on disk. Nesting is containment, nothing else; runs are hidden until you ask for them.",
    runs: "imports",
  },
};

/* --------------------------------------- the pieces --------------------------------------- */

/** One component, as a part inside its block. The rect is RELATIVE to the block's top-left. */
export interface PartBox extends Rect {
  id: string;
  part: string;
  name: string;
  status: Status;
  system: string;
}

/** One system. Its rect is absolute on the sheet and its size never changes between views. */
export interface BlockBox extends Rect {
  id: string;
  part: string;
  name: string;
  layer: LayerId;
  status: Status;
  home: string;
  parts: readonly PartBox[];
}

export type RegionKind = "layer" | "stage" | "invariant" | "folder" | "shelf";

/** A ruled area of the sheet with a heading. What a view groups its blocks into. */
export interface RegionBox extends Rect {
  id: string;
  kind: RegionKind;
  name: string;
  /** The heading's second line: a count, a source, a path. */
  note: string;
  /** Reading order within the view. */
  index: number;
  /** Nesting depth. Only `packages` goes past 0. */
  depth: number;
  blocks: readonly string[];
}

export type RunMode = "system" | "path" | "tether";

export interface PlanEdge {
  id: string;
  /** Block ids, always — component-level runs are derived per open layer, not stored. */
  from: string;
  to: string;
  mode: RunMode;
  /** How many component edges cross this way (`system`), or the stop number (`path`). */
  weight: number;
  /** The sentence the readout and the tools use. Never drawn on the sheet. */
  label: string;
  /** The two or three characters drawn ON the run, over an opaque mask. Null for an unlabelled run. */
  short: string | null;
  run: Run;
  /** Where the short label sits, in world units. */
  labelAt: Point | null;
  /** Which candidate family won, and whether the search failed and fell back. For the tests. */
  family: Routed["family"];
  fallback: boolean;
}

export interface Plan {
  view: ViewId;
  blocks: readonly BlockBox[];
  regions: readonly RegionBox[];
  edges: readonly PlanEdge[];
  /** Every layer's bounding box in this arrangement. The L1 frame. */
  frames: Readonly<Record<LayerId, Rect>>;
  /** The whole sheet, margin included. */
  bounds: Rect;
}

/* ------------------------------------ the shared sizing ------------------------------------ */

const partsOf = (system: System): PartBox[] =>
  componentsOf(system.id).map((c: Component, i) => ({
    ...partRect(i),
    id: c.id,
    part: c.part,
    name: c.name,
    status: c.status,
    system: system.id,
  }));

/** Every block, sized from the model, with no position yet. Computed once for all four views. */
const SIZED: readonly Omit<BlockBox, "x" | "y">[] = SYSTEMS.map((s) => ({
  id: s.id,
  part: s.part,
  name: s.name,
  layer: s.layer,
  status: s.status,
  home: s.home,
  w: DIM.blockW,
  h: blockHeight(componentsOf(s.id).length),
  parts: partsOf(s),
}));

const SIZE_BY_ID = new Map(SIZED.map((b) => [b.id, b]));

const place = (id: string, at: Point): BlockBox => {
  const base = SIZE_BY_ID.get(id);
  if (!base) throw new Error(`plan: no block for system ${id}`);
  return { ...base, x: at.x, y: at.y };
};

/* --------------------------------- regions, stacked in a column --------------------------------- */

interface RegionSpec {
  id: string;
  kind: RegionKind;
  name: string;
  note: string;
  blocks: string[];
}

/**
 * Stack regions down the sheet, each one packing its own blocks into rows.
 *
 * Every region is given the SAME width — the widest one's — so a column of regions reads as a set
 * of strata rather than as a ragged stack. That is the whole visual argument of the layers view
 * and it costs one `max`.
 */
function stack(specs: readonly RegionSpec[]): { blocks: BlockBox[]; regions: RegionBox[] } {
  const packs = specs.map((s) =>
    packRows(
      s.blocks.map((id) => SIZE_BY_ID.get(id) ?? { w: DIM.blockW, h: DIM.headH }),
      balancedCols(s.blocks.length),
    ),
  );
  const width = Math.max(DIM.blockW, ...packs.map((p) => p.w)) + DIM.regionPad * 2;

  const blocks: BlockBox[] = [];
  const regions: RegionBox[] = [];
  let y = DIM.margin;

  specs.forEach((spec, index) => {
    const pack = packs[index]!;
    const h = DIM.regionHead + DIM.regionPad * 2 + pack.h;
    const left = DIM.margin + (width - pack.w) / 2;
    const top = y + DIM.regionHead + DIM.regionPad;
    spec.blocks.forEach((id, i) => {
      const at = pack.at[i]!;
      blocks.push(place(id, { x: left + at.x, y: top + at.y }));
    });
    regions.push({
      id: spec.id,
      kind: spec.kind,
      name: spec.name,
      note: spec.note,
      index,
      depth: 0,
      blocks: spec.blocks,
      x: DIM.margin,
      y,
      w: width,
      h,
    });
    y += h + DIM.regionGap;
  });

  return { blocks, regions };
}

/* ------------------------------------------ the runs ------------------------------------------ */

const rectOf = (blocks: readonly BlockBox[], id: string): Rect | null =>
  blocks.find((b) => b.id === id) ?? null;

/**
 * EVERYTHING ON THE SHEET THAT A RUN MUST NOT CROSS, and the one distinction that matters:
 * a rectangle with WORDS in it is hard, a rectangle without is soft.
 *
 * Hard: a region's heading (as wide as its text, not as wide as the region — a boundary is not an
 * obstacle, its label is) and a block's title bar, which is the one part of a block that always
 * carries type. Soft: a block's body, which a run may cross when the sheet leaves it no choice.
 *
 * This is the study's "groups derived from membership, never authored rectangles" (§7.4) read from
 * the other end: the region rectangle is derived, so it is not a thing to route around — the words
 * in it are.
 */
export function wallsFor(blocks: readonly BlockBox[], regions: readonly RegionBox[]): Obstacle[] {
  const walls: Obstacle[] = [];
  for (const r of regions) {
    const box = textBox(r.name.length + r.note.length + 3);
    /**
     * THE HEADING IS CAPPED AT FORTY-FIVE PER CENT OF ITS REGION, and the number is a finding.
     *
     * Uncapped, a stratum's heading plus its blurb is 830 world units of a 1020-unit region — and
     * a region whose top edge is four fifths word is a region nothing can enter from above. The
     * router proved it: fourteen of the layers view's runs had no feasible candidate at all,
     * because every vertical corridor into the stratum and every outside channel beside it ran
     * through a sentence. Capping the heading leaves a clear entry wider than a block, which is
     * the geometric condition for the region to be reachable at all, and the stylesheet clips the
     * note to match (study §7.8: shrink to fit, reject rather than overflow).
     */
    walls.push({
      id: `head:${r.id}`,
      kind: "text",
      x: r.x,
      y: r.y,
      w: Math.min(r.w * HEAD_SHARE, box.w),
      h: DIM.regionHead,
    });
  }
  for (const b of blocks) {
    walls.push({ id: `title:${b.id}`, kind: "text", x: b.x, y: b.y, w: b.w, h: DIM.headH });
    if (b.h > DIM.headH) {
      walls.push({
        id: `body:${b.id}`,
        kind: "body",
        x: b.x,
        y: b.y + DIM.headH,
        w: b.w,
        h: b.h - DIM.headH,
      });
    }
  }
  return walls;
}

/**
 * What a system run says about itself, in two characters.
 *
 * A run that carries one import needs no figure — the run IS the fact. A run that carries nine
 * is a different claim about the two systems and the drawing should say so where the run is,
 * not in a tooltip. Everything longer than this belongs in the readout or the pane (item 5:
 * one details destination).
 */
const weightMark = (weight: number): string | null => (weight > 1 ? `×${weight}` : null);

/** How much of a region's top edge its heading may claim. The rest is where runs come in. */
export const HEAD_SHARE = 0.3;

/**
 * The two clear columns beside the whole drawing.
 *
 * A guarantee, not an optimisation: a pair of blocks with no corridor between them can always be
 * joined by going out past the edge of everything and back, so the search never has to give up and
 * `test/route.test.ts` can assert zero fallbacks rather than "not too many".
 */
function escapeOf(
  blocks: readonly BlockBox[],
  regions: readonly RegionBox[],
): { left: number; right: number } {
  const all = boundsOf([...regions, ...blocks]);
  return { left: all.x - DIM.regionGap, right: all.x + all.w + DIM.regionGap };
}

/**
 * The corridors the arrangement already left: the middle of every gap beside a block, and the
 * band above and below every row. Deduplicated to the nearest unit, because two blocks in the same
 * row leave the same corridor and the router should see it once.
 */
function corridorsOf(blocks: readonly BlockBox[]): Corridors {
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const b of blocks) {
    xs.add(Math.round(b.x - DIM.gapX / 2));
    xs.add(Math.round(b.x + b.w + DIM.gapX / 2));
    ys.add(Math.round(b.y - DIM.elbow));
    ys.add(Math.round(b.y + b.h + DIM.elbow));
  }
  return { xs: [...xs].sort((a, b) => a - b), ys: [...ys].sort((a, b) => a - b) };
}

export interface RunSpec {
  from: string;
  to: string;
  mode: RunMode;
  weight: number;
  label: string;
  /** What is drawn on the run itself, over its own mask. Two or three characters at most. */
  short: string | null;
  /**
   * The order this run is ROUTED in, biggest first. Defaults to the weight.
   *
   * It is separate from the weight because the two are not always the same question: a system run
   * is routed heaviest-first because the heaviest edge deserves the clean corridor, but the turn's
   * legs are routed in the order a reader FOLLOWS them, which is the opposite end of the weight.
   */
  priority?: number;
}

/**
 * Turn a list of block pairs into routed runs.
 *
 * THE ORDER IS THE DESIGN. Round 4 ranked runs that shared a corridor so they would not overlap,
 * which is a local fix for a global problem; round 5 routes them ONE AT A TIME, heaviest first,
 * each against everything already drawn — so the edge that carries twelve imports gets the clean
 * corridor and the edge that carries one goes round. Ties break on the id, so the sheet is
 * byte-deterministic and a test can assert on the geometry (study §3's stable ordinal).
 */
function runs(
  blocks: readonly BlockBox[],
  regions: readonly RegionBox[],
  pairs: readonly RunSpec[],
): PlanEdge[] {
  const router = new Router(
    wallsFor(blocks, regions),
    escapeOf(blocks, regions),
    corridorsOf(blocks),
  );
  const drawable = pairs
    .map((p) => ({ p, a: rectOf(blocks, p.from), b: rectOf(blocks, p.to) }))
    .filter((r) => r.a !== null && r.b !== null && r.p.from !== r.p.to)
    .sort(
      (x, y) =>
        (y.p.priority ?? y.p.weight) - (x.p.priority ?? x.p.weight) ||
        (`${x.p.from}->${x.p.to}` < `${y.p.from}->${y.p.to}` ? -1 : 1),
    );

  return drawable.map((r) => {
    const routed = router.route(
      r.a!,
      r.b!,
      r.p.short ? textBox(r.p.short.length) : null,
    );
    return {
      id: `${r.p.mode}:${r.p.from}->${r.p.to}`,
      from: r.p.from,
      to: r.p.to,
      mode: r.p.mode,
      weight: r.p.weight,
      label: r.p.label,
      short: r.p.short,
      run: { points: routed.points, from: routed.from, to: routed.to, down: routed.down },
      labelAt: routed.labelAt,
      family: routed.family,
      fallback: routed.fallback,
    };
  });
}

/* ------------------------------------------ the plan ------------------------------------------ */

/**
 * The finished sheet, with its middle moved to the world origin.
 *
 * THE SHIFT IS NOT COSMETIC. The kit's camera is `screen = centre + zoom · (world + pan)`, where
 * `world` is measured from the middle of the element carrying the transform — so `pan` is the
 * negative of the world point under the middle of the frame ONLY IF the drawing's middle is the
 * world origin. Every builder above lays its sheet out from a top-left corner, because that is how
 * a sheet is read; this is the one line that reconciles the two, and doing it here rather than at
 * each of the fifty call sites is why `poseFor` is three lines and `lookingAt` is one.
 */
function assemble(
  view: ViewId,
  blocks: BlockBox[],
  regions: RegionBox[],
  edges: PlanEdge[],
): Plan {
  const all = boundsOf([...regions, ...blocks]);
  const dx = -(all.x + all.w / 2);
  const dy = -(all.y + all.h / 2);

  const moved = blocks.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy }));
  const movedRegions = regions.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
  const movedEdges = edges.map((e) => ({
    ...e,
    run: { ...e.run, points: e.run.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) },
    labelAt: e.labelAt ? { x: e.labelAt.x + dx, y: e.labelAt.y + dy } : null,
  }));

  const frames = {} as Record<LayerId, Rect>;
  for (const layer of LAYER_ORDER) {
    const box = boundsOf(moved.filter((b) => b.layer === layer));
    frames[layer] = {
      x: box.x - DIM.regionPad,
      y: box.y - DIM.regionPad,
      w: box.w + DIM.regionPad * 2,
      h: box.h + DIM.regionPad * 2,
    };
  }

  return {
    view,
    blocks: moved,
    regions: movedRegions,
    edges: movedEdges,
    frames,
    bounds: {
      x: all.x + dx - DIM.margin,
      y: all.y + dy - DIM.margin,
      w: all.w + DIM.margin * 2,
      h: all.h + DIM.margin * 2,
    },
  };
}

/* -------------------------------------- 1. the layers -------------------------------------- */

function layersPlan(): Plan {
  const { blocks, regions } = stack(
    LAYERS.map((l) => ({
      id: l.id,
      kind: "layer" as const,
      name: l.name,
      note: l.blurb,
      blocks: systemsOf(l.id).map((s) => s.id),
    })),
  );
  const depth = (id: string) => LAYER_ORDER.indexOf((systemById(id)?.layer ?? "core") as LayerId);
  const edges = runs(
    blocks,
    regions,
    SYSTEM_EDGES.map((e) => ({
      from: e.from,
      to: e.to,
      mode: "system" as const,
      weight: e.weight,
      label:
        depth(e.to) > depth(e.from) ? "depends on" : depth(e.to) < depth(e.from) ? "reaches" : "calls",
      short: weightMark(e.weight),
    })),
  );
  return assemble("layers", blocks, regions, edges);
}

/* --------------------------------------- 2. the turn --------------------------------------- */

function turnPlan(): Plan {
  const onPath = [...TURN_BLOCKS];
  const off = SYSTEMS.filter((s) => !onPath.includes(s.id)).map((s) => s.id);
  const { blocks, regions } = stack([
    {
      id: "turn-path",
      kind: "stage",
      name: "One turn",
      note: `README §3.2 — ${TURN.length} stops through ${onPath.length} systems, in order`,
      blocks: onPath,
    },
    {
      id: "turn-off",
      kind: "shelf",
      name: "Not on this turn",
      note: `${off.length} systems the request never touches`,
      blocks: off,
    },
  ]);

  /* One run per LEG, so a revisit draws a run back to a block already on the sheet and the
     reader can see that the turn returns. A leg inside one block (approvals → ledger, both in
     `sys-record`) has nowhere to go and is dropped rather than drawn as a stub to itself. */
  const legs = TURN.slice(1).map((stop, i) => ({
    from: TURN[i]!.block,
    to: stop.block,
    mode: "path" as const,
    weight: stop.index + 1,
    /* The turn is read in ORDER, so its runs are routed in order too: the first leg gets the clean
       corridor and the last goes round, which is the order a reader follows them in. */
    priority: TURN.length - stop.index,
    label: `${stop.index + 1}. ${stop.label}`,
    short: String(stop.index + 1),
  }));
  return assemble("turn", blocks, regions, runs(blocks, regions, legs));
}

/* -------------------------------------- 3. the trust -------------------------------------- */

const INVARIANTS = CONCEPTS.filter((c) => c.kind === "invariant");

/** How many of a system's components carry a given concept. */
function carriedIn(system: string, concept: string): number {
  return componentsOf(system).reduce((n, c) => n + (c.concepts.includes(concept) ? 1 : 0), 0);
}

/** How many components carry an invariant at all — the denominator below. */
const CARRIERS = new Map(
  INVARIANTS.map((c) => [c.id, SYSTEMS.reduce((n, s) => n + carriedIn(s.id, c.id), 0)]),
);

/**
 * Every invariant a system serves at all, most-responsible first.
 *
 * THE RANK IS A SHARE, NOT A COUNT, and that is the whole design of this view. Ranking by raw
 * count puts every large system in invariant 3 — nineteen of the sixty-eight components carry it —
 * and leaves invariants 2 and 6 as empty regions, which says "nothing enforces provenance" when
 * what is true is "two components do, and neither is in a system that does mostly that". The share
 * (`this system's carriers ÷ every carrier of the invariant`) answers the question the view is
 * actually asking: *which promise is this system most responsible for keeping?* A system holding
 * one of the two components that carry invariant 2 is half of that promise, and belongs there.
 *
 * Ties break toward the bigger contribution, then toward README's own order of the invariants.
 */
export function invariantsOf(system: string): { id: string; n: number; share: number }[] {
  return INVARIANTS.map((c) => {
    const n = carriedIn(system, c.id);
    const of = CARRIERS.get(c.id) ?? 0;
    return { id: c.id, n, share: of > 0 ? n / of : 0 };
  })
    .filter((r) => r.n > 0)
    .sort(
      (a, b) =>
        b.share - a.share ||
        b.n - a.n ||
        INVARIANTS.findIndex((c) => c.id === a.id) - INVARIANTS.findIndex((c) => c.id === b.id),
    );
}

function trustPlan(): Plan {
  const home = new Map<string, string>();
  for (const s of SYSTEMS) {
    const best = invariantsOf(s.id)[0];
    if (best) home.set(s.id, best.id);
  }
  const unclaimed = SYSTEMS.filter((s) => !home.has(s.id)).map((s) => s.id);

  const specs: RegionSpec[] = INVARIANTS.map((c) => ({
    id: c.id,
    kind: "invariant" as const,
    name: c.name,
    note: `${c.part} · ${c.source} · ${CARRIERS.get(c.id) ?? 0} modules enforce it`,
    blocks: SYSTEMS.filter((s) => home.get(s.id) === c.id).map((s) => s.id),
  }));
  if (unclaimed.length > 0) {
    specs.push({
      id: "trust-none",
      kind: "shelf",
      name: "Carries no invariant of its own",
      note: "plumbing the claims above and below it depend on",
      blocks: unclaimed,
    });
  }

  const { blocks, regions } = stack(specs);

  /* A TETHER is a block's second, third… allegiance: it stands in the invariant it serves most
     and is tied to every other one it also serves. Drawn to the FIRST block of that region, which
     is the region's own anchor — a run to a heading would be a run to a label. */
  const anchor = new Map<string, string>();
  for (const r of regions) if (r.blocks[0]) anchor.set(r.id, r.blocks[0]);

  const tethers = SYSTEMS.flatMap((s) =>
    invariantsOf(s.id)
      .slice(1)
      .map((inv) => ({
        from: s.id,
        to: anchor.get(inv.id) ?? "",
        mode: "tether" as const,
        weight: inv.n,
        label: `also enforces ${CONCEPTS.find((c) => c.id === inv.id)?.name ?? inv.id}`,
        short: CONCEPTS.find((c) => c.id === inv.id)?.part ?? null,
      }))
      .filter((t) => t.to !== "" && t.to !== s.id),
  );

  return assemble("trust", blocks, regions, runs(blocks, regions, tethers));
}

/* ------------------------------------- 4. the packages ------------------------------------- */

interface TreeNode {
  seg: string;
  path: string;
  blocks: string[];
  kids: TreeNode[];
}

function tree(): TreeNode {
  const root: TreeNode = { seg: "", path: "", blocks: [], kids: [] };
  for (const s of SYSTEMS) {
    let node = root;
    for (const seg of s.home.split("/")) {
      let kid = node.kids.find((k) => k.seg === seg);
      if (!kid) {
        kid = { seg, path: node.path ? `${node.path}/${seg}` : seg, blocks: [], kids: [] };
        node.kids.push(kid);
      }
      node = kid;
    }
    node.blocks.push(s.id);
  }
  /* A folder with no blocks and one child is a segment of a path, not a place: `src` → `athena`
     becomes `src/athena`. Four levels of empty rectangles is nesting for its own sake. */
  const collapse = (n: TreeNode): TreeNode => {
    let here = n;
    while (here.blocks.length === 0 && here.kids.length === 1) {
      const only = here.kids[0]!;
      here = { seg: `${here.seg}/${only.seg}`, path: only.path, blocks: only.blocks, kids: only.kids };
    }
    return { ...here, kids: here.kids.map(collapse) };
  };
  return { ...root, kids: root.kids.map(collapse) };
}

interface Laid {
  w: number;
  h: number;
  emit: (at: Point, depth: number, index: { n: number }) => { blocks: BlockBox[]; regions: RegionBox[] };
}

/**
 * One folder, and everything under it, as a rectangle that knows how to place itself.
 *
 * SUB-FOLDERS ARE PACKED IN ROWS, NOT STACKED IN A COLUMN, and that is the difference between a
 * tree you can read and a tree you scroll. The first version stacked them: `src/athena`'s seven
 * children made a sheet 1132 wide and 3082 tall, the whole-sheet zoom fell to a third, and every
 * block name truncated to one letter and an ellipsis — the capture is unambiguous about it. Two
 * children per row puts the same tree at roughly the aspect of the other three views, and nesting
 * still reads as nesting because a child folder is a rectangle inside a rectangle whichever way
 * its siblings are arranged.
 */
function layFolder(node: TreeNode): Laid {
  const pack = packRows(node.blocks.map((id) => SIZE_BY_ID.get(id) ?? { w: DIM.blockW, h: DIM.headH }), 2);
  const kids = node.kids.map(layFolder);
  const kidPack = packRows(kids, kids.length > 4 ? 3 : 2, DIM.gapX, DIM.regionGap);
  const inner = Math.max(pack.w, kidPack.w, DIM.blockW);
  const bodyH = pack.h + (pack.h > 0 && kidPack.h > 0 ? DIM.regionGap : 0) + kidPack.h;
  const w = inner + DIM.regionPad * 2;
  const h = DIM.regionHead + DIM.regionPad * 2 + bodyH;

  return {
    w,
    h,
    emit(at, depth, index) {
      const blocks: BlockBox[] = [];
      const regions: RegionBox[] = [];
      const top = at.y + DIM.regionHead + DIM.regionPad;
      const left = at.x + DIM.regionPad;

      node.blocks.forEach((id, i) => {
        const p = pack.at[i]!;
        blocks.push(place(id, { x: left + (inner - pack.w) / 2 + p.x, y: top + p.y }));
      });

      const kidsTop = top + pack.h + (pack.h > 0 && kids.length > 0 ? DIM.regionGap : 0);
      kids.forEach((kid, i) => {
        const p = kidPack.at[i]!;
        const emitted = kid.emit(
          { x: left + (inner - kidPack.w) / 2 + p.x, y: kidsTop + p.y },
          depth + 1,
          index,
        );
        blocks.push(...emitted.blocks);
        regions.push(...emitted.regions);
      });

      regions.unshift({
        id: `pkg:${node.path}`,
        kind: "folder",
        name: node.seg,
        note: `${node.blocks.length} here${kids.length > 0 ? `, ${kids.length} inside` : ""}`,
        index: index.n++,
        depth,
        blocks: node.blocks,
        x: at.x,
        y: at.y,
        w,
        h,
      });
      return { blocks, regions };
    },
  };
}

function packagesPlan(): Plan {
  const top = tree().kids.map(layFolder);
  const spread = packRows(top, 2, DIM.gapX, DIM.regionGap);
  const blocks: BlockBox[] = [];
  const regions: RegionBox[] = [];
  const index = { n: 0 };
  top.forEach((folder, i) => {
    const p = spread.at[i]!;
    const out = folder.emit({ x: DIM.margin + p.x, y: DIM.margin + p.y }, 0, index);
    blocks.push(...out.blocks);
    regions.push(...out.regions);
  });
  const edges = runs(
    blocks,
    regions,
    SYSTEM_EDGES.map((e) => ({
      from: e.from,
      to: e.to,
      mode: "system" as const,
      weight: e.weight,
      label: "imports",
      short: weightMark(e.weight),
    })),
  );
  return assemble("packages", blocks, regions, edges);
}

/* --------------------------------------- the constant --------------------------------------- */

/** The four arrangements, computed once at module load. Nothing here depends on a viewport. */
export const PLANS: Readonly<Record<ViewId, Plan>> = {
  layers: layersPlan(),
  turn: turnPlan(),
  trust: trustPlan(),
  packages: packagesPlan(),
};

export const planOf = (view: ViewId): Plan => PLANS[view];

/**
 * ONE WORLD BOX FOR ALL FOUR VIEWS, and this is what makes the signature motion possible.
 *
 * Every plan's coordinates are centred on the world origin (`assemble`), so a block's position is
 * a `translate` from the middle of the sheet and nothing else. If the element carrying the camera
 * changed SIZE between views, its middle would move, and every block would jump by half the
 * difference on the frame the view changed — a jump no transition can hide, because width is not
 * a transform. So the element is as big as the biggest arrangement needs and never changes, and a
 * view switch is nineteen `translate`s and nothing else.
 */
export const WORLD: { w: number; h: number } = {
  w: Math.max(...VIEWS.map((v) => PLANS[v].bounds.w)),
  h: Math.max(...VIEWS.map((v) => PLANS[v].bounds.h)),
};

/* ---------------------------------------- the lookups ---------------------------------------- */

/** A block's absolute rect in a view. */
export function blockIn(view: ViewId, id: string): BlockBox | null {
  return PLANS[view].blocks.find((b) => b.id === id) ?? null;
}

/** A component's absolute rect in a view — its part rect, offset by its block's position. */
export function partIn(view: ViewId, id: string): Rect | null {
  for (const b of PLANS[view].blocks) {
    for (const p of b.parts) {
      if (p.id === id) return { x: b.x + p.x, y: b.y + p.y, w: p.w, h: p.h };
    }
  }
  return null;
}

/** Which region a block landed in. `packages` answers the innermost folder. */
export function regionOf(view: ViewId, block: string): RegionBox | null {
  let best: RegionBox | null = null;
  for (const r of PLANS[view].regions) {
    if (!r.blocks.includes(block)) continue;
    if (!best || r.depth > best.depth) best = r;
  }
  return best;
}

/** The centre of a layer's frame in a view — where `poseFor` stands to open it. */
export const frameCentre = (view: ViewId, layer: LayerId): Point =>
  centreOf(PLANS[view].frames[layer]);

/**
 * Component-level runs inside one open layer, plus a stub for every edge that leaves it.
 *
 * Derived rather than stored: it is one layer's worth of the 120 model edges, it is only ever
 * needed for the layer the reader has open, and storing all six per view would be four times the
 * whole edge list for a drawing that shows one sixth of it at a time.
 *
 * THE STUBS are round 3's carried-over gap ("atlas L1 stubs for edges leaving the stratum"): an
 * edge with one end in this layer and one end outside it is drawn as a short run off the block's
 * facing side, so the reader can see that the layer is not closed.
 */
export interface PartRun {
  id: string;
  from: string;
  to: string;
  kind: string;
  note: string;
  run: Run;
  /** `null` for a run inside the layer; the other end's layer for a stub. */
  leaves: string | null;
}

export function partRuns(
  view: ViewId,
  layer: LayerId,
  edges: readonly { from: string; to: string; kind: string; note: string }[],
): PartRun[] {
  const mine = new Set(
    COMPONENTS.filter((c) => systemById(c.system)?.layer === layer).map((c) => c.id),
  );
  const plan = PLANS[view];

  /* The near band's obstacles are the far band's plus the parts themselves: a component run that
     crosses another component's name is exactly the defect this round is about, one tier down. A
     part is SOFT, because the three columns inside a block leave no corridor at all and a run that
     refuses to cross one would have to leave the block to reach its neighbour. */
  const walls: Obstacle[] = wallsFor(plan.blocks, plan.regions);
  for (const b of plan.blocks) {
    for (const p of b.parts) {
      walls.push({ id: `part:${p.id}`, kind: "body", x: b.x + p.x, y: b.y + p.y, w: p.w, h: p.h });
    }
  }
  const router = new Router(
    walls,
    escapeOf(plan.blocks, plan.regions),
    corridorsOf(plan.blocks),
  );

  const out: PartRun[] = [];
  /* Deterministic: inside the layer first (the runs a reader is meant to follow), then the stubs,
     each group in the model's own order. */
  const inside = edges.filter((e) => mine.has(e.from) && mine.has(e.to));
  const leaving = edges.filter((e) => mine.has(e.from) !== mine.has(e.to));

  for (const e of inside) {
    const a = partIn(view, e.from);
    const b = partIn(view, e.to);
    if (!a || !b) continue;
    const routed = router.route(a, b, null);
    out.push({
      id: `${e.from}->${e.to}`,
      from: e.from,
      to: e.to,
      kind: e.kind,
      note: e.note,
      run: { points: routed.points, from: routed.from, to: routed.to, down: routed.down },
      leaves: null,
    });
  }

  for (const e of leaving) {
    const here = mine.has(e.from);
    const a = partIn(view, e.from);
    const b = partIn(view, e.to);
    if (!a || !b) continue;
    /* One end outside: draw the run anyway, from the part inside to the part outside. The
       stylesheet fades it out past the layer's frame, which is what a stub IS on a real sheet —
       a run that leaves the drawing and says which way it went. */
    const other = systemById(
      COMPONENTS.find((c) => c.id === (here ? e.to : e.from))?.system ?? "",
    )?.layer;
    const routed = router.route(here ? a : b, here ? b : a, null);
    out.push({
      id: `${e.from}->${e.to}`,
      from: e.from,
      to: e.to,
      kind: e.kind,
      note: e.note,
      run: { points: routed.points, from: routed.from, to: routed.to, down: routed.down },
      leaves: other ?? "elsewhere",
    });
  }

  return out;
}

/** What the sheet is made of, for the mast and the tests. */
export const PLAN_COUNTS = {
  blocks: SIZED.length,
  parts: SIZED.reduce((n, b) => n + b.parts.length, 0),
  views: VIEWS.length,
} as const;
