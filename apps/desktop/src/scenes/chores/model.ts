/**
 * The Chores scene's small pure helpers — README section 3.5, ADR 0040, 0053, 0087, 0090 and 0096.
 *
 * The behaviour lives in the Playbooks module's own model (`modules/playbooks/model.ts`): the
 * verdicts, the ledger's filter and orders, the replay's reductions. This file adds only what a
 * depth scene needs on top: reading a place (`Path`) into a chore and a turn, and the catalogue's
 * and the topic page's words — the totals, the sentence an empty filter says, a row's value, and
 * what the flow's result and the time-saved figure are drawn from. Pure, so each is tested without
 * a DOM.
 */
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

/** The place of a chore's Adopt studio, where "Make it yours" leads (ADR 0097). */
export const adoptPath = (id: string): Path => ({ root: "chores", item: id, sub: { kind: "adopt" } });

/** "A store shipping…" read mid-sentence: "a store shipping…". An acronym ("SaaS", "EU") stays. */
export function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

// -- the catalogue (ADR 0096) ----------------------------------------------------------------------

/** The ledger's order before anyone presses a head: the edge, best first, which is the map's. */
export const EDGE_ORDER: LedgerSort = { key: "edge", dir: "asc" };

/** The sentence a filter that leaves no playbook says: which area and which job, by name. */
export function emptyLine(f: LedgerFilter): string {
  if (f.category === "all" && f.job === "all") return "No playbook in this build.";
  const area = f.category === "all" ? "any area" : categoryLabel(f.category);
  const job = f.job === "all" ? "" : ` whose job is to ${jobLabel(f.job).toLowerCase()}`;
  return `No playbook in ${area}${job}.`;
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

/** What the flow's result and the topic's "traps avoided" are drawn from: the playbook and its bench alone. */
export interface Blueprint {
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
