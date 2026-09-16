/**
 * THE PLAN: the fourteen runs, routed once.
 *
 * `sheet.ts` decides WHICH lines exist (the abstraction); `routing.ts` decides where they go (the
 * study's generate-and-rank router with the complete lattice fallback). This module is the seam
 * between them, and it exists so that the route pass runs exactly once per module load rather than
 * once per render — the drawing is authored, so its geometry is a constant.
 *
 * THE ONE THING IT DOES BEYOND CALLING THE ROUTER: it puts the emphasis on the spine. Archify's
 * `maka` example marks 8 of 12 connections `emphasis` (study part 2 §2); round 5 marked none, which
 * is why the round-5 frame has no path a reader's eye can follow. Here the ten hops of README
 * §3.2's turn are `emphasis` — 1.8 units in `--arrow-emphasis` — and the four relationships that
 * earned a line on weight are `default`, `security` (a gate) or `dashed` (something unbuilt).
 */
import { BOXES, RUNS, WORLD, type Rect } from "./sheet";
import {
  buildLattice,
  labelFor,
  latticeRoute,
  routeAll,
  segmentsOf,
  type Point,
  type Run,
  type RunStyle,
  type RouteInput,
} from "./routing";

const BOX_RECTS: ReadonlyMap<string, Rect> = new Map(
  BOXES.map((b) => [b.id, { x: b.x, y: b.y, w: b.w, h: b.h }]),
);

const FRAME: Rect = { x: 0, y: 0, w: WORLD.w, h: WORLD.h };

const inputs: RouteInput[] = RUNS.map((r) => ({
  id: r.id,
  from: r.from,
  to: r.to,
  kind: r.kind,
  label: r.label,
  status: r.status,
}));

const routed = routeAll(BOX_RECTS, inputs, FRAME);

const styleOverride = new Map<string, RunStyle>(
  RUNS.filter((r) => r.emphasis).map((r) => [r.id, "emphasis" as RunStyle]),
);

/**
 * THE ONE REPAIR THE FIXED WORLD NEEDS, and it is study part 2 §4 applied to the router.
 *
 * Two of archify's nine candidate families — `outside-left` and `outside-right` — route through a
 * channel BESIDE the drawing, and archify can afford them because its canvas grows to fit whatever
 * the route needs. This variant's whole claim is that the canvas does not grow: the world is
 * authored at 1140 × 680 so that it fills the reading column at scale 1, and a run at x = −278 is
 * a run nobody can see. Archify's own contract says the same thing about overflow — "repair it by
 * removing content, never with overflow hidden, a scroller or smaller type".
 *
 * So a winning route that leaves the sheet is refused and sent to the lattice, which is confined to
 * the free lanes BETWEEN the boxes and is complete, so a route exists there whenever one exists at
 * all. The label is then re-placed against every other label — archify's repair order exactly: move
 * the label, adjust the route, shorten the wording, never delete the label.
 */
const inWorld = (points: readonly Point[]): boolean =>
  points.every((p) => p.x >= 0 && p.x <= WORLD.w && p.y >= 0 && p.y <= WORLD.h);

const lattice = buildLattice(BOX_RECTS);

/**
 * A RUN IS AN OBSTACLE FOR A LABEL, and the lattice is the reason this has to be said twice.
 *
 * `routeAll` makes every label an obstacle for every later ROUTE, which is archify §7.7. It cannot
 * make every route an obstacle for every later LABEL, because the routes after it do not exist yet
 * — and the lattice fallback, which is complete over the boxes, knows nothing about labels at all.
 * The visible result was "3 compose" struck through by the run beneath it. So the second pass runs
 * with every route already placed, and each label is slid along its own longest segment until it
 * clears the other runs as well as the boxes: move the label, then the route, then the wording.
 */
const asObstacles = (run: Run, all: readonly Run[]): Rect[] => {
  const out: Rect[] = [];
  const pad = 3;
  for (const other of all) {
    if (other.id === run.id) continue;
    for (const seg of segmentsOf(other.points)) {
      out.push({
        x: Math.min(seg.a.x, seg.b.x) - pad,
        y: Math.min(seg.a.y, seg.b.y) - pad,
        w: Math.abs(seg.b.x - seg.a.x) + pad * 2,
        h: Math.abs(seg.b.y - seg.a.y) + pad * 2,
      });
    }
  }
  return out;
};

function keepOnTheSheet(runs: readonly Run[]): { runs: Run[]; repaired: string[] } {
  const routed: Run[] = [];
  const repaired: string[] = [];

  for (const run of runs) {
    if (inWorld(run.points)) {
      routed.push(run);
      continue;
    }
    const a = BOX_RECTS.get(run.from);
    const b = BOX_RECTS.get(run.to);
    const lane = a && b ? latticeRoute(lattice, run.from, run.to, a, b) : null;
    if (lane && inWorld(lane.points)) {
      repaired.push(run.id);
      routed.push({ ...run, points: lane.points, sides: lane.sides, family: "lattice/on-sheet" });
    } else routed.push(run);
  }

  const boxes = [...BOX_RECTS.values()];
  const labels: Rect[] = [];
  const out = routed.map((run) => {
    const label = labelFor(run.label.text, run.points, [
      ...labels,
      ...boxes,
      ...asObstacles(run, routed),
    ]);
    labels.push(label);
    return { ...run, label };
  });
  return { runs: out, repaired };
}

const kept = keepOnTheSheet(routed.runs);

/** Runs whose winning family left the sheet and were sent back to the lattice. Reported, not hidden. */
export const REPAIRED: readonly string[] = kept.repaired;

/** The runs, drawn. Deterministic: the router's own ordering is the authored list's. */
export const PLAN_RUNS: readonly Run[] = kept.runs.map((run) => {
  const style = styleOverride.get(run.id);
  return style ? { ...run, style } : run;
});

/** How many runs no candidate family could carry and the lattice had to. Reported, never hidden. */
export const LATTICED = routed.latticed;
/** Runs nothing could carry. Must be zero; `test/density.routing.test.ts` says so. */
export const DROPPED: readonly string[] = routed.dropped;

export const RUN_BY_ID: ReadonlyMap<string, Run> = new Map(PLAN_RUNS.map((r) => [r.id, r]));

/** Every run touching a node — the one-hop preview, and the passport's own relationship list. */
export function runsTouching(nodeId: string): readonly Run[] {
  return PLAN_RUNS.filter((r) => r.from === nodeId || r.to === nodeId);
}
