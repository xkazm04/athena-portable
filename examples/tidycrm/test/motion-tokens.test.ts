/**
 * The morph's durations are READ from the cascade, so the reading has to work.
 *
 * `motion-tokens.ts` is the one place in the direction where a `--bk-*` value
 * crosses into script: `motion`'s shared-layout morph measures two boxes and
 * interpolates in JS, which no stylesheet can do, and the app's law is that no
 * duration or easing is typed anywhere.
 *
 * THE PARSING IS THE KIT'S as of the consolidation round (`@athena/demo-kit/zoom`,
 * formula §1 rule 4), and it is pinned there. What is still this direction's, and
 * therefore still pinned here, is WHICH tokens the morph is made of, that they
 * are the values `style/base/tokens.css` actually declares, and the one delay
 * derived from two of them. The stub below answers out of the token file itself,
 * so the check is against the cascade and not against a second copy of it.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const { readTokens } = await import("@athena/demo-kit/zoom");
const { MOTION_TOKENS, motionFrom } = await import("../components/blocks/motion-tokens");

/** The four tokens as the kit reads them, off whatever style source is given. */
const read = (style: { getPropertyValue: (p: string) => string }) =>
  motionFrom(readTokens(MOTION_TOKENS, style));

const TOKENS = readFileSync(
  fileURLToPath(new URL("../components/blocks/style/base/tokens.css", import.meta.url)),
  "utf8",
);

/** `getComputedStyle`'s one method, answered out of the token file itself. */
function declared(): { getPropertyValue: (property: string) => string } {
  return {
    getPropertyValue: (property: string) => {
      const match = new RegExp(`${property}:\\s*([^;]+);`).exec(TOKENS);
      return match ? match[1]!.trim() : "";
    },
  };
}

test("the direction's own token values parse", () => {
  const tokens = read(declared());
  assert.ok(tokens, "tokens.css declares a --bk-dur-* or --bk-ease this cannot read");
  // Milliseconds in CSS, seconds in `motion`. A morph mis-read by a factor of a
  // thousand is either instantaneous or seven minutes long, and both have
  // shipped in somebody's app.
  assert.equal(tokens.morph.duration, 0.42);
  assert.equal(tokens.medium.duration, 0.26);
  assert.equal(tokens.quick.duration, 0.16);
  assert.deepEqual(tokens.morph.ease, [0.2, 0, 0, 1]);
});

test("the body is held until the box has all but landed", () => {
  const tokens = read(declared());
  assert.ok(tokens);
  assert.ok(
    tokens.body.delay! > tokens.morph.duration / 2,
    "the fill starts while the block is still travelling",
  );
  assert.ok(tokens.body.delay! <= tokens.morph.duration, "the fill starts after the move is over");
});

test("a stylesheet that declares none of it reports that, rather than guessing", () => {
  // The fallback is `null`, not an invented number: a constant here would be the
  // second copy of --bk-dur-4 the module exists to avoid.
  assert.equal(read({ getPropertyValue: () => "" }), null);
  assert.equal(read({ getPropertyValue: () => "ease-in-out" }), null);
});

test("both CSS time units are understood", () => {
  const seconds = read({
    getPropertyValue: (p) =>
      p === "--bk-ease" ? "cubic-bezier(0.2, 0, 0, 1)" : p === "--bk-dur-4" ? "0.5s" : "0.25s",
  });
  assert.ok(seconds);
  assert.equal(seconds.morph.duration, 0.5);
});
