/**
 * The arrival's numbers are written down twice and have to agree.
 *
 * `components/blocks/beats.ts` is the source: the clock imports it, the camera
 * rig flies on the token that mirrors it, and the cost `open_group` advertises
 * is derived from it. The stylesheet cannot import a module, so
 * `style/base/tokens.css` carries a copy — and a copy with nothing checking it
 * is how round 1's move ended up with a clock saying 1960 ms, tokens saying
 * something else and a tool telling agents 2900.
 *
 * ROUND 3 CUT THE MOVE FROM FOUR BEATS TO TWO, which is why this file lost
 * three assertions. `flatten`, `land` and `spread` all existed to hide the
 * hand-off between a WebGL L0 and a DOM L1; L0 and L1 are the same scene at two
 * camera distances now, so there is no hand-off and nothing travels. What is
 * left is `flight` (the camera) and `dress` (the ink), and the checks below are
 * the three things that can still be wrong about them: drift from the tokens,
 * a dressing wave that overruns its own beat, and a total that is either too
 * long to sit through or too short to follow.
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
  // `--bk-beat-flight` is the one the CAMERA reads: the rig is given it as its
  // `flyToken`, so the flight's length is the cascade's and never a number
  // typed at a hook. It is the sharpest version of rule 4 this repo has.
  ["bk-beat-flight", beats.FLIGHT],
  ["bk-beat-dress", beats.DRESS_TRANSITION],
  ["bk-beat-dress-text", beats.DRESS_TEXT_TRANSITION],
  ["bk-stagger", beats.STAGGER],
  ["bk-dress-name", beats.DRESS_NAME],
  ["bk-dress-figures", beats.DRESS_FIGURES],
];

test("every --bk-beat-* token is the value beats.ts decided", () => {
  for (const [name, expected] of MIRRORED) {
    assert.equal(token(name), expected, `--${name}`);
  }
});

test("the beats that were deleted are gone from the tokens too", () => {
  // The hand-off's three beats. A token that outlived the thing it timed is a
  // number the next reader will try to tune.
  for (const dead of ["bk-beat-flatten", "bk-beat-spread", "bk-stagger-tight"]) {
    assert.doesNotMatch(TOKENS, new RegExp(`--${dead}:`), `--${dead} is still declared`);
  }
});

test("the last card's dressing finishes inside the dress beat", () => {
  const card = beats.WIDEST_DATABASE - 1;
  const cluster = card * beats.STAGGER + beats.DRESS_TEXT_TRANSITION;
  const name = card * beats.STAGGER + beats.DRESS_NAME + beats.DRESS_TEXT_TRANSITION;
  const figures = card * beats.STAGGER + beats.DRESS_FIGURES + beats.DRESS_TEXT_TRANSITION;
  for (const [what, ms] of [
    ["cluster", cluster],
    ["name", name],
    ["figures", figures],
  ] as const) {
    assert.ok(ms <= beats.DRESS, `${what} takes ${ms}ms of a ${beats.DRESS}ms beat`);
  }
});

test("the parts of a card arrive in the order the beat claims", () => {
  // The dots were already in the picture — a table was one mark in a lattice —
  // so they are what the level arrives holding; the words are what only this
  // depth has. Anything else and the beat is a fade rather than a dressing.
  assert.ok(beats.DRESS_NAME > 0, "the name waits for the cluster");
  assert.ok(beats.DRESS_FIGURES > beats.DRESS_NAME, "the figures wait for the name");
});

test("the flight is longer than a DOM level change and shorter than a wait", () => {
  // The formula's guardrail: a DOM level change is capped at 400ms, and "a
  // canvas arrival may stage longer but must be abortable". A camera crossing
  // eight world units while turning to face a corner is not a DOM fade.
  assert.ok(beats.FLIGHT > 400, "a camera move nobody can follow is a cut");
  assert.ok(beats.FLIGHT <= 800, `the flight costs ${beats.FLIGHT}ms`);
});

test("the whole move is about a second, and says so once", () => {
  assert.equal(beats.ARRIVAL_MS, beats.FLIGHT + beats.DRESS + beats.SETTLE_PAD);
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

test("the camera flies on the token, not on a number", () => {
  // Rule 4, at its sharpest: the rig is handed the CSS custom property and
  // reads the duration out of the cascade. Nothing in the app types 620.
  const blocks = readFileSync(
    fileURLToPath(new URL("../components/blocks/Blocks.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(blocks, /flyToken: "--bk-beat-flight"/);
});
