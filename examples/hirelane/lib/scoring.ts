/**
 * The rubric heuristic: keyword evidence, nothing else.
 *
 * Deliberately simple and deliberately transparent. Every score points at the sentences that
 * produced it, so a hiring manager can disagree with the machine on the spot. Nothing here reads
 * anything but the words the applicant wrote about their work - there is no other input, because
 * there is no other input in the data (see the README on bias mitigations).
 */
import { SCORE_LABEL } from "./constants";
import type { Criterion, CriterionScore } from "./types";

/** Split prose into sentences worth quoting. Keeps the trailing punctuation. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
}

function mentions(sentence: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(sentence);
}

/**
 * Score one criterion. 0-3 comes from how many distinct CV sentences carry a keyword; the short
 * answer can add the fourth point, because saying it in your own words is worth something.
 */
export function scoreCriterion(
  criterion: Criterion,
  cvText: string,
  shortAnswer: string,
): CriterionScore {
  const evidence: string[] = [];
  for (const sentence of sentences(cvText)) {
    if (criterion.keywords.some((k) => mentions(sentence, k))) evidence.push(sentence);
    if (evidence.length === 3) break;
  }
  const answerHit = sentences(shortAnswer).find((s) =>
    criterion.keywords.some((k) => mentions(s, k)),
  );
  if (answerHit) evidence.push(answerHit);
  const score = Math.min(4, evidence.length);
  return {
    criterion_id: criterion.id,
    name: criterion.name,
    score,
    weight: criterion.weight,
    evidence,
  };
}

export function scoreAgainst(
  criteria: Criterion[],
  cvText: string,
  shortAnswer: string,
): CriterionScore[] {
  return criteria.map((c) => scoreCriterion(c, cvText, shortAnswer));
}

/** Weighted mean on the 0-4 scale, to one decimal. */
export function overallScore(scores: CriterionScore[]): number {
  const weight = scores.reduce((sum, s) => sum + s.weight, 0);
  if (weight === 0) return 0;
  const total = scores.reduce((sum, s) => sum + s.score * s.weight, 0);
  return Math.round((total / weight) * 10) / 10;
}

export function scoreLabel(score: number): string {
  return SCORE_LABEL[Math.max(0, Math.min(4, Math.round(score)))] ?? "unscored";
}

/** The criterion with no evidence at all, when the rest of the card is strong. */
export function gapOf(scores: CriterionScore[]): CriterionScore | undefined {
  const empty = scores.filter((s) => s.score === 0);
  if (empty.length !== 1) return undefined;
  const rest = scores.filter((s) => s.score > 0);
  return overallScore(rest) >= 2.5 ? empty[0] : undefined;
}

/** One line a human can read without opening the card. */
export function summarise(scores: CriterionScore[]): string {
  const gap = gapOf(scores);
  const strong = scores
    .filter((s) => s.score >= 3)
    .map((s) => s.name.toLowerCase())
    .slice(0, 2);
  const strengths = strong.length > 0 ? `strong on ${strong.join(" and ")}` : "no standout strength";
  return gap ? `${strengths}; no evidence for ${gap.name.toLowerCase()}` : strengths;
}
