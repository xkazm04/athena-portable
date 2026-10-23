/**
 * The Chores scene's small pure helpers — README section 3.5, ADR 0040, 0053, 0087, 0090 and 0096.
 *
 * The behaviour lives in the Playbooks module's own model (`modules/playbooks/model.ts`): the
 * verdicts, the ledger's filter and orders, the replay's reductions. This file adds only what a
 * depth scene needs on top: reading a place (`Path`) into a chore and a turn, and the catalogue's
 * and the topic page's words — the totals, the sentence an empty filter says, a row's value, and
 * what the flow's result and the time-saved figure are drawn from. Pure, so each is tested without
 * a DOM.
 *
 * The figures themselves (the value cell, the totals line, the flow's result, the time saved, the money
 * headline and the fit) are in `./worth.ts`: the first frame loads this file for `NEW_ITEM`, and only
 * the catalogue and the topic page read those.
 */
import type { Path } from "@/depth/model";
import { categoryLabel, jobLabel } from "@/lib/playbook-taxonomy";
import type { LedgerFilter, LedgerSort, PlaybookView, PlaybooksModel } from "@/modules/playbooks/model";

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

/** The place of the studio opened on a saved case (ADR 0123): `chores/<id>/case/<proj_id>`. */
export const casePath = (id: string, caseId: string): Path => ({
  root: "chores",
  item: id,
  sub: { kind: "case", arg: caseId },
});

/** The reserved item id of the front door: no chore may be called this (a test holds the library to it). */
export const NEW_ITEM = "new";

/** The place of the front door, where "New chore" leads (ADR 0098). */
export const newChorePath = (): Path => ({ root: "chores", item: NEW_ITEM });

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

/** The one line a long sentence must fit: its first clause, cut at a word near `max` characters. */
export function shortLine(text: string, max = 96): string {
  const t = text.trim();
  const clause = /^(.+?)[.;:(]/.exec(t)?.[1]?.trim() ?? t;
  if (clause.length <= max) return clause;
  const cut = clause.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,\s]+$/, "")}…`;
}
