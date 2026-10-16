/**
 * The foot's AUTO band says what its tools do, counted from the manifest.
 *
 * It read "Auto — reversible, and each writes an undo" over every AUTO tool on the route - thirteen,
 * of which four write app data and log an undo (`score_against_rubric`, `add_note`, `move_stage`,
 * `propose_slots`) and nine only read or move the view. A capability claim a reader trusts and
 * cannot check is the costliest kind of wrong sentence. The band is `AUTO_BAND` now, built from the
 * same rows as the count beside it, and the foot prints it rather than typing one.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const { CAPABILITIES, isAuto } = await import("../lib/manifest");
const { AUTO_BAND, CAPABILITY_COUNTS, REGISTER, autoBand } = await import("../components/board/register");

const FOOT = readFileSync(
  fileURLToPath(new URL("../components/board/shell/Foot.tsx", import.meta.url)),
  "utf8",
)
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");

test("the AUTO counts split into the tools that write and the tools that only read", () => {
  const auto = CAPABILITIES.filter((c) => isAuto(c));
  assert.equal(CAPABILITY_COUNTS.auto, auto.length);
  assert.equal(CAPABILITY_COUNTS.autoWrites, auto.filter((c) => c.sideEffects === "data").length);
  assert.equal(CAPABILITY_COUNTS.autoReads, auto.filter((c) => c.sideEffects === "none").length);
  assert.equal(CAPABILITY_COUNTS.autoReads + CAPABILITY_COUNTS.autoWrites, CAPABILITY_COUNTS.auto);
  assert.ok(CAPABILITY_COUNTS.autoReads > 0 && CAPABILITY_COUNTS.autoWrites > 0, "both kinds exist on this route");
  assert.equal(REGISTER.length, CAPABILITIES.length);
});

test("the band names both counts, and claims an undo only for the writes", () => {
  assert.equal(
    AUTO_BAND,
    `Auto — reversible: ${CAPABILITY_COUNTS.autoReads} read or move the view; ${CAPABILITY_COUNTS.autoWrites} write, and each logs an undo`,
  );
  assert.equal(autoBand({ autoReads: 0, autoWrites: 1 }), "Auto — reversible: 1 writes, and logs an undo");
  assert.equal(autoBand({ autoReads: 2, autoWrites: 0 }), "Auto — reversible: 2 read or move the view");
});

test("the foot prints the derived band and types no undo claim of its own", () => {
  assert.match(FOOT, /\{AUTO_BAND\}/, "Foot.tsx renders AUTO_BAND");
  assert.doesNotMatch(FOOT, /each writes an undo/i, "Foot.tsx still types the old claim");
});
