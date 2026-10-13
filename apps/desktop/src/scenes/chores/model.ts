/**
 * The Chores scene's small pure helpers — README section 3.5, ADR 0040, 0053, 0087 and 0090.
 *
 * The behaviour lives in the Playbooks module's own model (`modules/playbooks/model.ts`): the
 * verdicts, the map's layout, the arrangement, the facets, the replay's reductions. This file adds
 * only what a depth scene needs on top: reading a place (`Path`) into a chore and a turn, the
 * words the marquee shows for the thing under attention, and the sizes of the map's marks. Pure,
 * so each is tested without a DOM.
 */
import type { ChoreArtFacts } from "@/art/chore";
import type { Path } from "@/depth/model";
import { usd } from "@/lib/playbooks";
import type { PlaybookView, PlaybooksModel } from "@/modules/playbooks/model";

/** Said once under the header and again on every bench glance: the portals were invented. */
export const SIMULATED_LINE = "Measured once on an invented portal world, not on your accounts.";

export const SORT_NOTES = {
  edge: "Hardest for anyone else and most useful first.",
  money: "Most money a year first.",
  time: "Most hours by hand first.",
} as const;

/** The chore a place names, or `null` for the field and for an id this build does not ship. */
export function choreAt(model: PlaybooksModel, path: Path): PlaybookView | null {
  if (path.item === undefined) return null;
  return model.items.find((v) => v.id === path.item) ?? null;
}

/**
 * The replay's turn named by a place: 0-based, from a 1-based number in the path (a person reads
 * "turn 3"). `null` when the place is not a replay or the number is not a whole turn of this run.
 */
export function turnAt(path: Path, turns: number): number | null {
  if (path.sub?.kind !== "run") return null;
  const raw = path.sub.arg ?? "";
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= turns ? n - 1 : null;
}

/** The place of a replay at a 0-based turn. */
export const runPath = (id: string, turn: number): Path => ({
  root: "chores",
  item: id,
  sub: { kind: "run", arg: String(turn + 1) },
});

export const chorePath = (id: string): Path => ({ root: "chores", item: id });

/** What the marquee says for a chore under attention: its domain, its name, one honest line. */
export function marqueeOf(view: PlaybookView): { eyebrow: string; title: string; line: string } {
  const p = view.playbook;
  return {
    eyebrow: p.domain || "Chore",
    title: view.title,
    line: `${view.verdict.label}. ${view.value} ${view.per}, author's estimate. ${p.apps.length} ${p.apps.length === 1 ? "portal" : "portals"}.`,
  };
}

/** The mark's diameter in px, from the chore's value: smaller when the map holds many marks. */
export function markSize(weight: number, many: boolean): number {
  return many ? 12 + 11 * weight : 26 + 22 * weight;
}

/** A cell of the 5 by 5 scale holding more than this many chores is spread as a sunflower, not a ring. */
const RING_MAX = 8;
const GOLDEN = 2.399963229728653;

/**
 * Where each chore's mark sits. The module's own layout rings the chores that share a cell, which
 * is right for a few and a tangle for thirty; a crowded cell is spread over a disc (a sunflower
 * spiral, an even spacing whatever the count) of 0.46 of a step. Pure and stable: the same
 * chores give the same points.
 */
export function markPoints(items: readonly PlaybookView[]): { x: number; y: number }[] {
  const cells = new Map<string, number[]>();
  items.forEach((v, i) => {
    const k = `${v.playbook.edge.difficulty}:${v.playbook.edge.usefulness}`;
    cells.set(k, [...(cells.get(k) ?? []), i]);
  });
  return items.map((v, i) => {
    const members = cells.get(`${v.playbook.edge.difficulty}:${v.playbook.edge.usefulness}`) ?? [i];
    if (members.length <= RING_MAX) return { x: v.point.x, y: v.point.y };
    const k = members.indexOf(i);
    const r = 0.46 * Math.sqrt((k + 0.5) / members.length);
    const a = k * GOLDEN;
    return {
      x: v.playbook.edge.difficulty + r * Math.cos(a),
      y: v.playbook.edge.usefulness + r * Math.sin(a),
    };
  });
}

/** Past this many chores the map drops the number inside each mark: they would not fit. */
export const NUMBERED_MARKS = 24;

/** A mark's place on the map in percent of its frame, on a scale that runs half a step past 1 and 5. */
const LO = 0.5;
const HI = 5.5;
export const pct = (v: number): number => ((v - LO) / (HI - LO)) * 100;

/** The corner the cycles push into: hard for anyone else and worth real money (`onTheEdge` is >= 4). */
export const EDGE_FROM = 3.5;

/** What a chore's mark is read as, in words, for a screen reader. */
export function markLabel(view: PlaybookView): string {
  return `${view.title}: ${view.value} ${view.per}, ${view.verdict.label}${view.onEdge ? ", on the edge" : ""}`;
}

/** The facts a chore's drawing is made from (`art/chore.tsx`): its own, nothing borrowed. */
export function artFor(view: PlaybookView): ChoreArtFacts {
  const p = view.playbook;
  return {
    id: p.id,
    portals: p.apps.length,
    gates: p.gates.length,
    traps: p.bench?.trapsTotal || p.traps.length,
    audience: p.audience,
    weight: view.point.weight,
    verdict: view.verdict.word,
  };
}

/** "$X of $Y found", or "" when nothing is benched. */
export function foundLine(model: PlaybooksModel): string {
  const t = model.totals;
  return t.availableUsd ? `${usd(t.foundUsd)} of ${usd(t.availableUsd)} found` : "";
}

/** The first sentence of a paragraph, for a line that must stay one line. */
export function firstSentence(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text.trim());
  return m ? m[1]! : text.trim();
}

/** "A store shipping…" read mid-sentence: "a store shipping…". An acronym ("SaaS", "EU") stays. */
export function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}
