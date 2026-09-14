/**
 * The arrival's numbers are written down twice and have to agree.
 *
 * `components/blocks/beats.ts` is the source: the clock imports it and the cost
 * `open_group` advertises is derived from it. The stylesheet cannot import a
 * module, so `style/base/tokens.css` carries a copy — and a copy with nothing
 * checking it is how the move ended up with a clock saying 1960ms, tokens saying
 * something else and a tool telling agents 2900ms.
 *
 * This reads the token file and fails on any drift, and then checks the four
 * things the budget has to be true about rather than the numbers themselves:
 * order, fit, and the total it promises.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const beats = await import("../components/blocks/beats");

const TOKENS = readFileSync(
  fileURLToPath(new URL("../components/blocks/style/base/tokens.css", import.meta.url)),
  "utf8",
);

/** One `--bk-*: NNNms;` declaration, read out of the token file. */
function token(name: string): number {
  const match = new RegExp(`--${name}:\\s*(\\d+)ms;`).exec(TOKENS);
  assert.ok(match, `tokens.css declares no --${name} in milliseconds`);
  return Number(match[1]);
}

/** Every token that mirrors an export of `beats.ts`, and the export it mirrors. */
const MIRRORED: ReadonlyArray<[string, number]> = [
  ["bk-beat-spread", beats.SPREAD_TRANSITION],
  ["bk-beat-dress", beats.DRESS_TRANSITION],
  ["bk-beat-dress-text", beats.DRESS_TEXT_TRANSITION],
  ["bk-stagger", beats.STAGGER],
  ["bk-stagger-tight", beats.STAGGER_TIGHT],
  ["bk-dress-name", beats.DRESS_NAME],
  ["bk-dress-figures", beats.DRESS_FIGURES],
];

test("every --bk-beat-* token is the value beats.ts decided", () => {
  for (const [name, expected] of MIRRORED) {
    assert.equal(token(name), expected, `--${name}`);
  }
});

test("the last cell's travel finishes inside the beats it is given", () => {
  // A cell starts moving at `LAND` and is staggered by its index. The grid must
  // be still by the time the clock calls the move settled, or `settled` is a
  // claim about something that is still moving — and `settled` is what hands out
  // the shared-layout ids the L1 -> L2 morph runs on.
  const last = (beats.WIDEST_ZONE - 1) * beats.STAGGER_TIGHT + beats.SPREAD_TRANSITION;
  assert.ok(last <= beats.SPREAD + beats.DRESS, `travel ${last}ms overruns its window`);
});

test("the last cell's dressing finishes inside the dress beat", () => {
  const cell = beats.WIDEST_ZONE - 1;
  const ground = cell * beats.STAGGER + beats.DRESS_TRANSITION;
  const name = cell * beats.STAGGER + beats.DRESS_NAME + beats.DRESS_TEXT_TRANSITION;
  const figures = cell * beats.STAGGER + beats.DRESS_FIGURES + beats.DRESS_TEXT_TRANSITION;
  for (const [what, ms] of [["ground", ground], ["name", name], ["figures", figures]] as const) {
    assert.ok(ms <= beats.DRESS, `${what} takes ${ms}ms of a ${beats.DRESS}ms beat`);
  }
});

test("the beats keep their order, and overlap rather than queue", () => {
  // `dress` begins as the FIRST cells land, not after the last one — that
  // overlap is where the two seconds went. It may not begin BEFORE them, or the
  // blocks acquire their names while they are still travelling, which is the
  // one thing the named beats exist to prevent.
  assert.ok(beats.LAND > 0, "a cell has to be painted on the canvas before it moves");
  assert.ok(beats.SPREAD < beats.SPREAD_TRANSITION, "dress waits for the whole travel");
  assert.ok(
    beats.SPREAD + beats.STAGGER_TIGHT >= beats.SPREAD_TRANSITION / 2,
    "dress starts before the blocks are halfway",
  );
});

test("the whole move is about a second and a fifth, and says so once", () => {
  assert.equal(beats.BEATS, beats.LAND + beats.SPREAD + beats.DRESS);
  assert.equal(beats.ARRIVAL_MS, beats.FLATTEN + beats.BEATS + beats.SETTLE_PAD);
  assert.ok(beats.ARRIVAL_MS <= 1300, `the arrival costs ${beats.ARRIVAL_MS}ms`);
  assert.ok(beats.ARRIVAL_MS >= 900, "a move nobody can follow is a cut");
});

test("the advertised cost is the derived one, not a number typed in the tool", () => {
  const tools = readFileSync(
    fileURLToPath(new URL("../components/blocks/tools/BlocksTools.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(tools, /import \{ ARRIVAL_MS \} from "\.\.\/beats"/);
  assert.doesNotMatch(tools, /const ARRIVAL_MS\s*=/);
});
