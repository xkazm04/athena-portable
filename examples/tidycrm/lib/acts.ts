/**
 * Which acts a table's dossier offers, on which records, and if none, why. Client-safe and pure.
 *
 * ADR 0107 set the rule in hirelane and this file carries it here: the surface offers exactly what
 * the write would accept, so a button never promises work its action will not do. The dossier's
 * gate used to decide from predicates of its own. Its tidy act was enabled on every live row and
 * labelled with every live row, while `normalize_fields` changes only the rows its planner finds a
 * change on (800 labelled against 78 planned on the seed). And its gated delete was offered on the
 * stale rows nobody had flagged yet, so flagging them, the reversible alternative the gate itself
 * recommends, took the irreversible act away for good, although `delete_contacts` accepts a flagged
 * row as readily as any other.
 *
 * So the offer is computed from the write's own predicates. The two tidies ask `planChanges`, the
 * pure planner `planNormalize` runs (lib/normalize.ts), so the count a button prints is the count
 * of contacts the write reports. The flag targets the stale rows not yet flagged, which is what
 * `flag_stale` changes. The delete targets every live stale row, flagged or not. The two pair acts
 * are offered when the table carries an open pair. `lib/blocks/index.ts` builds these while it
 * already holds every row, and `components/blocks/dossier/Gate.tsx` renders from them and decides
 * nothing. `test/acts.test.ts` runs every seeded table through every act against the real writes.
 *
 * No database here: the rows come in as plain values, so the server and the client ask the same
 * question of the same data. A new availability rule for the dossier goes here or nowhere.
 */
import { STALE_MONTHS } from "./constants";
import { planChanges, RULE_LABELS, type Normalizable, type NormalizeRule } from "./normalize";

/** The rules the dossier's tidy act runs, in the order `planChanges` applies them. */
export const TIDY_RULES: readonly NormalizeRule[] = ["trim_whitespace", "lowercase_email"];
/** The rule the dossier's phone act runs. */
export const PHONE_RULES: readonly NormalizeRule[] = ["phone_e164"];

/** Why an act is not on offer. One vocabulary for every dossier label. */
export type ActReason =
  | "nothing_to_tidy"
  | "no_phone_to_rewrite"
  | "nothing_stale"
  | "all_flagged"
  | "no_pair";

/** The six acts a table's dossier can take. */
export type ActName = "tidy" | "phone" | "flag" | "keep_both" | "merge" | "delete";

export interface Act {
  enabled: boolean;
  /**
   * How many the act would change: contacts for the four record acts, and one for each pair act,
   * which settles one identity pair at a time. Zero exactly when the act is not on offer.
   */
  count: number;
  /** What the act runs on: contact ids for the record acts, the table's open pair ids for the two pair acts. */
  ids: string[];
  /** What the control prints: the offer when enabled, the refusal sentence when not. */
  label: string;
  reason?: ActReason;
}

export type Acts = Record<ActName, Act>;

/**
 * The refusal sentences, keyed by reason. The dossier prints these words for a shut act, so a
 * reason means one thing wherever it is read.
 */
export const REFUSAL: Record<ActReason, () => string> = {
  nothing_to_tidy: () => "Whitespace and email case already conform",
  no_phone_to_rewrite: () => "No number here can be rewritten as +1XXXXXXXXXX",
  nothing_stale: () => `Nothing is stale past ${STALE_MONTHS} months`,
  all_flagged: () => "Every stale row is already flagged",
  no_pair: () => "No pair to adjudicate",
};

/** The fields every rule here reads off one contact. */
export interface ActRow extends Normalizable {
  id: string;
  is_stale: 0 | 1;
  stale_flagged: 0 | 1;
}

/** An open identity pair on the table: only its id is needed to offer the two pair acts. */
export interface ActPair {
  id: string;
}

/** `row` after one, `rows` after any other count. */
function rows(n: number): string {
  return `row${n === 1 ? "" : "s"}`;
}

function act(ids: string[], offer: (n: number) => string, reason: ActReason, count = ids.length): Act {
  return ids.length > 0
    ? { enabled: true, count, ids, label: offer(count) }
    : { enabled: false, count: 0, ids: [], label: REFUSAL[reason](), reason };
}

/** The ids a normalize write with these rules would change, by the write's own planner. */
export function plannedIds(table: readonly ActRow[], rules: readonly NormalizeRule[]): string[] {
  return table.filter((c) => planChanges(c, [...rules]).length > 0).map((c) => c.id);
}

/** Every act on one table, against its live rows and its open pairs as they stand. */
export function actsFor(table: readonly ActRow[], pairs: readonly ActPair[]): Acts {
  const stale = table.filter((c) => c.is_stale === 1);
  const unflagged = stale.filter((c) => c.stale_flagged === 0).map((c) => c.id);
  const pairIds = pairs.map((p) => p.id);
  return {
    tidy: act(plannedIds(table, TIDY_RULES), (n) => `Tidy whitespace and email case · ${n} ${rows(n)}`, "nothing_to_tidy"),
    phone: act(plannedIds(table, PHONE_RULES), (n) => `${RULE_LABELS.phone_e164} · ${n} ${rows(n)}`, "no_phone_to_rewrite"),
    flag: act(unflagged, (n) => `Flag ${n} stale ${rows(n)}`, stale.length > 0 ? "all_flagged" : "nothing_stale"),
    keep_both: act(pairIds, () => "Keep both records", "no_pair", 1),
    merge: act(pairIds, () => "Merge the identity pair", "no_pair", 1),
    delete: act(
      stale.map((c) => c.id),
      (n) => `Delete ${n} stale ${rows(n)}`,
      "nothing_stale",
    ),
  };
}
