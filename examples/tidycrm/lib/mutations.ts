import "server-only";
import { logActivity, type ActivityEntry } from "@athena/demo-kit/activity";
import type { Db } from "@athena/demo-kit/db";

import { MAX_IDS, MAX_REWRITES } from "./constants";
import { db, displayName, domainContacts, domainSpellings, getContact, getContacts, getPair } from "./db";
import { isE164, planChanges, type FieldChange, type NormalizeRule } from "./normalize";
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

function cap(ids: string[]): string[] {
  return [...new Set(ids)].slice(0, MAX_IDS);
}

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

function refreshPairFlag(tx: Db, contactId: string): void {
  const row = tx.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM merge_pairs WHERE status = 'open' AND (keep_id = ? OR drop_id = ?)",
    [contactId, contactId],
  );
  tx.run("UPDATE contacts SET in_open_pair = ? WHERE id = ?", [(row?.n ?? 0) > 0 ? 1 : 0, contactId]);
}

/**
 * Restamp `conflict` for every row on a domain.
 *
 * `conflict` is a stored, indexed flag (lib/db.ts), which makes every write that changes a
 * domain's spelling set responsible for it - the same contract `phone_ok` gets after a phone
 * write. The count deliberately mirrors `domainSpellings`' own predicate, because that is the
 * figure the sheet's clause is built from and the two must not be able to disagree.
 */
function refreshConflict(tx: Db, domain: string): void {
  const row = tx.get<{ n: number }>(
    "SELECT COUNT(DISTINCT TRIM(company)) AS n FROM contacts WHERE domain = ? AND deleted_at IS NULL",
    [domain],
  );
  tx.run("UPDATE contacts SET conflict = ? WHERE domain = ?", [(row?.n ?? 0) > 1 ? 1 : 0, domain]);
}

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
    refreshPairFlag(tx, p.keep_id === contactId ? p.drop_id : p.keep_id);
  }
}

function domainOf(tx: Db, contactId: string): string | undefined {
  return tx.get<{ domain: string }>("SELECT domain FROM contacts WHERE id = ?", [contactId])?.domain;
}

/* ------------------------------------------------------------- normalize */

/** What `normalize_fields` would do, without doing it. Powers the preview and `preview_merge`'s twin. */
export function planNormalize(ids: string[], rules: NormalizeRule[]): NormalizePlan[] {
  if (rules.length === 0) return [];
  return getContacts(cap(ids))
    .filter(live)
    .map((c) => ({ contact_id: c.id, name: displayName(c), changes: planChanges(c, rules) }))
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
    const respelled = new Set<string>();
    for (const plan of plans) {
      for (const change of plan.changes) {
        const { lastInsertRowid } = tx.run(
          `INSERT INTO revisions (contact_id, field, old_value, new_value, rules, ts)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [plan.contact_id, change.field, change.from, change.to, change.rules.join(","), ts],
        );
        written.push(lastInsertRowid);
        tx.run(`UPDATE contacts SET ${change.field} = ? WHERE id = ?`, [change.to, plan.contact_id]);
        if (change.field === "phone") {
          tx.run("UPDATE contacts SET phone_ok = ? WHERE id = ?", [
            isE164(change.to) ? 1 : 0,
            plan.contact_id,
          ]);
        }
        if (change.field === "company") {
          const domain = domainOf(tx, plan.contact_id);
          if (domain) respelled.add(domain);
        }
      }
    }
    for (const domain of respelled) refreshConflict(tx, domain);
    return written;
  });

  const fields = revisionIds.length;
  logActivity(db(), {
    actor: "user",
    action: "normalize_fields",
    target: `contacts:${plans.length}`,
    summary: `Normalised ${fields} field${fields === 1 ? "" : "s"} on ${plans.length} contact${
      plans.length === 1 ? "" : "s"
    } (${rules.join(", ")}).`,
    reversible: true,
    undo: { kind: "normalize", revisions: revisionIds },
    ts,
  });

  return { ok: true, summary: `Normalised ${fields} fields across ${plans.length} contacts.` };
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
  return { ok: true, summary: `Flagged ${targets.length} contacts as stale.` };
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
      const { lastInsertRowid } = tx.run(
        `INSERT INTO revisions (contact_id, field, old_value, new_value, rules, ts)
         VALUES (?, 'company', ?, ?, ?, ?)`,
        [row.id, row.company, plan.canonical_name, COMPANY_RULE, ts],
      );
      written.push(lastInsertRowid);
      tx.run("UPDATE contacts SET company = ? WHERE id = ?", [plan.canonical_name, row.id]);
    }
    refreshConflict(tx, plan.domain);
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
    summary: `Filed ${revisionIds.length} contacts on ${plan.domain} under "${plan.canonical_name}".`,
  };
}

/* ----------------------------------------------------------------- merge */

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

  db().withTx((tx) => {
    for (const a of taken) tx.run(`UPDATE contacts SET ${a.field} = ? WHERE id = ?`, [a.value, keep.id]);
    if (taken.some((a) => a.field === "phone")) {
      tx.run("UPDATE contacts SET phone_ok = 1 WHERE id = ?", [keep.id]);
    }
    tx.run("UPDATE contacts SET merged_into = ?, in_open_pair = 0 WHERE id = ?", [keep.id, drop.id]);
    tx.run("UPDATE merge_pairs SET status = 'merged' WHERE id = ?", [pair.id]);
    // The settled pair is already 'merged', so this closes only the others the drop stood in.
    closeDependentPairs(tx, drop.id);
    refreshPairFlag(tx, keep.id);
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
      tx.run("UPDATE contacts SET deleted_at = ?, in_open_pair = 0 WHERE id = ?", [ts, row.id]);
      closeDependentPairs(tx, row.id);
    }
    // Removing rows can collapse a domain's spelling set, which is what `conflict` summarises.
    for (const domain of emptied) refreshConflict(tx, domain);
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
  return { ok: true, summary: `Deleted ${rows.length} contacts.` };
}

/* ------------------------------------------------------- reviewer verdict */

/**
 * "Keep both" and "Skip" - the two reviewer answers that are not a merge. Reversible, so a
 * mis-keyed verdict costs one click on the activity log.
 */
export function resolvePair(pairId: string, status: Exclude<PairStatus, "open" | "merged">): MutationResult {
  const pair = getPair(pairId);
  if (!pair) return { ok: false, summary: "", error: `No pair ${pairId}.` };
  if (pair.status !== "open") return { ok: false, summary: "", error: `${pairId} is already ${pair.status}.` };

  db().withTx((tx) => {
    tx.run("UPDATE merge_pairs SET status = ? WHERE id = ?", [status, pairId]);
    refreshPairFlag(tx, pair.keep_id);
    refreshPairFlag(tx, pair.drop_id);
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
        const rev = tx.get<{ contact_id: string; field: string; old_value: string; reverted: number }>(
          "SELECT contact_id, field, old_value, reverted FROM revisions WHERE id = ?",
          [id],
        );
        if (!rev || rev.reverted === 1) continue;
        tx.run(`UPDATE contacts SET ${rev.field} = ? WHERE id = ?`, [rev.old_value, rev.contact_id]);
        if (rev.field === "phone") {
          tx.run("UPDATE contacts SET phone_ok = ? WHERE id = ?", [
            isE164(rev.old_value) ? 1 : 0,
            rev.contact_id,
          ]);
        }
        if (rev.field === "company") {
          const domain = domainOf(tx, rev.contact_id);
          if (domain) refreshConflict(tx, domain);
        }
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
      tx.run("UPDATE merge_pairs SET status = 'open' WHERE id = ?", [undo.pair_id]);
      if (pair) {
        refreshPairFlag(tx, pair.keep_id);
        refreshPairFlag(tx, pair.drop_id);
      }
      return;
    }
    default:
      throw new Error(`no undo strategy for ${entry.action}`);
  }
}
