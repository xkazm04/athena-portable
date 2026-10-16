/**
 * The contrast model and the surface it models are one set of tokens.
 *
 * `design/check-contrast.mjs` promises that "no value is typed here" and that both the tokens and
 * the surfaces are read out of the direction's own `base/tokens.css`. One surface broke that: a
 * carousel card's lightest stop was modelled as `alpha: 0.08`, typed in the checker, while the
 * card itself painted `rgb(255 255 255 / 8%)`, typed in `level1/l1-carousel.css`. Two copies of one
 * value, joined by a comment - so a retuned card would be drawn at one alpha and scored at the
 * other, and the floor the checker reports would be about a card nobody paints.
 *
 * Both stops are tokens now, the stylesheet paints with them and the checker composites the top one
 * by name, which is the gated-mirror floor turned into a single source.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

/** Comments out, so a token named in prose is not read as a use of it. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CHECKER = code(read("design/check-contrast.mjs"));
const CAROUSEL = code(read("components/board/style/level1/l1-carousel.css"));
const TOKENS = code(read("components/board/style/base/tokens.css"));

/** The slide's own frame rule - the one at the start of a line, not a descendant selector. */
function slideBackground(): string {
  const rule = CAROUSEL.match(/^\.bd-slide-inner\s*\{([^}]*)\}/m)?.[1];
  assert.ok(rule, "l1-carousel.css declares no .bd-slide-inner rule");
  const background = rule.match(/\bbackground\s*:\s*([^;]+);/)?.[1];
  assert.ok(background, ".bd-slide-inner paints no background");
  return background;
}

test("the slide's gradient is painted from tokens the token block declares", () => {
  const background = slideBackground();
  assert.doesNotMatch(background, /rgba?\(|#[0-9a-f]{3,8}\b/i, `a colour is typed in the slide: ${background}`);
  const stops = [...background.matchAll(/var\((--bd-[a-z0-9-]+)\)/g)].map((m) => m[1]!);
  assert.equal(stops.length, 2, `two stops, both tokens: ${background}`);
  for (const stop of stops) {
    assert.match(TOKENS, new RegExp(`${stop}\\s*:`), `${stop} is declared in base/tokens.css`);
  }
});

test("the contrast checker composites the slide's top stop by its token, not by a typed alpha", () => {
  const surfaces = CHECKER.match(/const SURFACES = \[([\s\S]*?)\];/)?.[1];
  assert.ok(surfaces, "check-contrast.mjs no longer declares SURFACES");
  assert.doesNotMatch(surfaces, /\balpha\s*:/, "a surface's plane is typed as a number in the checker");
  const top = [...slideBackground().matchAll(/var\((--bd-[a-z0-9-]+)\)/g)][0]?.[1];
  assert.ok(top, "the slide has a top stop");
  assert.ok(surfaces.includes(`"${top}"`), `the checker models ${top}, the stop the slide paints`);
});
