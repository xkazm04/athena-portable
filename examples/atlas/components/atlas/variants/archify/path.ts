/**
 * PATH — the route probe. Archify study §4: *"shortest directed path over authored edges, ties
 * stable by DOM order; never inferred from geometry."*
 *
 * The last clause is the whole rule. A map that answers "how does A reach B" by looking at the
 * lines it drew is answering a question about its own layout, and it will happily report a route
 * through two boxes that happen to be near each other. This walks `data/edges.ts` and nothing else:
 * if the model has no path, the probe says there is none, even when the drawing has a line that
 * looks like one.
 *
 * TIES ARE STABLE BECAUSE THE ADJACENCY IS BUILT IN EDGE-LIST ORDER and the queue is FIFO. Two
 * shortest routes of equal length always resolve to the one whose first differing hop appears
 * earlier in the authored list — which is archify's "stable by DOM order" with the authored order
 * standing in for the DOM, and it means the receipt a reader copies is the same one tomorrow.
 *
 * IT WORKS AT BOTH DISTANCES. At band 0 the nodes are systems, so the walk is over the DERIVED
 * system graph (built from the same edges, so a system hop cannot exist without a module that makes
 * it); from band 1 the nodes are the open layer's modules and the walk is over the module graph.
 * One function, one `adjacency` argument.
 */
import { COMPONENT_BY_ID, EDGES } from "@/data";

export interface Probe {
  from: string;
  to: string;
  /** The node ids in order, `from` first. Empty when the model has no route. */
  nodes: string[];
  /** Directed hops — one fewer than `nodes`, or 0. */
  hops: number;
  /** True when a route exists. False is an ANSWER, not an error. */
  found: boolean;
}

export type Adjacency = ReadonlyMap<string, readonly string[]>;

function build(pairs: readonly (readonly [string, string])[]): Adjacency {
  const out = new Map<string, string[]>();
  for (const [from, to] of pairs) {
    const bucket = out.get(from);
    if (bucket) {
      if (!bucket.includes(to)) bucket.push(to);
    } else out.set(from, [to]);
  }
  return out;
}

/** The module graph, in authored order. */
export const COMPONENT_GRAPH: Adjacency = build(EDGES.map((e) => [e.from, e.to] as const));

/** The system graph, derived from the same edges — never authored separately. */
export const SYSTEM_GRAPH: Adjacency = build(
  EDGES.map((e) => {
    const from = COMPONENT_BY_ID.get(e.from)?.system ?? e.from;
    const to = COMPONENT_BY_ID.get(e.to)?.system ?? e.to;
    return [from, to] as const;
  }).filter(([from, to]) => from !== to),
);

/** Breadth-first, FIFO, first-seen wins. Deterministic for a given adjacency. */
export function probe(graph: Adjacency, from: string, to: string): Probe {
  if (from === to) return { from, to, nodes: [from], hops: 0, found: true };

  const prev = new Map<string, string>();
  const seen = new Set<string>([from]);
  const queue: string[] = [from];

  while (queue.length > 0) {
    const here = queue.shift()!;
    for (const next of graph.get(here) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, here);
      if (next === to) {
        const nodes = [to];
        let walk = to;
        while (walk !== from) {
          walk = prev.get(walk)!;
          nodes.unshift(walk);
        }
        return { from, to, nodes, hops: nodes.length - 1, found: true };
      }
      queue.push(next);
    }
  }
  return { from, to, nodes: [], hops: 0, found: false };
}

/** The receipt line, in archify's wording. Says "authored" because that is the claim being made. */
export const receiptOf = (p: Probe): string =>
  p.found
    ? `${p.nodes.length} nodes · ${p.hops} directed hops · shortest authored route`
    : "no authored route — the model has no path this way";

/** The set of hop pairs a probe lights, for the overlay. */
export const hopsOf = (p: Probe): { from: string; to: string }[] =>
  p.nodes.slice(1).map((to, i) => ({ from: p.nodes[i]!, to }));
