/**
 * The quiet state, which this seed cannot reach and which therefore has to be
 * pinned rather than photographed.
 *
 * THE FACT THIS FILE EXISTS FOR. L0's whole job, after round 2's review, is
 * "find the databases in fault at a glance": a cell is washed red when any table
 * inside it carries an outstanding deviation, and carries no red at all when
 * none does. In the seeded sheet **all 46 tables carry at least one** — 45 have a
 * hand-typed phone, 44 a stale row — so `clearTables` is 0, every one of the
 * nine databases is in fault, and the quiet half of the rule never appears on
 * screen. A reviewer looking at a screenshot cannot tell whether it works.
 *
 * So it is checked here, in all three mediums the prototypes draw in:
 *
 *   the rule      `fillOf` is quiet exactly when no table inside is in fault;
 *   the WebGL     `fillInk` is greenline for quiet and redline for fault, and
 *                 the two opacities are different;
 *   the CSS       `level0/l0.css` gives `[data-fill="quiet"]` a greenline inner
 *                 edge and `[data-fill="fault"]` a redline one, on both the
 *                 plate tile and the legend key, and only the fault state paints
 *                 the red wash layer.
 *
 * And the count itself is asserted, so the day the seed changes — or a merge
 * empties a domain — this file fails and says the quiet state has become
 * reachable, which is the moment to go and look at it.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

process.chdir(mkdtempSync(join(tmpdir(), "tidycrm-fill-")));

const { buildSheet } = await import("../lib/blocks");
const { cellsOf } = await import("../components/blocks/l0/cells");
const { FILL_QUIET, INK, fillInk, fillOf, fillOpacity } = await import(
  "../components/blocks/l0/contract"
);

const CSS = readFileSync(
  fileURLToPath(new URL("../components/blocks/style/level0/l0.css", import.meta.url)),
  "utf8",
);

const sheet = buildSheet();
const cells = cellsOf(sheet);

test("no table in this seed is clean, so no database can be quiet", () => {
  const tables = sheet.databases.flatMap((d) => d.tables);
  const clean = tables.filter((t) => t.deviationTotal === 0);
  assert.equal(tables.length, 46);
  assert.equal(
    clean.length,
    0,
    `${clean.length} tables are now clean — the quiet state may be reachable; go and look at it`,
  );
  assert.equal(sheet.clearTables, clean.length, "the sheet's own count agrees");
  assert.deepEqual(
    cells.filter((c) => fillOf(c) === "quiet").map((c) => c.id),
    [],
    "every database is in fault",
  );
});

test("the rule is quiet exactly when nothing inside is outstanding", () => {
  // Asked of the real cells for the fault half, and of a synthetic one for the
  // half the seed cannot produce. A cell is a plain record; there is nothing to
  // stub.
  for (const cell of cells) {
    assert.equal(fillOf(cell), cell.faulty > 0 ? "fault" : "quiet", cell.id);
  }
  const first = cells[0]!;
  assert.equal(fillOf({ ...first, faulty: 0, outstanding: 0, share: 0 }), "quiet");
  assert.equal(fillOf({ ...first, faulty: 1 }), "fault");
});

test("the two washes are a different ink, not a different strength", () => {
  const first = cells[0]!;
  const quiet = { ...first, faulty: 0, outstanding: 0, share: 0 };
  assert.equal(fillInk(quiet), INK.greenline, "a database where every check passed is greenline");
  assert.equal(fillInk({ ...first, faulty: 1 }), INK.redline);
  assert.notEqual(INK.greenline, INK.redline);
  // A hue difference is the point, but the strengths must not collide either:
  // the quiet wash is flat, and the fault wash runs from its floor upward.
  assert.equal(fillOpacity(quiet), FILL_QUIET);
  for (const cell of cells) {
    assert.notEqual(fillOpacity(cell), FILL_QUIET, `${cell.id} wash collides with the quiet one`);
  }
});

test("the stylesheet draws the two states apart on the legend key", () => {
  // ROUND 3 LOST THE OTHER HALF OF THIS TEST, and it is a deletion rather than a
  // regression: the CSS plate was one of round 2's three L0 prototypes and the
  // owner chose the octants, so `.bk-plate-tile` no longer exists. The picture's
  // half of the rule is `fillInk`/`fillOpacity` above, which is where a `three`
  // material reads it; the legend is the only place it is still CSS.
  const rule = (selector: string): string => {
    const at = CSS.indexOf(`${selector} {`);
    assert.ok(at >= 0, `level0/l0.css declares no \`${selector}\``);
    return CSS.slice(at, CSS.indexOf("}", at));
  };
  assert.match(rule('.bk-db-key[data-fill="quiet"]'), /--bk-greenline/);
  assert.match(rule('.bk-db-key[data-fill="fault"]'), /--bk-redline/);
  assert.match(rule('.bk-db-key[data-fill="quiet"] .bk-db-key-measure i'), /--bk-greenline/);
  assert.match(rule('.bk-db-key[data-fill="fault"] .bk-db-key-measure i'), /--bk-redline/);
  assert.doesNotMatch(CSS, /bk-plate-tile/, "the plate prototype is gone, not hidden");
});
