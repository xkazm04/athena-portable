// One truncation envelope for every WebMCP tool result.
//
// AGENTS.md: any bounded output carries `(showing N of M)`. What a tool result carries is the
// machine-readable half of that sentence, and it has to be the SAME half everywhere or the one
// question it exists to answer - how many did I not see - needs a parser per app.

import assert from "node:assert/strict";
import { test } from "node:test";

import { PAGE, bounded, boundedPage } from "../src/webmcp/bounded.ts";

const rows = Array.from({ length: 22 }, (_, i) => ({ id: `r${i}` }));

test("showing and of are counts, and their difference is what was left out", () => {
  const out = bounded(rows, 5);
  assert.equal(out.showing, 5);
  assert.equal(out.of, 22);
  assert.equal(out.items.length, 5);
  assert.equal(out.of - out.showing, 17);
});

test("a complete list still says so, rather than saying nothing", () => {
  const out = bounded(rows, 40);
  assert.equal(out.showing, 22);
  assert.equal(out.of, 22);
  assert.equal(out.of - out.showing, 0);
});

test("the default page is the kit's, and an empty list is a valid envelope", () => {
  assert.equal(PAGE, 40);
  assert.equal(bounded(rows).showing, 22);
  assert.deepEqual(bounded([]), { showing: 0, of: 0, items: [] });
});

test("a projection is applied to the kept items only", () => {
  const out = bounded(rows, 3, (r) => r.id);
  assert.deepEqual(out.items, ["r0", "r1", "r2"]);
  assert.equal(out.of, 22);
});

test("the source list is never mutated and never aliased", () => {
  const source = [1, 2, 3];
  const out = bounded(source);
  out.items.push(4);
  assert.deepEqual(source, [1, 2, 3]);
});

test("a page carries the same three keys plus which page it is", () => {
  const p1 = boundedPage(rows, 1, 5);
  assert.equal(p1.page, 1);
  assert.equal(p1.showing, 5);
  assert.equal(p1.of, 22);
  assert.deepEqual(p1.items[0], { id: "r5" });

  const last = boundedPage(rows, 4, 5);
  assert.equal(last.showing, 2, "the short last page reports what it actually holds");
  assert.equal(last.of, 22);

  const past = boundedPage(rows, 9, 5);
  assert.equal(past.showing, 0);
  assert.equal(past.of, 22, "past the end still says how many there were");
});

test("a junk page argument lands on page zero rather than throwing", () => {
  // The argument comes off a tool call, so it is whatever the model sent.
  for (const junk of [Number.NaN, -3, 0.7]) {
    assert.equal(boundedPage(rows, junk, 5).page, 0);
  }
});
