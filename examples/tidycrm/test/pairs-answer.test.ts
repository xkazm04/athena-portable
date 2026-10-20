/**
 * `read_pairs` answers the seeded queue as JSON a caller can parse, at the largest limit it allows.
 *
 * Fifty pairs with their evidence run past the kit's `MAX_RESULT_CHARS`, and the door cut the
 * answer mid-row: the journey's act 3 read the merge queue back as a string and stopped there.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

import { MAX_RESULT_CHARS } from "@athena/demo-kit/webmcp";

tempHome("tidycrm-test-");

const { countOpenPairs, listOpenPairs } = await import("../lib/db");
const { pairsAnswer } = await import("../components/shell/pairs");

test("the largest page the tool allows does not fit the door whole", () => {
  // The premise: without sizing, the cap cuts this answer. If the seed shrinks, this test says so.
  assert.ok(JSON.stringify({ pairs: listOpenPairs(50) }).length > MAX_RESULT_CHARS);
});

test("the answer fits the door, and its footer counts what it carries", () => {
  const total = countOpenPairs();
  const answer = pairsAnswer(listOpenPairs(50), total);
  const text = JSON.stringify(answer);
  assert.ok(text.length <= MAX_RESULT_CHARS, `${text.length} characters`);
  assert.ok(answer.showing > 0, "at least one pair fits");
  assert.equal(answer.pairs.length, answer.showing);
  assert.equal(answer.total, total);
  assert.equal(answer.footer, `(showing ${answer.showing} of ${total})`);
  // Most confident first, as the queue is: the head is kept, not an arbitrary subset.
  assert.deepEqual(
    answer.pairs.map((p) => p.id),
    listOpenPairs(answer.showing).map((p) => p.id),
  );
});

test("a page that fits is handed over as asked", () => {
  const answer = pairsAnswer(listOpenPairs(5), countOpenPairs());
  assert.equal(answer.showing, 5);
});
