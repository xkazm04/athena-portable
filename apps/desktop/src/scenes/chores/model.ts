/**
 * The Chores scene's small pure helpers — README section 3.5, ADR 0040, 0053, 0087, 0090 and 0096.
 *
 * The behaviour lives in the Playbooks module's own model (`modules/playbooks/model.ts`): the
 * verdicts, the map's layout, the ledger's filter and orders, the facets, the replay's reductions.
 * This file adds only what a depth scene needs on top: reading a place (`Path`) into a chore and a
 * turn, the sizes of the map's marks, and the ledger's words — the sentence an empty filter says,
 * the way a column's head cycles the order, and what the preview's blueprint and its
 * before-and-after band are drawn from. Pure, so each is tested without a DOM.
 */
import type { ChoreArtFacts } from "@/art/chore";
import type { Path } from "@/depth/model";
import { minutes, usd } from "@/lib/playbooks";
import { categoryLabel, jobLabel } from "@/lib/playbook-taxonomy";
import {
  annualValue,
  type LedgerFilter,
  type LedgerSort,
  type PlaybookView,
  type PlaybooksModel,
} from "@/modules/playbooks/model";

/** Said once under the header and again on every bench glance: the portals were invented. */
export const SIMULATED_LINE = "Measured once on an invented portal world, not on your accounts.";

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

/** The first sentence of a paragraph, for a line that must stay one line. */
export function firstSentence(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text.trim());
  return m ? m[1]! : text.trim();
}

/** "A store shipping…" read mid-sentence: "a store shipping…". An acronym ("SaaS", "EU") stays. */
export function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

// -- the ledger (ADR 0096) -------------------------------------------------------------------------

/**
 * The field's width, in px of its own box, at which the ledger keeps its preview beside it. Under
 * it the preview is not drawn and picking a row opens the chore. The stylesheet's container query
 * spells the same number; `chores.css.test.ts` holds the two together.
 */
export const LEDGER_WIDE = 1100;

/** The ledger's order before anyone presses a head: the edge, best first, which is the map's. */
export const EDGE_ORDER: LedgerSort = { key: "edge", dir: "asc" };

/**
 * The order after a press on a column's head. A new column starts with its most first (the most
 * money, the most hours); a second press turns it round; a third gives the edge's order back, so
 * the default is never more than three presses away and needs no column of its own.
 */
export function nextSort(current: LedgerSort, key: "value" | "time"): LedgerSort {
  if (current.key !== key) return { key, dir: "desc" };
  return current.dir === "desc" ? { key, dir: "asc" } : EDGE_ORDER;
}

/** The sentence a filter that leaves no playbook says: which area and which job, by name. */
export function emptyLine(f: LedgerFilter): string {
  if (f.category === "all" && f.job === "all") return "No playbook in this build.";
  const area = f.category === "all" ? "any area" : categoryLabel(f.category);
  const job = f.job === "all" ? "" : ` whose job is to ${jobLabel(f.job).toLowerCase()}`;
  return `No playbook in ${area}${job}.`;
}

/** The row the preview shows: the one picked while the filters still show it, else the first. */
export function pickedRow(rows: readonly PlaybookView[], id: string | null): PlaybookView | null {
  return rows.find((v) => v.id === id) ?? rows[0] ?? null;
}

/** A row's value on the year's scale where it has one, in its own unit ("a claim") where not. */
export function valueCell(view: PlaybookView): { figure: string; per: string } {
  const yearly = ["year", "month", "week"].includes(view.playbook.economics.per);
  return { figure: usd(annualValue(view.playbook)), per: yearly ? "a year" : view.per };
}

/** The one line a long sentence must fit: its first clause, cut at a word near `max` characters. */
export function shortLine(text: string, max = 96): string {
  const t = text.trim();
  const clause = /^(.+?)[.;:(]/.exec(t)?.[1]?.trim() ?? t;
  if (clause.length <= max) return clause;
  const cut = clause.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,\s]+$/, "")}…`;
}

/** The compact line over the ledger: how many, how many beat their bar, what the bench found. */
export function totalsLine(model: PlaybooksModel): string {
  const t = model.totals;
  return [
    `${t.count} ${t.count === 1 ? "playbook" : "playbooks"}`,
    t.benched ? `${t.exceeds} of ${t.benched} benched exceed the bar` : "none benched yet",
    t.foundUsd ? `${usd(t.foundUsd)} found on the bench` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Past this many the blueprint says "and N more" rather than growing: six steps, five portals and
 * four gates keep the plan inside the pane's first screen for all but a handful of playbooks, and
 * the full lists are one press away in the chore.
 */
export const SPINE_STEPS = 6;
export const PLAN_PORTALS = 5;
export const PLAN_GATES = 4;

/** What the preview's blueprint draws, from the playbook and its bench alone: nothing invented. */
export interface Blueprint {
  portals: { name: string; role: string }[];
  /** The portals, steps and gates the plan does not draw. */
  morePortals: number;
  steps: string[];
  more: number;
  gates: { label: string; why: string }[];
  moreGates: number;
  /** The traps the latest run walked past, of how many; `null` when there is no run to count. */
  guard: { avoided: number; of: number } | null;
  /** The flow's end: what she filed on the bench, or the bar it will be held to when unbenched. */
  result: { figure: string; line: string; measured: boolean };
}

export function blueprintOf(view: PlaybookView): Blueprint {
  const p = view.playbook;
  const b = p.bench;
  const ledger = b?.trapLedger ?? [];
  const of = ledger.length || b?.trapsTotal || 0;
  const avoided = ledger.length ? ledger.filter((t) => !t.filed).length : of - (b?.trapsFiled ?? 0);
  return {
    portals: p.apps.slice(0, PLAN_PORTALS).map((a) => ({ name: a.name, role: a.role })),
    morePortals: Math.max(0, p.apps.length - PLAN_PORTALS),
    steps: p.steps.slice(0, SPINE_STEPS),
    more: Math.max(0, p.steps.length - SPINE_STEPS),
    gates: p.gates.slice(0, PLAN_GATES).map((g) => ({ label: g.label, why: g.why })),
    moreGates: Math.max(0, p.gates.length - PLAN_GATES),
    guard: b && of ? { avoided, of } : null,
    result: b
      ? {
          figure: b.valueTotalUsd ? usd(b.valueFoundUsd) : `${b.found} of ${b.eligible}`,
          line: `${b.found} of ${b.eligible} claims right${b.falseClaims ? `, ${b.falseClaims} false` : ", none false"}`,
          measured: true,
        }
      : {
          figure: `${Math.round(p.expectation.recall * 100)}%`,
          line: "of the claims: the bar it will be held to, not benched yet",
          measured: false,
        },
  };
}

/** The before-and-after band: the chore by hand against the same chore with her, on the bench. */
export interface BeforeAfter {
  manual: { figure: string; line: string };
  athena: { figure: string; line: string } | null;
  /** "30× faster" (the ledger's own figure, from her measured run), or "". */
  ratio: string;
}

export function beforeAfterOf(view: PlaybookView): BeforeAfter {
  const p = view.playbook;
  const b = p.bench;
  const parts = b
    ? [
        b.yourTimeS ? `your review ${minutes(b.yourTimeS / 60)}` : "",
        b.turns ? `${b.turns} ${b.turns === 1 ? "turn" : "turns"}` : "",
        b.costUsd !== null ? `${usd(b.costUsd)} of model time` : "",
      ].filter(Boolean)
    : [];
  return {
    manual: {
      figure: p.economics.manualMinutes ? minutes(p.economics.manualMinutes) : "–",
      line: p.economics.incumbent ? shortLine(p.economics.incumbent, 72) : "",
    },
    athena: b ? { figure: minutes(b.wallS / 60), line: parts.join(" · ") } : null,
    ratio: view.speed,
  };
}

/** The still a key on the strip moves to: Left and Right step, Home and End jump, the ends hold. */
export function stillStep(at: number, key: string, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowRight") return Math.min(at + 1, count - 1);
  if (key === "ArrowLeft") return Math.max(at - 1, 0);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
