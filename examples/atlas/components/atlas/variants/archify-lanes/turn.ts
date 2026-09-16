/**
 * WHAT `read_turn` ANSWERS — the turn, as THIS drawing draws it.
 *
 * It is a pure module beside the hook that registers it, for one reason that is not taste:
 * `node --test` strips TypeScript and does not understand JSX, so a rule that can be wrong has to
 * be reachable from a `.ts` file. `test/lanes.poses.test.ts` calls this directly.
 *
 * WHAT IT SAYS THAT ROUND 5'S DID NOT. Three things, each a property of the lane grid rather than
 * of the turn: which LANE and which PHASE a stop happens in (so an agent can ask for a phase and
 * get a level change), which NODE it stands on after nineteen systems were folded into twelve
 * boxes, and — the one worth having — whether an authored RUN OF THIS DRAWING carries the hop into
 * the stop, and in which role. The archify variant could say whether `data/edges.ts` carried a
 * hop; this says whether the drawing does, which is the claim a reader can check by looking.
 */
import { bounded } from "@athena/demo-kit/webmcp";

import { componentById } from "@/data";
import { READ_CAP } from "@/lib/constants";

import { planOf } from "./geometry";
import { BEAT_VIEWS, CHAPTER_VIEWS, HOPS, TRAIL_COUNTS, beatState, chapterOf } from "./story";
import { EDGE_BY_ID, LANES, PHASES } from "./workflow";

const GATE_STOP = BEAT_VIEWS.findIndex((b) => b.kind === "gate");
const WAIT_STOP = BEAT_VIEWS.findIndex((b) => b.kind === "wait");

const HOP_INTO = new Map(HOPS.map((h) => [h.index, h]));

/** The turn, as an agent reads it. Bounded like every list in this repository, and it says so. */
export function turnRead(at: number, telling: boolean, playing: boolean) {
  const plan = planOf(null);
  const cut = bounded(BEAT_VIEWS, READ_CAP, (b: (typeof BEAT_VIEWS)[number]) => {
    const boxed = plan.byId.get(b.node);
    const hop = HOP_INTO.get(b.index);
    return {
      stop: b.index + 1,
      label: b.label,
      kind: b.kind,
      component: b.part,
      system: b.system,
      file: componentById(b.part)?.file ?? null,
      source: b.cite,
      node: b.node,
      nodeLabel: b.nodeLabel,
      lane: boxed?.lane ?? null,
      col: boxed?.col ?? null,
      phase: boxed?.phase ?? null,
      waitsHere: b.kind === "wait",
      /* The hop INTO this stop: which run of THIS drawing carries it, and in what role. */
      hopEdge: b.index === 0 ? null : (hop?.edge ?? null),
      hopRole: b.index === 0 ? null : (hop?.role ?? null),
      hopDrawn: b.index === 0 ? null : hop ? "a run" : "inside one node",
      chapter: CHAPTER_VIEWS[chapterOf(b.index)]?.id ?? null,
      beat: telling ? beatState(b.index, at) : null,
    };
  });

  const here = BEAT_VIEWS[at];
  return {
    ...cut,
    footer: `(showing ${cut.showing} of ${cut.of})`,
    at: at + 1,
    of: BEAT_VIEWS.length,
    here: here?.label ?? null,
    hereNode: here?.node ?? null,
    herePhase: here ? (plan.byId.get(here.node)?.phase ?? null) : null,
    gate: GATE_STOP + 1,
    waits: WAIT_STOP + 1,
    lanes: LANES.map((l) => ({ id: l.id, label: l.label, variant: l.variant, note: l.note })),
    phases: PHASES.map((p) => ({
      id: p.id,
      label: p.label,
      cols: [p.fromCol, p.toCol],
      variant: p.variant,
      note: p.note,
      nodes: plan.nodes.filter((n) => n.phase === p.id).map((n) => n.id),
    })),
    chapters: CHAPTER_VIEWS.map((c, i) => ({
      id: c.id,
      label: c.label,
      note: c.note,
      from: c.from + 1,
      to: c.to + 1,
      nodes: c.focus,
      current: i === chapterOf(at),
    })),
    hops: TRAIL_COUNTS,
    edges: HOPS.filter((h) => h.edge !== null).map((h) => ({
      hop: h.index,
      edge: h.edge,
      role: h.role,
      label: EDGE_BY_ID.get(h.edge!)?.label ?? null,
    })),
    telling,
    playing,
    note: "The drawing IS the turn: a node's lane says who owns the step and its column says when it happens, so the twelve stops read left to right down the stack with no overlay. Eight of the ten drawn hops are runs of this drawing; two are asserted by README alone and the Story Trail draws those dotted. Opening a phase (set_level group=arrive|compose|record) is the L1 move. set_turn moves the step; set_variant reads which drawing is mounted.",
  };
}

