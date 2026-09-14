/**
 * The JS motion scale is an ALIAS of the CSS one, and this is where that is checked.
 *
 * DESIGN-LAW §1.6 says of the `--dk-*` bridge: alias, never fork. The same argument applies to a
 * duration a component animates with, and it applies harder, because the CSS and the JS halves of
 * this direction animate the SAME surface — a card whose hover wash is `--bd-dur-2` and whose
 * entrance is a `motion/react` transition has to agree with itself or the two read as two apps.
 *
 * `components/board/motion.ts` is the one file in the direction where a number may be typed
 * (`design/check-law.mjs` exempts it by name for exactly that reason), which makes it the one file
 * that can drift. So it is not trusted: this test parses `design/hl-scales.css` and asserts every
 * step it declares is the step the module exports. An edit to either side that does not edit the
 * other is a red run rather than a discrepancy somebody notices in a recording.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { DUR, EASE, LAND_MS, STAGGER, ZOOM_MS, secs } from "@/components/board/motion";

const CSS = readFileSync(
  fileURLToPath(new URL("../design/hl-scales.css", import.meta.url)),
  "utf8",
);

const TOKENS = readFileSync(
  fileURLToPath(
    new URL("../components/board/style/base/tokens.css", import.meta.url),
  ),
  "utf8",
);

/** `--name: value;` from the scale sheet. */
function declared(name: string): string {
  const found = CSS.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`))?.[1];
  assert.ok(found, `design/hl-scales.css declares no --${name}`);
  return found.trim();
}

/** `--name: value;` from the direction's own token block. */
function token(name: string): string {
  const found = TOKENS.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`))?.[1];
  assert.ok(found, `style/base/tokens.css declares no --${name}`);
  return found.trim().replace(/\s+/g, " ");
}

test("every duration step is the one design/hl-scales.css declares", () => {
  for (const step of [1, 2, 3, 4, 5, 6] as const) {
    assert.equal(`${DUR[step]}ms`, declared(`hl-dur-${step}`), `--hl-dur-${step}`);
  }
  assert.equal(`${STAGGER}ms`, declared("hl-stagger"));
});

test("every easing curve is the one design/hl-scales.css declares", () => {
  const bezier = (curve: readonly number[]) => `cubic-bezier(${curve.join(", ")})`;
  for (const [name, curve] of Object.entries(EASE)) {
    assert.equal(bezier(curve), declared(`hl-ease-${name}`), `--hl-ease-${name}`);
  }
});

test("the zoom is inside the 400ms a level change is budgeted", () => {
  assert.ok(ZOOM_MS <= 400, `the zoom is ${ZOOM_MS}ms`);
  /* And it is a sum of scale steps rather than a number somebody liked. */
  assert.equal(ZOOM_MS, DUR[3] + DUR[1]);
  assert.equal(secs(ZOOM_MS), ZOOM_MS / 1000);
});

/*
 * The zoom is now spelled TWICE — once in this module, for the echo motion/react
 * animates, and once in `style/base/tokens.css`, for the CSS that sequences the level
 * heading behind it. Two spellings of one clock is exactly the drift this file exists
 * to catch, so the CSS one is asserted to be the same sum rather than trusted to be.
 */
test("the zoom has one spelling in CSS and one in JS, and they are the same sum", () => {
  assert.equal(token("bd-dur-1"), "var(--hl-dur-1)");
  assert.equal(token("bd-dur-3"), "var(--hl-dur-3)");
  assert.equal(token("bd-zoom"), "calc(var(--bd-dur-3) + var(--bd-dur-1))");
  assert.equal(ZOOM_MS, DUR[3] + DUR[1]);
});

test("the heading's beat is half the zoom, taken from the zoom", () => {
  /* Rule 3 for headings: the level's own head waits until the outgoing echo is past
     the middle of its journey. Written as `175ms` it would be a number somebody liked
     and it would not move when the zoom did. */
  assert.equal(token("bd-zoom-half"), "calc(var(--bd-zoom) / 2)");
  assert.ok(ZOOM_MS / 2 + DUR[2] <= DUR[4] + DUR[1], "the head lands within a beat of the zoom");
});

test("the landing light outlives the echo by one step and no more", () => {
  assert.equal(LAND_MS, ZOOM_MS + DUR[3]);
  assert.ok(LAND_MS > ZOOM_MS, "a light that goes out under the echo was never on");
  assert.ok(LAND_MS < DUR[6], "longer than a beat and it reads as a selection");
});
