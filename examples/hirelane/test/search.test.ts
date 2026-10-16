/**
 * `search_candidates`, held to the rules its own description makes to an agent.
 *
 * The tool says three things a browser agent will act on: a score filter matches only candidates
 * somebody has actually scored, an employer matches by name or by domain, and an unknown role is
 * refused with the roles that exist. `searchBoard` is a pure function over the board payload, and
 * until this file nothing ran it: the design law's first rule - an unscored application has no
 * score, and is never a zero - had no test on the one tool that filters by score.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("hirelane-search-test-");

const { KESTREL_APPLICANT, companyDomain } = await import("@athena/demo-kit/seed");
const { buildBoard } = await import("../lib/board");
const { SEARCH_PAGE, searchBoard } = await import("../components/board/tools/search");

const board = buildBoard();
const everyone = board.roles.flatMap((r) => r.columns.flatMap((c) => c.candidates));
const unscored = new Set(everyone.filter((c) => !c.scored).map((c) => c.id));

test("the seed has scored and unscored people, or the score rules assert nothing", () => {
  assert.ok(unscored.size > 0 && unscored.size < everyone.length);
});

test("a score ceiling never sweeps in an unscored application, and says so", () => {
  const result = searchBoard(board, { scored_at_most: 4 });
  assert.ok(result.items.length > 0);
  for (const item of result.items) assert.equal(item.scored, true, `${item.name}: scored`);
  assert.equal(result.of, everyone.length - unscored.size, "every scored person, and only them");
  assert.match(String((result as { note?: string }).note), /only candidates somebody has actually scored/);
});

test("a score floor of zero is every scored person, not everyone", () => {
  const result = searchBoard(board, { scored_at_least: 0 });
  assert.equal(result.of, everyone.length - unscored.size);
});

test("without a score filter there is no note, and the scored come first", () => {
  const result = searchBoard(board, {});
  assert.equal("note" in result, false);
  assert.equal(result.of, everyone.length);
  assert.equal(result.showing, Math.min(SEARCH_PAGE, everyone.length), "bounded, and it says by how much");
  const flags = result.items.map((i) => i.scored);
  assert.deepEqual(flags, [...flags].sort((a, b) => Number(b) - Number(a)), "no unscored before a scored one");
});

test("an employer is found by its name and by its domain, the cross-app key", () => {
  const byName = searchBoard(board, { employer: "Kestrel Labs" });
  const byDomain = searchBoard(board, { employer: companyDomain("Kestrel Labs") });
  assert.deepEqual(byName.items.map((i) => i.name), [KESTREL_APPLICANT.name]);
  assert.deepEqual(byDomain.items.map((i) => i.name), [KESTREL_APPLICANT.name]);
});

test("an unknown role is refused with the roles that exist, not answered with nobody", () => {
  const result = searchBoard(board, { role: "role_nope" });
  assert.equal(result.of, 0);
  assert.match(String((result as { error?: string }).error), /No role with id role_nope/);
  assert.deepEqual(
    (result as { roles?: { id: string }[] }).roles?.map((r) => r.id),
    board.roles.map((r) => r.id),
  );
});
