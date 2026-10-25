import "server-only";
import { logActivity, undoActivity, type ActivityEntry } from "@athena/demo-kit/activity";
import type { Db } from "@athena/demo-kit/db";

import { MAX_IDS, MAX_REWRITES } from "./constants";
import {
  db,
  displayName,
  domainContacts,
  domainSpellings,
  getContact,
  getContacts,
  getPair,
} from "./db";
import { restamp, setField, writeField } from "./flags";
import {
  fieldLabel,
  NORMALIZABLE_FIELDS,
  planChanges,
  RULES,
  type FieldChange,
  type NormalizableField,
  type NormalizeRule,
} from "./normalize";
import type { Contact, PairStatus } from "./types";

export interface NormalizePlan {
  contact_id: string;
  name: string;
  changes: FieldChange[];
}

export interface MutationResult {
  ok: boolean;
  summary: string;
  /** Set when the write could not happen; the UI shows it verbatim. */
  error?: string;
}

/**
 * The ids a write may touch. Every export of this file is reached from a server action, which is
 * an HTTP endpoint: its parameter types are what the caller was told, not what arrived. So the
 * shapes are checked here, once, at the door every caller shares.
 */
function cap(ids: string[]): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id): id is string => typeof id === "string"))].slice(0, MAX_IDS);
}

/** The rules a caller asked for that exist, in the order `planChanges` applies them. */
function known(rules: NormalizeRule[]): NormalizeRule[] {
  return Array.isArray(rules) ? RULES.filter((r) => rules.includes(r)) : [];
}

/** `1 contact`, `3 contacts`: the answer a toast shows and an agent reads back, verbatim. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** The two verdicts `resolvePair` may write; `merged` belongs to `mergeContacts` alone. */
const VERDICTS: readonly PairStatus[] = ["kept_both", "skipped"];

/**
 * One liveness rule for every write path in this file.
 *
 * A deleted or merged-away record is out of every working segment by definition (lib/db.ts), so
 * it is not a write target either: an edit against it lands where nobody can see it and still
 * counts in `revisionCounts`.
 */
function live(c: Contact): boolean {
  return c.deleted_at === null && c.merged_into === null;
}

/*
 * Every stored flag (`phone_ok`, `is_stale`, `conflict`, `in_open_pair`) is written by lib/flags.ts
 * and nowhere else. A field write goes through `writeField`, which records the revision and
 * restamps what the field feeds; a write that moves a row out of the list or changes a pair's
 * status names the rows and domains it could have moved to `restamp`.
 */

/**
 * Removing a contact from the working list closes the open pairs that depend on it.
 *
 * One rule, one implementation: `deleteContacts` has always done this and `mergeContacts` closed
 * at most the single pair it was settling, so the two removal paths disagreed about what a
 * removal means for everything else that pointed at the row.
 */
function closeDependentPairs(tx: Db, contactId: string): void {
  const pairs = tx.all<{ id: string; keep_id: string; drop_id: string }>(
    "SELECT id, keep_id, drop_id FROM merge_pairs WHERE status = 'open' AND (keep_id = ? OR drop_id = ?)",
    [contactId, contactId],
  );
  for (const p of pairs) {
    tx.run("UPDATE merge_pairs SET status = 'skipped' WHERE id = ?", [p.id]);
  }
  restamp(tx, { ids: [contactId, ...pairs.map((p) => (p.keep_id === contactId ? p.drop_id : p.keep_id))] });
}

/* ------------------------------------------------------------- normalize */

/** What `normalize_fields` would do, without doing it. Powers the preview and `preview_merge`'s twin. */
export function planNormalize(ids: string[], rules: NormalizeRule[]): NormalizePlan[] {
  const applied = known(rules);
  if (applied.length === 0) return [];
  return getContacts(cap(ids))
    .filter(live)
    .map((c) => ({ contact_id: c.id, name: displayName(c), changes: planChanges(c, applied) }))
    .filter((p) => p.changes.length > 0)
    .sort((a, b) => a.contact_id.localeCompare(b.contact_id));
}

/**
 * Apply the rules and write one `revisions` row per changed field. The activity entry carries the
 * revision ids, which is the whole reason this action is AUTO: undo replays them backwards.
 */
export function normalizeFields(ids: string[], rules: NormalizeRule[]): MutationResult {
  const plans = planNormalize(ids, rules);
  if (plans.length === 0) {
    return { ok: true, summary: "Nothing to normalise: every selected record already conforms." };
  }

  const ts = new Date().toISOString();
  const revisionIds = db().withTx((tx) => {
    const written: number[] = [];
    for (const plan of plans) {
      for (const change of plan.changes) {
        written.push(
          writeField(tx, {
            contact_id: plan.contact_id,
            field: change.field,
            from: change.from,
            to: change.to,
            rules: change.rules.join(","),
            ts,
          }),
        );
      }
    }
    return written;
  });

  const fields = revisionIds.length;
  logActivity(db(), {
    actor: "user",
    action: "normalize_fields",
    target: `contacts:${plans.length}`,
    summary: `Normalised ${fields} field${fields === 1 ? "" : "s"} on ${plans.length} contact${
      plans.length === 1 ? "" : "s"
    } (${known(rules).join(", ")}).`,
    reversible: true,
    undo: { kind: "normalize", revisions: revisionIds },
    ts,
  });

  return { ok: true, summary: `Normalised ${count(fields, "field")} on ${count(plans.length, "contact")}.` };
}

/* ------------------------------------------------------------ flag stale */

export function flagStale(ids: string[]): MutationResult {
  const rows = getContacts(cap(ids)).filter((c) => live(c) && c.stale_flagged === 0);
  if (rows.length === 0) return { ok: true, summary: "Those contacts are already flagged." };

  const targets = rows.map((r) => r.id);
  db().withTx((tx) => {
    for (const id of targets) tx.run("UPDATE contacts SET stale_flagged = 1 WHERE id = ?", [id]);
  });
  logActivity(db(), {
    actor: "user",
    action: "flag_stale",
    target: `contacts:${targets.length}`,
    summary: `Flagged ${targets.length} contact${targets.length === 1 ? "" : "s"} as stale.`,
    reversible: true,
    undo: { kind: "flag_stale", ids: targets },
  });
  return { ok: true, summary: `Flagged ${count(targets.length, "contact")} as stale.` };
}


/* ------------------------------------------------------ company conflict */

/** The tag `resolve_company` writes into `revisions.rules`, so its rewrites are tellable apart. */
export const COMPANY_RULE = "resolve_company";

/** One contact `resolve_company` would rewrite. */
export interface CompanyChange {
  contact_id: string;
  name: string;
  from: string;
  to: string;
}

/** `preview_company`: what the rewrite would do, with the conflict it is settling beside it. */
export interface CompanyPlan {
  domain: string;
  canonical_name: string;
  contacts: number;
  rewrites: number;
  spellings: { company: string; contacts: number }[];
  showing: number;
  total: number;
  footer: string;
  changes: CompanyChange[];
}

/** Empty, and always for the same three reasons, so the tool can say which. */
function companyRefusal(domain: string, canonical: string): string | null {
  if (!domain.trim()) return "Name the email domain whose company field should be rewritten.";
  if (!canonical) return "Name the spelling to keep.";
  if (canonical.length > 120) return "That company name is too long.";
  // A name is one line of text. A line break or control character in it would be written to every
  // contact on the domain and carried into the CSV and the Markdown the export hands on.
  if (/[\u0000-\u001f\u007f]/.test(canonical)) {
    return "A company name cannot contain a line break, a tab or another control character.";
  }
  return null;
}

/**
 * What `resolve_company` would write, without writing it.
 *
 * Reads the same set the write does — every LIVE contact on the domain — so the preview cannot
 * promise a rewrite the write then skips.
 */
export function planCompany(domain: string, canonicalName: string): CompanyPlan | string {
  const canonical = canonicalName.trim().replace(/\s{2,}/g, " ");
  const refusal = companyRefusal(domain, canonical);
  if (refusal) return refusal;

  const rows = domainContacts(domain.trim().toLowerCase());
  if (rows.length === 0) return `No live contacts on ${domain}.`;
  const changes = rows
    .filter((c) => c.company !== canonical)
    .map((c) => ({ contact_id: c.id, name: displayName(c), from: c.company, to: canonical }));
  const shown = changes.slice(0, MAX_REWRITES);

  return {
    domain: domain.trim().toLowerCase(),
    canonical_name: canonical,
    contacts: rows.length,
    rewrites: changes.length,
    spellings: domainSpellings(domain.trim().toLowerCase()).map((s) => ({
      company: s.company,
      contacts: s.n,
    })),
    showing: shown.length,
    total: changes.length,
    footer: `(showing ${shown.length} of ${changes.length})`,
    changes: shown,
  };
}

/**
 * Settle a domain on one spelling of its company name (design 4.6.4, the memory beat).
 *
 * This is `normalize_fields` pointed at the one field a rule cannot clean: which of four spellings
 * is the company's real name is not a fact in the data, it is something someone knows — in the
 * demo, something Athena learned in another app. So the DECISION comes from outside and the WRITE
 * is the ordinary one: a `revisions` row per contact, an activity entry carrying their ids, and
 * therefore `applyUndo`'s existing `normalize` strategy putting every one of them back. Reversible
 * through the same path as a phone format, and AUTO for the same reason.
 */
export function resolveCompany(domain: string, canonicalName: string): MutationResult {
  const plan = planCompany(domain, canonicalName);
  if (typeof plan === "string") return { ok: false, summary: "", error: plan };
  if (plan.rewrites === 0) {
    return { ok: true, summary: `Every contact on ${plan.domain} is already "${plan.canonical_name}".` };
  }

  const ts = new Date().toISOString();
  const rows = domainContacts(plan.domain).filter((c) => c.company !== plan.canonical_name);
  const revisionIds = db().withTx((tx) => {
    const written: number[] = [];
    for (const row of rows) {
      written.push(
        writeField(tx, {
          contact_id: row.id,
          field: "company",
          from: row.company,
          to: plan.canonical_name,
          rules: COMPANY_RULE,
          ts,
        }),
      );
    }
    return written;
  });

  const was = plan.spellings.length;
  logActivity(db(), {
    actor: "user",
    action: "resolve_company",
    target: `domain:${plan.domain}`,
    summary:
      `Filed ${revisionIds.length} contact${revisionIds.length === 1 ? "" : "s"} on ${plan.domain} ` +
      `under "${plan.canonical_name}" (was spelled ${was} way${was === 1 ? "" : "s"}).`,
    reversible: true,
    undo: { kind: "normalize", revisions: revisionIds },
    ts,
  });

  return {
    ok: true,
    summary: `Filed ${count(revisionIds.length, "contact")} on ${plan.domain} under "${plan.canonical_name}".`,
  };
}

/* ----------------------------------------------------------------- merge */

/**
 * The tag a merge adoption writes into `revisions.rules`. The survivor's history says why its phone
 * or date changed, and the export tells an adoption apart from a normalisation by this tag.
 */
export const MERGE_RULE = "merge_contacts";

function adoptions(keep: Contact, drop: Contact): { field: "phone" | "last_activity_at"; value: string }[] {
  const out: { field: "phone" | "last_activity_at"; value: string }[] = [];
  if (keep.phone_ok === 0 && drop.phone_ok === 1) out.push({ field: "phone", value: drop.phone });
  if (drop.last_activity_at > keep.last_activity_at) {
    out.push({ field: "last_activity_at", value: drop.last_activity_at });
  }
  return out;
}

/**
 * Fold `drop_id` into `keep_id`. GATED, and not reversible: the dropped record stays in the
 * `merged` segment for the audit trail, but the two histories are one from here on.
 */
export function mergeContacts(keepId: string, dropId: string): MutationResult {
  const keep = getContact(keepId);
  const drop = getContact(dropId);
  if (!keep || !drop || keep.deleted_at !== null || drop.deleted_at !== null) {
    return { ok: false, summary: "", error: "One of those contacts is gone." };
  }
  if (keep.id === drop.id) return { ok: false, summary: "", error: "A contact cannot merge into itself." };
  if (drop.merged_into) return { ok: false, summary: "", error: `${drop.id} is already merged.` };
  // The survivor has to still be a survivor. Without this, merge(A,B) followed by merge(B,A)
  // points the two rows at each other and BOTH leave every working segment, with no undo.
  if (keep.merged_into) {
    return { ok: false, summary: "", error: `${keep.id} is already merged into ${keep.merged_into}.` };
  }

  // A merge settles an identity pair the rule set proposed (lib/matching.ts), so an open pair in
  // this exact orientation is the precondition, not decoration. The swapped orientation is a
  // different adjudication and does not authorise this one.
  const pair = db().get<{ id: string; confidence: number }>(
    `SELECT id, confidence FROM merge_pairs
      WHERE status = 'open' AND keep_id = ? AND drop_id = ?`,
    [keepId, dropId],
  );
  if (!pair) {
    return {
      ok: false,
      summary: "",
      error: `No open identity pair proposes merging ${dropId} into ${keepId}.`,
    };
  }
  const taken = adoptions(keep, drop);
  const ts = new Date().toISOString();

  db().withTx((tx) => {
    // Through the door, so each adoption leaves a revision on the survivor and restamps the flag
    // its field feeds (`phone_ok` for a phone, `is_stale` for a date).
    for (const a of taken) {
      writeField(tx, { contact_id: keep.id, field: a.field, from: keep[a.field], to: a.value, rules: MERGE_RULE, ts });
    }
    tx.run("UPDATE contacts SET merged_into = ? WHERE id = ?", [keep.id, drop.id]);
    tx.run("UPDATE merge_pairs SET status = 'merged' WHERE id = ?", [pair.id]);
    // The settled pair is already 'merged', so this closes only the others the drop stood in.
    closeDependentPairs(tx, drop.id);
    // The dropped record leaves the working list, and with it possibly its domain's last odd spelling.
    restamp(tx, { ids: [keep.id, drop.id], domains: [drop.domain] });
  });

  const carried = taken.length === 0 ? "nothing carried over" : `carried over ${taken.map((a) => a.field).join(" and ")}`;
  logActivity(db(), {
    actor: "user",
    action: "merge_contacts",
    target: `contact:${keep.id}`,
    // The ledger records which adjudication this was, because the write cannot be replayed back.
    summary:
      `Merged ${displayName(drop)} (${drop.id}) into ${displayName(keep)} (${keep.id}); ` +
      `${carried} (${pair.id}, ${Math.round(pair.confidence * 100)}% confidence).`,
    reversible: false,
    ts,
  });
  return { ok: true, summary: `Merged ${drop.id} into ${keep.id}.` };
}

/* ---------------------------------------------------------------- delete */

/** GATED and final: the rows leave every segment. Open pairs that mentioned them are closed. */
export function deleteContacts(ids: string[]): MutationResult {
  const rows = getContacts(cap(ids)).filter((c) => c.deleted_at === null);
  if (rows.length === 0) return { ok: false, summary: "", error: "Nothing to delete." };
  const ts = new Date().toISOString();

  db().withTx((tx) => {
    const emptied = new Set<string>();
    for (const row of rows) {
      emptied.add(row.domain);
      tx.run("UPDATE contacts SET deleted_at = ? WHERE id = ?", [ts, row.id]);
      closeDependentPairs(tx, row.id);
    }
    // Removing rows can collapse a domain's spelling set, which is what `conflict` summarises.
    restamp(tx, { domains: emptied });
  });

  logActivity(db(), {
    actor: "user",
    action: "delete_contacts",
    target: `contacts:${rows.length}`,
    summary: `Deleted ${rows.length} contact${rows.length === 1 ? "" : "s"}: ${rows
      .slice(0, 3)
      .map((r) => displayName(r))
      .join(", ")}${rows.length > 3 ? ` and ${rows.length - 3} more` : ""}.`,
    reversible: false,
    ts,
  });
  return { ok: true, summary: `Deleted ${count(rows.length, "contact")}.` };
}

/* ------------------------------------------------------- reviewer verdict */

/**
 * "Keep both" and "Skip" - the two reviewer answers that are not a merge. Reversible, so a
 * mis-keyed verdict costs one click on the activity log.
 */
export function resolvePair(pairId: string, status: Exclude<PairStatus, "open" | "merged">): MutationResult {
  if (!VERDICTS.includes(status)) {
    return { ok: false, summary: "", error: `"${String(status)}" is not a verdict; use kept_both or skipped.` };
  }
  const pair = getPair(pairId);
  if (!pair) return { ok: false, summary: "", error: `No pair ${pairId}.` };
  if (pair.status !== "open") return { ok: false, summary: "", error: `${pairId} is already ${pair.status}.` };

  db().withTx((tx) => {
    tx.run("UPDATE merge_pairs SET status = ? WHERE id = ?", [status, pairId]);
    restamp(tx, { ids: [pair.keep_id, pair.drop_id] });
  });

  const verdict = status === "kept_both" ? "Kept both records" : "Skipped";
  logActivity(db(), {
    actor: "user",
    action: status === "kept_both" ? "keep_both" : "skip_pair",
    target: `pair:${pairId}`,
    summary: `${verdict} for ${pairId} (${Math.round(pair.confidence * 100)}% confidence).`,
    reversible: true,
    undo: { kind: "resolve_pair", pair_id: pairId },
  });
  return { ok: true, summary: `${verdict} for ${pairId}.` };
}

/* ------------------------------------------------------------------ undo */

/**
 * Thrown from inside `applyUndo` when the world has moved since the write being reversed. The
 * throw rolls the whole undo back (`withTx`), and `undoWrite` turns it into a refusal with a reason.
 */
class UndoRefused extends Error {}

/**
 * `undo`, as the server action calls it: `undoActivity` with this app's strategies, and a refusal
 * instead of an exception when a strategy finds that replaying the entry would overwrite newer work.
 */
export function undoWrite(id: number): { ok: boolean; reason?: string } {
  try {
    const result = undoActivity(db(), id, applyUndo);
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  } catch (err) {
    if (err instanceof UndoRefused) return { ok: false, reason: err.message };
    throw err;
  }
}

interface UndoNormalize { kind: "normalize"; revisions: number[] }
interface UndoFlagStale { kind: "flag_stale"; ids: string[] }
interface UndoResolvePair { kind: "resolve_pair"; pair_id: string }
type UndoPayload = UndoNormalize | UndoFlagStale | UndoResolvePair;

/** The app half of `undoActivity`: only tidycrm knows how to put its own writes back. */
export function applyUndo(tx: Db, entry: ActivityEntry): void {
  const undo = entry.undo as UndoPayload | null;
  switch (undo?.kind) {
    case "normalize": {
      for (const id of [...undo.revisions].reverse()) {
        const rev = tx.get<{
          contact_id: string;
          field: string;
          old_value: string;
          new_value: string;
          reverted: number;
        }>("SELECT contact_id, field, old_value, new_value, reverted FROM revisions WHERE id = ?", [id]);
        if (!rev || rev.reverted === 1) continue;
        // Entries can be undone in any order, so the field may have been rewritten since. Putting
        // the old value back then would overwrite the newer write and leave its revision counted
        // as live. The field is only ours to restore while it still holds what we wrote.
        if (!NORMALIZABLE_FIELDS.includes(rev.field as NormalizableField)) {
          throw new Error(`revision ${id} names a field no rule writes: ${rev.field}`);
        }
        const now = tx.get<Record<string, string>>(`SELECT ${rev.field} AS value FROM contacts WHERE id = ?`, [
          rev.contact_id,
        ])?.value;
        if (now !== rev.new_value) {
          throw new UndoRefused(
            `#${entry.id} cannot be undone: ${fieldLabel(rev.field).toLowerCase()} on ${rev.contact_id} ` +
              `was changed again after it. Undo the later change first.`,
          );
        }
        // Back through the door's second half: the old value, and the flags it feeds restamped.
        setField(tx, rev.contact_id, rev.field, rev.old_value);
        tx.run("UPDATE revisions SET reverted = 1 WHERE id = ?", [id]);
      }
      return;
    }
    case "flag_stale": {
      for (const id of undo.ids) tx.run("UPDATE contacts SET stale_flagged = 0 WHERE id = ?", [id]);
      return;
    }
    case "resolve_pair": {
      const pair = tx.get<{ keep_id: string; drop_id: string }>(
        "SELECT keep_id, drop_id FROM merge_pairs WHERE id = ?",
        [undo.pair_id],
      );
      // A reopened pair is only work while both records are still in the working list; one whose
      // member was deleted or merged away since cannot be adjudicated, and reopening it would hold
      // the survivor in the duplicates segment with nothing to act on.
      const gone = pair
        ? [pair.keep_id, pair.drop_id].find((id) => {
            const c = tx.get<{ deleted_at: string | null; merged_into: string | null }>(
              "SELECT deleted_at, merged_into FROM contacts WHERE id = ?",
              [id],
            );
            return !c || c.deleted_at !== null || c.merged_into !== null;
          })
        : undefined;
      if (gone) {
        throw new UndoRefused(
          `#${entry.id} cannot be undone: ${gone} is no longer in the list, so ${undo.pair_id} has nothing left to decide.`,
        );
      }
      tx.run("UPDATE merge_pairs SET status = 'open' WHERE id = ?", [undo.pair_id]);
      if (pair) restamp(tx, { ids: [pair.keep_id, pair.drop_id] });
      return;
    }
    default:
      throw new Error(`no undo strategy for ${entry.action}`);
  }
}
