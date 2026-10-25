/**
 * What may repair a table, as the tool calls an agent sends. Client-safe and pure.
 *
 * The dossier's AUTO bar fires `normalize_fields` and `flag_stale` on the id lists `table.acts`
 * carries (`lib/acts.ts`, ADR 0149). No read handed those lists out: the L2 read sent six sample
 * rows, so an agent could repair only what a sample happened to show, and the person and the agent
 * acted on the same writes with different arguments. This module projects the same acts into the
 * calls that would carry them out, so `dossierRead` and `plan_repairs` serve exactly the lists the
 * buttons fire on (ADR 0174). It derives nothing of its own: a new repair is an act in
 * `lib/acts.ts` first.
 *
 * Two kinds of remedy, kept apart for the reason `tools/read.ts` exists. A **rule** remedy names its
 * dry run before its write (`preview`, then `act`), split at `MAX_IDS` so every call is one the
 * manifest accepts. A **person** remedy, an identity pair, names the pair ids and no call at all:
 * merging destroys a record, so no remedy ever names `merge_contacts`, `delete_contacts` or a verdict.
 */
import { PHONE_RULES, TIDY_RULES } from "@/lib/acts";
import { MAX_IDS } from "@/lib/constants";
import type { BkTable } from "./tables";

/** One call an agent could send: a registered tool's name and its arguments. */
export interface RemedyCall {
  tool: string;
  args: Record<string, unknown>;
}

/** A repair a rule may carry out: one batch of at most `MAX_IDS` targets. */
export interface RuleRemedy {
  kind: "phone" | "tidy" | "stale";
  by: "rule";
  /** Targets in this batch. */
  count: number;
  /** One-based, of `batches`. */
  batch: number;
  batches: number;
  /** The dry run that states what `act` would write, or null when the write has none. */
  preview: RemedyCall | null;
  act: RemedyCall;
}

/** A repair only a person may make: the open identity pairs, and no call. */
export interface PersonRemedy {
  kind: "duplicate";
  by: "person";
  /** Pair ids for `read_pairs` and `preview_merge`; settling one is a person's decision. */
  pairs: string[];
  /** Open pairs on the table the sheet did not attach. */
  pairs_hidden: number;
}

export type Remedy = RuleRemedy | PersonRemedy;
export type RemedyKind = Remedy["kind"];
export const REMEDY_KINDS: readonly RemedyKind[] = ["phone", "tidy", "stale", "duplicate"];

/** `ids` in runs of at most `size`, order kept. */
function batches(ids: readonly string[], size: number = MAX_IDS): string[][] {
  const out: string[][] = [];
  for (let at = 0; at < ids.length; at += size) out.push(ids.slice(at, at + size));
  return out;
}

function rule(
  kind: RuleRemedy["kind"],
  ids: readonly string[],
  call: (ids: string[]) => { preview: RemedyCall | null; act: RemedyCall },
): RuleRemedy[] {
  const runs = batches(ids);
  return runs.map((run, i) => ({ kind, by: "rule", count: run.length, batch: i + 1, batches: runs.length, ...call(run) }));
}

const normalize = (rules: readonly string[]) => (ids: string[]) => {
  const args = { ids, rules: [...rules] };
  return { preview: { tool: "preview_normalize", args }, act: { tool: "normalize_fields", args } };
};

/** Every remedy on one table, from the acts its dossier offers, in the order the bar draws them. */
export function remediesOf(table: BkTable): Remedy[] {
  const { acts } = table;
  const out: Remedy[] = [
    ...rule("phone", acts.phone.ids, normalize(PHONE_RULES)),
    ...rule("tidy", acts.tidy.ids, normalize(TIDY_RULES)),
    ...rule("stale", acts.flag.ids, (ids) => ({ preview: null, act: { tool: "flag_stale", args: { ids } } })),
  ];
  if (acts.merge.enabled) {
    out.push({ kind: "duplicate", by: "person", pairs: [...acts.merge.ids], pairs_hidden: table.pairsHidden });
  }
  return out;
}
