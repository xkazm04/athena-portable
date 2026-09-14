/**
 * The direction's clock is the CASCADE now, and this is what still has to be true about it.
 *
 * THE TEST THIS REPLACES, and why it no longer exists. `components/board/motion.ts` used to
 * declare the duration and easing scales in TypeScript, and this file parsed
 * `design/hl-scales.css` to assert the two copies agreed. That was the best answer available
 * while reading the cascade was the app's own problem, and the kit's `zoom/tokens.ts` names what
 * it cost: three round-1 apps wrote three parsers for `"260ms"`, and this one "gave up on reading
 * the cascade and declared the numbers in TypeScript with a test parsing the stylesheet to keep
 * the two in step". A test that keeps two copies honest is a worse answer than one copy, so the
 * copy is gone and `useTokens` reads the tokens.
 *
 * WHAT CAN STILL BE WRONG, which is what is asserted below.
 *
 *   1. A TOKEN NOBODY DECLARES. `useTokens` answers 0 for a name the cascade does not carry, and
 *      0 is the final state — which is correct under reduced motion and is a CUT everywhere
 *      else. Renaming `--bd-dur-3` would therefore turn the signature into a jump with no error
 *      anywhere. So every name `motion.ts` asks for is asserted to be declared.
 *   2. A BROKEN ALIAS. §1 says `--bd-*` are aliases of the `--hl-*` scale and never new numbers.
 *      The chain is checked link by link.
 *   3. A VALUE THE KIT'S PARSER CANNOT READ. `parseMs` is what turns the declaration into the
 *      number the animation runs at, so it is run here against the real declarations rather than
 *      trusted — including `--bd-zoom`, which it deliberately cannot read (see below).
 *   4. THE BUDGETS the round set, recomputed from the cascade instead of from a TS map.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseBezier, parseMs, secs } from "@athena/demo-kit/zoom";

const SCALES = readFileSync(
  fileURLToPath(new URL("../design/hl-scales.css", import.meta.url)),
  "utf8",
);

const TOKENS = readFileSync(
  fileURLToPath(
    new URL("../components/board/style/base/tokens.css", import.meta.url),
  ),
  "utf8",
);

const MOTION = readFileSync(
  fileURLToPath(new URL("../components/board/motion.ts", import.meta.url)),
  "utf8",
);

/** `--name: value;` from a stylesheet, whitespace normalised. */
function declared(css: string, name: string, where: string): string {
  const found = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`))?.[1];
  assert.ok(found, `${where} declares no --${name}`);
  return found.trim().replace(/\s+/g, " ");
}

const scale = (name: string) => declared(SCALES, name, "design/hl-scales.css");
const token = (name: string) => declared(TOKENS, name, "style/base/tokens.css");

/** Every `"--…"` string literal in the direction's TOKENS list — what the JS actually asks for. */
function asked(): string[] {
  const list = MOTION.match(/const TOKENS = \[([\s\S]*?)\] as const;/)?.[1];
  assert.ok(list, "motion.ts no longer declares a TOKENS list");
  return [...list.matchAll(/"(--[a-z0-9-]+)"/g)].map((m) => m[1]!);
}

test("every token the direction animates with is declared in the cascade it ships", () => {
  const names = asked();
  assert.ok(names.length > 0, "motion.ts asks for no tokens at all");
  for (const name of names) {
    const bare = name.slice(2);
    const found = name.startsWith("--hl-")
      ? scale(bare)
      : declared(`${TOKENS}\n${SCALES}`, bare, "the direction's cascade");
    assert.notEqual(found, "", `--${bare} is declared empty`);
  }
});

test("every --bd-* step is an alias of the --hl-* scale, never a new number", () => {
  for (const step of [1, 2, 3, 4] as const) {
    assert.equal(token(`bd-dur-${step}`), `var(--hl-dur-${step})`);
  }
  assert.equal(token("bd-ease"), "var(--hl-ease-standard)");
  assert.equal(token("bd-ease-in"), "var(--hl-ease-entrance)");
  assert.equal(token("bd-ease-out"), "var(--hl-ease-exit)");
});

test("the kit's parser reads this app's scale", () => {
  const steps = [90, 160, 260, 420, 700, 1200];
  steps.forEach((ms, i) => {
    assert.equal(parseMs(scale(`hl-dur-${i + 1}`), -1), ms, `--hl-dur-${i + 1}`);
  });
  assert.equal(parseMs(scale("hl-stagger"), -1), 40);
  /* A curve is four numbers to motion, and the kit is what turns the declaration into them. */
  assert.deepEqual(parseBezier(scale("hl-ease-standard")), [0.2, 0, 0, 1]);
  assert.deepEqual(parseBezier(scale("hl-ease-exit")), [0.3, 0, 0.8, 0.15]);
});

test("the zoom is a sum of two steps, and inside the 400ms a level change is budgeted", () => {
  const d1 = parseMs(scale("hl-dur-1"));
  const d3 = parseMs(scale("hl-dur-3"));
  const zoomMs = d3 + d1;
  assert.ok(zoomMs <= 400, `the zoom is ${zoomMs}ms`);
  /* The CSS says the same sum in its own spelling, for the parts of the gesture that are
     sequenced in the stylesheet rather than animated in JS. Two spellings of one clock is the
     drift this file exists to catch. */
  assert.equal(token("bd-zoom"), "calc(var(--bd-dur-3) + var(--bd-dur-1))");
  assert.equal(secs(zoomMs), zoomMs / 1000);
});

test("--bd-zoom is not readable as a duration, which is why motion.ts does the sum itself", () => {
  /* A custom property that is not registered with `@property` keeps its `calc(...)` through
     computed style. This is the reason `motion.ts` asks for the two steps rather than the sum,
     and the reason `Board.tsx`'s flight fallback names `--bd-dur-4`; if CSS ever resolves it,
     this assertion fails and both comments can go. */
  assert.equal(parseMs(token("bd-zoom"), -1), -1);
  assert.equal(parseMs(token("bd-dur-4"), -1), -1, "an alias is unresolved outside a browser too");
});

test("the heading's beat is half the zoom, taken from the zoom", () => {
  /* Rule 3 for headings: the level's own head waits until the outgoing echo is past the middle
     of its journey. Written as `175ms` it would be a number somebody liked and it would not move
     when the zoom did. */
  assert.equal(token("bd-zoom-half"), "calc(var(--bd-zoom) / 2)");
  const zoomMs = parseMs(scale("hl-dur-3")) + parseMs(scale("hl-dur-1"));
  assert.ok(
    zoomMs / 2 + parseMs(scale("hl-dur-2")) <= parseMs(scale("hl-dur-4")) + parseMs(scale("hl-dur-1")),
    "the head lands within a beat of the zoom",
  );
});

test("the landing light outlives the echo by one step and no more", () => {
  const d3 = parseMs(scale("hl-dur-3"));
  const zoomMs = d3 + parseMs(scale("hl-dur-1"));
  const landMs = zoomMs + d3;
  assert.ok(landMs > zoomMs, "a light that goes out under the echo was never on");
  assert.ok(landMs < parseMs(scale("hl-dur-6")), "longer than a beat and it reads as a selection");
});

test("no millisecond is typed in the direction's TypeScript any more", () => {
  /* `design/check-law.mjs` exempts `motion.ts` by name so that geometry — a throw's off-table
     distance, a scale ratio — can be written somewhere. That exemption used to cover the whole
     duration scale as well. It does not any more, and this is what says so. */
  const code = MOTION.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\b(duration|delay|delayChildren|staggerChildren)\s*:\s*-?\d*\.?\d+\b(?!\s*\})/, code.match(/.*\b(duration|delay)\s*:\s*\d.*/)?.[0] ?? "");
  assert.doesNotMatch(code, /\bcubic-bezier\(/);
  assert.doesNotMatch(code, /\b\d+ms\b/);
});
