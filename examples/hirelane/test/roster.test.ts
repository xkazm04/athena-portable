/**
 * The two reads the screening journey turns on, over the real seeded board.
 *
 * `read_applicants` is the read one decision is taken over — six borderline backend applicants,
 * each with a named gap, one of whom works at a client the sibling app is chasing — and
 * `read_shortlist` is what the journey closes with. Both are pure functions over the payload
 * `buildBoard()` produces, which is why they can be asserted here without a browser: the tool
 * registration adds a description and a handler, and no logic.
 *
 * What this pins is the CONTRACT, field by field. Another agent writes an end-to-end test against
 * these names; a rename that does not fail here would fail there instead, silently, in a demo.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.chdir(mkdtempSync(join(tmpdir(), "hirelane-roster-test-")));

const { KESTREL_APPLICANT, companyDomain } = await import("@athena/demo-kit/seed");
const { buildBoard } = await import("../lib/board");
const { readApplicants, readShortlist } = await import("../components/board/tools/roster");

const board = buildBoard();

const ok = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
};

test("read_applicants returns every field a screening decision needs", () => {
  const result = ok(readApplicants(board, { role_id: "role_backend" }));

  assert.equal(result.role_id, "role_backend");
  assert.ok(result.applicants.length > 0, "the seed produces backend applicants");
  assert.equal(result.showing, result.applicants.length);
  assert.match(result.bounded, /^\(showing \d+ of \d+\)$/, "the truncation sentence, always");

  for (const applicant of result.applicants) {
    for (const field of ["id", "name", "email", "employer", "stage", "borderline", "scored"]) {
      assert.ok(field in applicant, `${applicant.id}: ${field} is present`);
    }
    assert.ok("employer_domain" in applicant, `${applicant.id}: employer_domain is present`);
    assert.ok("gap" in applicant, `${applicant.id}: gap is present, even when it is null`);
    // The unscored are expressed by absence, never by a zero.
    assert.equal(
      "score" in applicant,
      applicant.scored,
      `${applicant.id}: a score exists only when somebody produced one`,
    );
  }
});

test("read_applicants refuses a role it does not have, and says which it does", () => {
  const result = readApplicants(board, { role_id: "role_sales" });
  assert.equal(result.ok, false);
  assert.ok("roles" in result && result.roles.some((r) => r.id === "role_backend"));
});

test("six borderline backend applicants, each with its own named gap", () => {
  const result = ok(readApplicants(board, { role_id: "role_backend", borderline: true }));

  assert.equal(result.of, 6, "the six the comparison levels exist for");
  assert.equal(result.applicants.length, 6);
  for (const applicant of result.applicants) {
    assert.equal(applicant.borderline, true);
    assert.equal(applicant.stage, "screening", `${applicant.id}: borderline is a screening state`);
    assert.ok(
      applicant.gap && applicant.gap.length > 0,
      `${applicant.id}: the criterion their application never mentions, by name`,
    );
    assert.equal(applicant.scored, true, `${applicant.id}: scored, or there is nothing to argue`);
  }
});

test("exactly one borderline backend applicant works at Kestrel Labs, and it is the cross-app person", () => {
  const all = ok(readApplicants(board, { role_id: "role_backend", borderline: true })).applicants;
  const domain = companyDomain("Kestrel Labs");
  const atKestrel = all.filter((a) => a.employer_domain === domain);

  assert.equal(atKestrel.length, 1, "exactly one, or the cross-app beat is ambiguous");
  const found = atKestrel[0]!;
  assert.equal(found.employer, "Kestrel Labs");
  assert.equal(found.employer_domain, "kestrel-labs.example");
  // Pinned to the shared constant, not to a name typed here: the three apps read one source.
  assert.equal(found.name, KESTREL_APPLICANT.name);
  assert.equal(found.email, KESTREL_APPLICANT.email);
  assert.equal(found.borderline, true);
  assert.ok(found.gap, "they are borderline for a reason the app can name");
});

test("nobody else in the whole pipeline works at Kestrel Labs", () => {
  const everyone = board.roles.flatMap((role) => role.columns.flatMap((c) => c.candidates));
  const atKestrel = everyone.filter((c) => c.employer === "Kestrel Labs");
  assert.equal(atKestrel.length, 1, `${atKestrel.map((c) => c.name).join(", ")}`);
  assert.equal(atKestrel[0]!.name, KESTREL_APPLICANT.name);
});

test("the employer is context and never an input: it moves no score and no stage", () => {
  const everyone = board.roles.flatMap((role) => role.columns.flatMap((c) => c.candidates));
  const kestrel = everyone.find((c) => c.employer === "Kestrel Labs")!;
  const rubric = board.roles.find((r) => r.id === "role_backend")!.criteria.map((c) => c.name);
  // No criterion is about where they work, and every score they have points at a quoted sentence
  // from their own application.
  for (const name of rubric) {
    assert.ok(!/employer|company|client|kestrel/i.test(name), `${name} is not about where they work`);
  }
  for (const score of kestrel.scores) {
    for (const quote of score.evidence) {
      assert.ok(
        kestrel.cvText.includes(quote) || kestrel.shortAnswer.includes(quote),
        `${score.name}: the evidence is the applicant's own sentence`,
      );
    }
  }
});

test("read_shortlist is a page: a title, markdown, and the same people as data", () => {
  const result = ok(readShortlist(board, "role_backend"));

  assert.equal(result.title, "Backend Engineer — shortlist");
  assert.ok(result.markdown.startsWith(`# ${result.title}`), "the markdown leads with the title");
  assert.match(result.markdown, /\(showing \d+ of \d+\)/, "bounded, and it says so in the page too");
  assert.equal(result.bounded, `(showing ${result.showing} of ${result.of})`);
  assert.equal(result.applicants.length, result.showing);
  assert.ok(result.applicants.length > 0, "the seed advances somebody, or this asserts nothing");

  for (const applicant of result.applicants) {
    assert.ok(
      ["interview", "offer"].includes(applicant.stage),
      `${applicant.name}: a shortlist is the people who were advanced`,
    );
    assert.ok(applicant.evidence.length > 0, `${applicant.name}: carries quoted evidence`);
    for (const item of applicant.evidence) {
      assert.ok(item.quote.length > 0, `${applicant.name}: ${item.criterion} quotes a sentence`);
      assert.ok(
        result.markdown.includes(item.quote),
        `${applicant.name}: the quote in the data is the quote on the page`,
      );
    }
    assert.ok(result.markdown.includes(applicant.name), "every applicant is named on the page");
    assert.ok(result.markdown.includes(applicant.email), "and addressable from it");
  }
});
