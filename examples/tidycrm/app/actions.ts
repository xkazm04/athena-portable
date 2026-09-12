"use server";

import { revalidatePath } from "next/cache";
import { undoActivity } from "@athena/demo-kit/activity";

import {
  countOpenPairs,
  db,
  listOpenPairs,
  previewPair,
  readConflicts,
  type ConflictPage,
} from "@/lib/db";
import { exportSummary, type ExportSummary } from "@/lib/summary";
import {
  applyUndo,
  deleteContacts,
  flagStale,
  mergeContacts,
  normalizeFields,
  planNormalize,
  planCompany,
  resolveCompany,
  resolvePair,
  type CompanyPlan,
  type MutationResult,
  type NormalizePlan,
} from "@/lib/mutations";
import type { NormalizeRule } from "@/lib/normalize";
import type { Segment } from "@/lib/constants";
import type { MergePair, PairPreview, PairStatus } from "@/lib/types";

/** Default and ceiling for `listPairsAction`. The queue is long; a prompt is not. */
const PAIR_PAGE = 10;
const MAX_PAIRS = 50;

/**
 * Every write touches the counts, the sheet and the log, so they all refresh together.
 *
 * One route now renders mutable data, and it is the root: the direction index at `/v` and the
 * `/v/blocks` route beneath it are gone (app/page.tsx). Both used to be named here, because the
 * tools were registered on one and the figures printed on the other.
 */
function refresh(): void {
  revalidatePath("/");
}

/**
 * The merge queue, bounded, with the total beside it.
 *
 * Every tool that closes a pair or joins two contacts addresses them BY ID — `preview_merge` and
 * `resolve_pair` take a `pair_id`, `merge_contacts` takes `keep_id` and `drop_id` — and nothing
 * this app registered handed an id out: `read_state` returns counts. An agent asked to merge the
 * worst duplicate could only refuse or invent an id, so the two gated tools on this surface were
 * unreachable from a conversation and the gate could never be exercised. This is the read the
 * onboarding contract puts first ("Reads first; then reversible writes; then the irreversible").
 *
 * Capped and announced, per AGENTS.md: a capped figure that does not say so is how a reader comes
 * to believe the queue holds what it returned.
 */
export async function listPairsAction(
  limit: number,
): Promise<{ pairs: MergePair[]; showing: number; total: number; footer: string }> {
  const bounded = Math.max(1, Math.min(Math.trunc(limit) || PAIR_PAGE, MAX_PAIRS));
  const pairs = listOpenPairs(bounded);
  const total = countOpenPairs();
  return {
    pairs,
    showing: pairs.length,
    total,
    footer: `(showing ${pairs.length} of ${total})`,
  };
}

export async function undoAction(id: number): Promise<{ ok: boolean; reason?: string }> {
  const result = undoActivity(db(), id, applyUndo);
  refresh();
  return { ok: result.ok, ...(result.reason ? { reason: result.reason } : {}) };
}

export async function previewNormalizeAction(
  ids: string[],
  rules: NormalizeRule[],
): Promise<NormalizePlan[]> {
  return planNormalize(ids, rules);
}

export async function normalizeAction(
  ids: string[],
  rules: NormalizeRule[],
): Promise<MutationResult> {
  const result = normalizeFields(ids, rules);
  refresh();
  return result;
}

export async function flagStaleAction(ids: string[]): Promise<MutationResult> {
  const result = flagStale(ids);
  refresh();
  return result;
}

export async function mergeAction(keepId: string, dropId: string): Promise<MutationResult> {
  const result = mergeContacts(keepId, dropId);
  refresh();
  return result;
}

export async function deleteAction(ids: string[]): Promise<MutationResult> {
  const result = deleteContacts(ids);
  refresh();
  return result;
}

export async function resolvePairAction(
  pairId: string,
  status: Exclude<PairStatus, "open" | "merged">,
): Promise<MutationResult> {
  const result = resolvePair(pairId, status);
  refresh();
  return result;
}

/** `preview_merge`: the side-by-side evidence, and nothing changes. */
export async function previewMergeAction(pairId: string): Promise<PairPreview | null> {
  return previewPair(pairId) ?? null;
}

/**
 * The company-name conflict, as `read_conflicts` hands it over.
 *
 * Bounded and announced (AGENTS.md). With no domain it is the list of every domain still spelled
 * more than one way, worst first; with a domain it is that one domain whether or not it is still
 * in conflict, which is what makes it `resolve_company`'s preview as well as its index.
 */
export async function readConflictsAction(
  domain: string | undefined,
  limit: number,
): Promise<ConflictPage> {
  return readConflicts(domain, limit);
}

/** `preview_company`: the rewrite `resolve_company` would make, and nothing written. */
export async function previewCompanyAction(
  domain: string,
  canonicalName: string,
): Promise<CompanyPlan | string> {
  return planCompany(domain, canonicalName);
}

/** `resolve_company`: file every contact on one domain under one spelling. Undoable. */
export async function resolveCompanyAction(
  domain: string,
  canonicalName: string,
): Promise<MutationResult> {
  const result = resolveCompany(domain, canonicalName);
  refresh();
  return result;
}

/**
 * What the export says happened, for the page it gets appended to.
 *
 * The CSV itself is still `GET /api/export`, a download the browser performs; this is the half a
 * model can read. Kept a server action rather than folded into that route because the route
 * answers with `Content-Disposition` and a caller cannot have both a file and a JSON body.
 */
export async function exportSummaryAction(segment: Segment): Promise<ExportSummary> {
  return exportSummary(segment);
}
