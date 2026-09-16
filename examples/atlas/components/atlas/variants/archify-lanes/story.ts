/**
 * THE TURN IS THE DIAGRAM — the twelve stops of README §3.2 as a Story Trail over the lane grid.
 * Archify study §1 (`guidedViews`), §4 (`guided-views.js`), §7.11.
 *
 * WHAT THIS VARIANT TESTS. In round 4 and round 5 the turn was an OVERLAY on a static map: the
 * drawing said where things are, and a scrubber lit them in order. Here the drawing IS the turn —
 * the columns are its clock and the lanes are its owners — so the Story Trail has nothing left to
 * explain and only has to keep the reader's place. That is the whole claim, and the way to falsify
 * it is to look at how much the trail has to draw for itself: if the lane grid is really the turn,
 * almost every hop is already on the sheet as an authored edge.
 *
 * IT IS: EIGHT OF THE TEN DRAWN HOPS ARE AUTHORED EDGES. Round 5's sheet carried five of eleven.
 * The two that are not are the same finding stated more sharply: stop 7 → 8 reaches from the
 * catalog into the CONTRACTS, and stop 8 → 9 comes back out — a hop into a thing that has no
 * behaviour to put in a column, which `kinds.ts` already paints slate for exactly that reason. The
 * trail draws those two dotted and the chapter receipt counts them, because a story overlay that
 * quietly straightened that out would be the decorative version of this feature.
 *
 * THE SCRIPT AND THE CHAPTERS ARE REUSED, NOT RE-TYPED. `./script.ts` holds the twelve stops
 * read off README §3.2 and the four chapter cuts, both as pure data with the model-integrity test
 * already on them; this module maps them onto THIS drawing's twelve nodes and asks the one
 * question the archify sheet could not: does an edge of the lane grid carry this hop?
 */
import { BEATS, CHAPTERS, beatState, chapterOf, deltaOf, stopAt, type Beat } from "./script";

import { EDGES, nodeById, nodeOfSystem, type Role } from "./workflow";

export { BEATS, beatState, chapterOf, deltaOf, stopAt };
export type { Beat };

/** Which node each stop happens in — derived from the stop's system, never typed twice. */
export const NODE_OF_STOP: readonly string[] = BEATS.map(
  (b) => nodeOfSystem(b.system) ?? "lane",
);

export const nodeAt = (stop: number): string =>
  NODE_OF_STOP[Math.min(NODE_OF_STOP.length - 1, Math.max(0, stop))] ?? "lane";

/** Every authored edge, by its ordered pair — how a hop finds out whether the grid carries it. */
const BY_PAIR = new Map(EDGES.map((e) => [`${e.from}->${e.to}`, e]));

export interface Hop {
  /** The index of the stop this hop ARRIVES at, so it lights with that beat. */
  index: number;
  from: string;
  to: string;
  /** The authored edge that carries it, when the grid has one. */
  edge: string | null;
  role: Role | null;
}

/**
 * The ten drawn hops: eleven stop-to-stop transitions minus the one that stays inside a node.
 *
 * Stop 9 → 10 is the approval row becoming the ledger row, and both tables are the same node — a
 * merge `workflow.ts` makes because `data/systems.ts` says the record's tables live in the brain's
 * own index. A hop with no distance is not drawn; the beat still fires, on the same box.
 */
export const HOPS: readonly Hop[] = BEATS.slice(1)
  .map((_, i) => {
    const from = nodeAt(i);
    const to = nodeAt(i + 1);
    const edge = BY_PAIR.get(`${from}->${to}`);
    return { index: i + 1, from, to, edge: edge?.id ?? null, role: edge?.role ?? null };
  })
  .filter((h) => h.from !== h.to);

export const TRAIL_COUNTS = {
  stops: BEATS.length,
  hops: HOPS.length,
  authored: HOPS.filter((h) => h.edge !== null).length,
  derived: HOPS.filter((h) => h.edge === null).length,
  /** Stop-to-stop transitions that never leave one box, because a merge absorbed them. */
  internal: BEATS.length - 1 - HOPS.length,
};

/** The nodes one chapter lights — archify's `focus: [nodeId]`, on this drawing's nodes. */
export const CHAPTER_FOCUS: readonly (readonly string[])[] = CHAPTERS.map((c) => [
  ...new Set(c.beats.map((b) => nodeAt(b.index))),
]);

export interface ChapterView {
  id: string;
  label: string;
  note: string;
  from: number;
  to: number;
  focus: readonly string[];
}

export const CHAPTER_VIEWS: readonly ChapterView[] = CHAPTERS.map((c, i) => ({
  id: c.id,
  label: c.label,
  note: c.note,
  from: c.beats[0]!.index,
  to: c.beats[c.beats.length - 1]!.index,
  focus: CHAPTER_FOCUS[i] ?? [],
}));

/** The label a beat prints, and the node it stands on. */
export interface BeatView extends Beat {
  node: string;
  nodeLabel: string;
}

export const BEAT_VIEWS: readonly BeatView[] = BEATS.map((b, i) => {
  const node = nodeAt(i);
  return { ...b, node, nodeLabel: nodeById(node)?.label ?? node };
});
