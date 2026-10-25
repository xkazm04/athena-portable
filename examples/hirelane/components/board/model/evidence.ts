/**
 * What a screening column says about how much of the rubric its applications speak to.
 *
 * It counts only the applications somebody read. An unread one has no evidence facts at all
 * (`BdCandidate.evidence` is null), so it cannot add a zero to the sum or five criteria to the
 * total; it is named as unread instead. Pure, so `node --test` reads it without a renderer.
 */
import type { BdCandidate } from "./candidates";

export const NOBODY_READ = "Nobody here has been read against the rubric yet.";

/** The screening stage's one fact, over the candidates the filters left standing. */
export function screeningFact(candidates: readonly BdCandidate[]): string | null {
  if (candidates.length === 0) return null;
  let evidenced = 0;
  let total = 0;
  let unread = 0;
  for (const c of candidates) {
    if (!c.evidence) {
      unread++;
      continue;
    }
    evidenced += c.evidence.evidenced;
    total += c.evidence.criteriaCount;
  }
  if (unread === candidates.length) return NOBODY_READ;
  const read = `${evidenced} of ${total} criteria evidenced`;
  return unread > 0 ? `${read} · ${unread} not read yet` : read;
}
