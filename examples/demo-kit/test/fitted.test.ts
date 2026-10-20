// A list answer sized to the door's cap, so it still parses when the list is long.
//
// The door cuts any result past MAX_RESULT_CHARS mid-text. For a JSON page that cut is a string
// the caller cannot read, and the `(showing N of M)` it was promised goes with the tail.
import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_RESULT_CHARS, fitted, runTool } from "../src/webmcp/door.ts";

const rows = Array.from({ length: 50 }, (_, i) => ({ id: `pair_${i}`, evidence: "e".repeat(600) }));
const page = (n: number) => ({ items: rows.slice(0, n), showing: n, of: rows.length });
const schema = { type: "object", properties: {} };

test("the whole page past the cap is what the door would cut into a string", async () => {
  const out = await runTool(schema, {}, () => page(rows.length));
  assert.throws(() => JSON.parse(out), "the cut answer does not parse");
});

test("a fitted page passes the door whole, and its count is the count it carries", async () => {
  const out = await runTool(schema, {}, () => fitted(rows.length, page));
  const parsed = JSON.parse(out) as ReturnType<typeof page>;
  assert.ok(out.length <= MAX_RESULT_CHARS);
  assert.ok(parsed.showing > 0 && parsed.showing < rows.length);
  assert.equal(parsed.items.length, parsed.showing);
  assert.equal(parsed.of, rows.length);
  // The longest head that fits: one more row would not.
  assert.ok(JSON.stringify(page(parsed.showing + 1)).length > MAX_RESULT_CHARS);
});

test("a page that fits is returned as asked", () => {
  assert.equal(fitted(3, page).showing, 3);
});

test("when not even one item fits, the envelope is empty and still says how many there were", () => {
  const out = fitted(rows.length, page, 100);
  assert.equal(out.showing, 0);
  assert.equal(out.of, rows.length);
});
