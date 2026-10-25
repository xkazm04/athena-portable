/**
 * The evidence facets exist only for an application somebody read against the rubric.
 *
 * "0 of 20 criteria evidenced" over four applications nobody has opened is a claim that their
 * writing was checked and holds nothing: the zero-as-score error the model file names as the
 * worst this domain can do. `BdCandidate.evidence` is null for the unread, the column sentence
 * counts only the read, and the agent's reads drop the keys exactly as they drop `overall`.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("hirelane-evidence-test-");

const { buildBoard } = await import("../lib/board");
const { latestScorecards } = await import("../lib/queries");
const { screeningFact } = await import("../components/board/model/evidence");
const { BAND_LABEL } = await import("../components/board/model");
const { candidateRead, dossierRead } = await import("../components/board/tools/read");

type Candidate = ReturnType<typeof buildBoard>["roles"][number]["columns"][number]["candidates"][number];

const board = buildBoard();
const role = (id: string) => board.roles.find((r) => r.id === id)!;
const screening = (id: string) => role(id).columns.find((c) => c.id === "screening")!.candidates;

test("evidence case 3: a screening column nobody has read says so instead of '0 of 20 criteria evidenced'", () => {
  const designers = screening("role_designer");
  assert.equal(designers.length, 4, "the seed puts four designers in screening");
  assert.equal(designers.filter((c) => c.scored).length, 0, "and scores none of them");
  assert.equal(screeningFact(designers), "Nobody here has been read against the rubric yet.");
});

test("evidence case 4: the screening sentence counts only the scored and names how many are unread", () => {
  const backend = screening("role_backend");
  const scored = backend.filter((c) => c.scored);
  assert.equal(scored.length, 6, "six scored borderline applicants");
  assert.equal(backend.length - scored.length, 1, "and one unread");
  const evidenced = latestScorecardsEvidenced(scored);
  const fact = screeningFact(backend);
  assert.ok(fact, "a column with candidates has a fact");
  assert.ok(fact.startsWith(`${evidenced} of 30 criteria evidenced`), `M is 6 x 5, not 35: ${fact}`);
  assert.ok(fact.endsWith("1 not read yet"), `the unread one is named, not counted as zero: ${fact}`);
});

test("evidence case 5: an unscored candidate's dossier read carries no evidence keys", () => {
  const backend = role("role_backend");
  const unread = screening("role_backend").find((c) => !c.scored)!;
  const read = dossierRead(backend, unread, board.slots);
  for (const key of ["criteria_evidenced", "confidence", "uncertain_because"]) {
    assert.equal(key in read, false, `${unread.name}: no ${key}`);
  }
});

test("evidence case 6 (guard): a scored candidate's confidence and uncertain_because are the base tree's", () => {
  let seen = 0;
  for (const r of board.roles) {
    const cards = latestScorecards(r.id);
    for (const candidate of r.columns.flatMap((c) => c.candidates).filter((c) => c.scored)) {
      const stored = cards[candidate.id]!;
      const evidenced = stored.filter((s) => s.evidence.length > 0).length;
      const share = evidenced / stored.length;
      const band = share >= 0.8 ? "tight" : share >= 0.5 ? "moderate" : "wide";
      const read = candidateRead(candidate) as Record<string, unknown>;
      assert.equal(read.confidence, BAND_LABEL[band], `${candidate.name}: confidence`);
      assert.deepEqual(
        read.uncertain_because,
        stored.filter((s) => s.evidence.length === 0).map((s) => s.name),
        `${candidate.name}: uncertain_because`,
      );
      seen++;
    }
  }
  assert.ok(seen > 0, "some candidates are scored");
});

/** Sum of quoted criteria over the given candidates, from their stored scorecards. */
function latestScorecardsEvidenced(candidates: Candidate[]): number {
  const cards = latestScorecards("role_backend");
  return candidates.reduce((n, c) => n + cards[c.id]!.filter((s) => s.evidence.length > 0).length, 0);
}

/**
 * Evidence case 7: the type pin. Never called; `pnpm typecheck` is the assertion. If `evidence`
 * ever stops being nullable, the read below compiles, the directive is unused, and tsc fails.
 * The narrowed read beside it fails if the field is ever removed or renamed, so the directive
 * cannot pass by swallowing a "property does not exist" error instead.
 */
export function evidenceNarrowed(candidate: Candidate): string {
  return candidate.evidence ? candidate.evidence.band : "unread";
}

export function evidenceStaysNullable(candidate: Candidate): string {
  // @ts-expect-error evidence is null for an unread application; narrow on it before reading.
  return candidate.evidence.band;
}
