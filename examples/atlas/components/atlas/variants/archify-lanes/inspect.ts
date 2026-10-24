/**
 * A RUN YOU CAN OPEN — what pressing one of the fourteen runs answers.
 *
 * Every run of this sheet is a claim, and `workflow.ts` authors each with a sentence (`note`) and
 * a source (`cite`). Until this module nothing read either: the runs were aria-hidden geometry on
 * a plate that took no pointer events. Here a run becomes something a reader can question where it
 * is drawn — its role, its two ends, the note, the README section it cites, and which of the
 * turn's twelve stops travel it. canvas-graph/edge-management: hit-test a fat invisible stroke and
 * hang the context off the selection; canvas-accessibility: expose the graph, not the geometry.
 *
 * Pure and `.ts` for the reason `turn.ts` is: `node --test` does not read JSX, so every rule that
 * can be wrong lives here and `test/lanes.inspect.test.ts` reaches it. Nothing is re-typed: the
 * ends come from the nodes, the role words from `ROLE_LABEL`, and the stops from the story's
 * `HOPS`, so the one main run the script never walks (`e-approval`: the turn goes catalog ->
 * contracts -> record) says so instead of staying silent.
 */
import { HOPS } from "./story";
import { EDGES, EDGE_BY_ID, ROLE_LABEL, nodeById, type Role } from "./workflow";

export interface RunReadout {
  id: string;
  role: Role;
  roleLabel: string;
  label: string;
  from: string;
  to: string;
  note: string;
  cite: string;
  /** The 1-based turn stops whose hop travels this run, in story order. */
  stops: number[];
  /** Whether any stop of the turn travels this run at all. */
  walked: boolean;
}

/** The readout for one run, or null for an id this drawing does not have. */
export function runReadout(id: string): RunReadout | null {
  const e = EDGE_BY_ID.get(id);
  if (!e) return null;
  const stops = HOPS.filter((h) => h.edge === id).map((h) => h.index + 1);
  return {
    id: e.id,
    role: e.role,
    roleLabel: ROLE_LABEL[e.role],
    label: e.label,
    from: nodeById(e.from)?.label ?? e.from,
    to: nodeById(e.to)?.label ?? e.to,
    note: e.note,
    cite: e.cite,
    stops,
    walked: stops.length > 0,
  };
}

/** The runs a node sends or receives, in `EDGES` declaration order. */
export const runsTouching = (node: string): string[] =>
  EDGES.filter((e) => e.from === node || e.to === node).map((e) => e.id);

/**
 * The next run of a node's runs in direction `dir`, wrapping. A current run that does not touch
 * the node (or none) starts the cycle at the first run going forward, the last going back.
 */
export function cycleRun(node: string, current: string | null, dir: 1 | -1): string | null {
  const runs = runsTouching(node);
  if (runs.length === 0) return null;
  const at = current === null ? -1 : runs.indexOf(current);
  if (at === -1) return dir > 0 ? runs[0]! : runs[runs.length - 1]!;
  return runs[(at + dir + runs.length) % runs.length]!;
}

/**
 * What a key does to the open run: '[' and ']' rove the focused node's runs, Escape closes the
 * open one. `undefined` means the key is not this module's, so the caller lets it through.
 */
export function runKey(
  key: string,
  node: string | null,
  current: string | null,
): string | null | undefined {
  if (key === "Escape") return current === null ? undefined : null;
  if ((key === "[" || key === "]") && node !== null) {
    return cycleRun(node, current, key === "]" ? 1 : -1);
  }
  return undefined;
}

/**
 * Opening a run. With the story on, the story jumps to the first stop the run carries, as a
 * 0-based stop; a run no stop travels, or the story off, leaves the stop where it was.
 */
export function selectRun(
  state: { story: boolean; stop: number },
  id: string,
): { run: string; stop: number } {
  const first = runReadout(id)?.stops[0];
  return { run: id, stop: state.story && first !== undefined ? first - 1 : state.stop };
}
