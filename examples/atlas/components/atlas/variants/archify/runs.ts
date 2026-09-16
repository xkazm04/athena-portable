/**
 * WHICH RUNS EXIST AT WHICH DISTANCE — the band's half of semantic zoom (archify study §4).
 *
 * The IR has no recursive containment: there are component edges and nothing else (`data/edges.ts`
 * is explicit that system edges are DERIVED so "a system edge cannot exist without a module that
 * makes it"). Level of detail is therefore a viewer concern, exactly as it is in archify, and this
 * module is that concern written down:
 *
 *   BAND 0 — nineteen system nodes, and one run per ordered pair of systems that any module edge
 *            crosses. The label is the dominant relationship and the count: `calls ×4`. Nothing is
 *            invented; the count IS the evidence, and it is the number the L2 pane can be checked
 *            against.
 *   BAND 1+ — the open layer's systems are opened: their components become the nodes and the
 *            module edges between them become the runs. An edge that LEAVES the layer is not
 *            dropped (dropping it would make the layer look self-contained, which is the single
 *            most misleading thing a layered drawing can do) — it runs from the module to the
 *            SYSTEM NODE it reaches, which is still on the sheet, one row up or down.
 *
 * One box map, one edge list, one router, both times. The router (`routing.ts`) never learns which
 * band it is in, which is what keeps "no run crosses a node" true at every distance rather than in
 * the case that was tested.
 */
import {
  COMPONENT_BY_ID,
  EDGES,
  SYSTEM_BY_ID,
  componentsOf,
  systemsOf,
  type Edge,
  type EdgeKind,
  type LayerId,
  type Status,
} from "@/data";

import type { Rect } from "./layout";
import { PLANS, type ViewId } from "./layout";
import { routeAll, type RouteInput, type RouteResult } from "./routing";

/** The relationship word a run prints. Our five kinds, in the order a tie is broken. */
const KIND_RANK: readonly EdgeKind[] = ["gates", "streams", "implements", "calls", "reads"];

const worstStatus = (a: Status, b: Status): Status =>
  a === "planned" || b === "planned" ? "planned" : a === "partial" || b === "partial" ? "partial" : "built";

const systemOf = (componentId: string): string | undefined => COMPONENT_BY_ID.get(componentId)?.system;

/* --------------------------------------- band 0: systems ------------------------------------- */

interface Tally {
  from: string;
  to: string;
  kinds: Map<EdgeKind, number>;
  status: Status;
}

function systemEdges(): RouteInput[] {
  const seen = new Map<string, Tally>();
  for (const e of EDGES) {
    const from = systemOf(e.from);
    const to = systemOf(e.to);
    if (!from || !to || from === to) continue;
    const key = `${from}->${to}`;
    const hit = seen.get(key);
    const status = worstStatus(
      COMPONENT_BY_ID.get(e.from)?.status ?? "built",
      COMPONENT_BY_ID.get(e.to)?.status ?? "built",
    );
    if (hit) {
      hit.kinds.set(e.kind, (hit.kinds.get(e.kind) ?? 0) + 1);
      hit.status = worstStatus(hit.status, status);
    } else {
      seen.set(key, { from, to, kinds: new Map([[e.kind, 1]]), status });
    }
  }

  return [...seen.values()].map((t) => {
    let dominant: EdgeKind = "calls";
    let best = -1;
    for (const kind of KIND_RANK) {
      const n = t.kinds.get(kind) ?? 0;
      if (n > best) {
        best = n;
        dominant = kind;
      }
    }
    const total = [...t.kinds.values()].reduce((a, b) => a + b, 0);
    return {
      id: `${t.from}->${t.to}`,
      from: t.from,
      to: t.to,
      kind: dominant,
      label: total > 1 ? `${dominant} ×${total}` : dominant,
      status: t.status,
    };
  });
}

export const SYSTEM_RUN_INPUTS: readonly RouteInput[] = systemEdges();

/* ------------------------------------ band 1+: one layer open -------------------------------- */

/**
 * The open layer's own edges, plus every edge that crosses its border, with the far end collapsed
 * onto the system node it belongs to.
 */
function layerEdges(layer: LayerId): RouteInput[] {
  const inside = new Set(systemsOf(layer).map((s) => s.id));
  const out: RouteInput[] = [];
  const seen = new Set<string>();

  const endpoint = (componentId: string): string | null => {
    const system = systemOf(componentId);
    if (!system) return null;
    return inside.has(system) ? componentId : system;
  };

  for (const e of EDGES as readonly Edge[]) {
    const fromSystem = systemOf(e.from);
    const toSystem = systemOf(e.to);
    if (!fromSystem || !toSystem) continue;
    if (!inside.has(fromSystem) && !inside.has(toSystem)) continue;

    const from = endpoint(e.from);
    const to = endpoint(e.to);
    if (!from || !to || from === to) continue;
    const id = `${from}->${to}`;
    if (seen.has(id)) continue;
    seen.add(id);

    out.push({
      id,
      from,
      to,
      kind: e.kind,
      label: e.kind,
      status: worstStatus(
        COMPONENT_BY_ID.get(e.from)?.status ?? "built",
        COMPONENT_BY_ID.get(e.to)?.status ?? "built",
      ),
    });
  }
  return out;
}

/* --------------------------------------- the routed sheets ----------------------------------- */

const cache = new Map<string, RouteResult>();

/**
 * The runs for a view and an open layer. Memoised: routing is a generate-and-rank pass over every
 * edge and it must not run on a render.
 */
export function runsFor(view: ViewId, open: LayerId | null): RouteResult {
  const key = `${view}:${open ?? "-"}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const plan = PLANS[view];
  const boxes = new Map<string, Rect>();
  let inputs: readonly RouteInput[];

  if (open === null) {
    for (const n of plan.nodes) boxes.set(n.id, n);
    inputs = SYSTEM_RUN_INPUTS;
  } else {
    for (const n of plan.nodes) {
      if (n.layer === open) for (const p of n.parts) boxes.set(p.id, p);
      else boxes.set(n.id, n);
    }
    inputs = layerEdges(open);
  }

  const result = routeAll(boxes, inputs, plan.bounds);
  cache.set(key, result);
  return result;
}

/** What the L1 pass draws over: the system nodes whose insides are open. */
export const openParts = (view: ViewId, layer: LayerId): string[] =>
  PLANS[view].nodes.filter((n) => n.layer === layer).flatMap((n) => n.parts.map((p) => p.id));

/** For the tests and the tools: how many components the model has that this sheet did not place. */
export const unplaced = (view: ViewId): string[] => {
  const placed = new Set(PLANS[view].nodes.flatMap((n) => n.parts.map((p) => p.id)));
  return [...COMPONENT_BY_ID.keys()].filter((id) => !placed.has(id));
};

export const systemName = (id: string): string => SYSTEM_BY_ID.get(id)?.name ?? id;

export const componentsIn = (layer: LayerId): string[] =>
  systemsOf(layer).flatMap((s) => componentsOf(s.id).map((c) => c.id));
