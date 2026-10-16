/**
 * THE LANE SHEET'S CONTROLS SAY WHAT THEY ARE — WCAG 4.1.2 (name, role, value), read off the source.
 *
 * `node --test` strips TypeScript and not JSX, so `Chrome.tsx` cannot be rendered here. What can be
 * checked is the source of each control's opening tag, found by the class name that styles it
 * (comments stripped first, so prose that mentions an attribute cannot satisfy the check). The
 * state each control shows by colour (`data-on`) has to reach a screen reader too, and a button
 * whose visible text is a readout has to be named for what pressing it does.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SOURCE = readFileSync(
  new URL("../components/atlas/variants/archify-lanes/Chrome.tsx", import.meta.url),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Every `<button …>` opening tag, read to its closing `>` at brace depth 0. */
function buttons(source: string): string[] {
  const out: string[] = [];
  let at = source.indexOf("<button");
  while (at !== -1) {
    let depth = 0;
    let i = at;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
    }
    out.push(source.slice(at, i + 1));
    at = source.indexOf("<button", i);
  }
  return out;
}

const BUTTONS = buttons(SOURCE);
const byOnClick = (handler: RegExp): string => {
  const hit = BUTTONS.filter((b) => handler.test(b));
  assert.equal(hit.length, 1, `expected one button matching ${handler}, found ${hit.length}`);
  return hit[0]!;
};

test("the instrument finds the controls", () => {
  assert.ok(BUTTONS.length >= 8, `only ${BUTTONS.length} buttons found in Chrome.tsx`);
  assert.equal(buttons(`<button a={() => b > c} data-x>t</button>`)[0], "<button a={() => b > c} data-x>");
});

test("TURN says whether the turn is being told, not only in colour", () => {
  assert.match(byOnClick(/onClick=\{onStory\}/), /aria-pressed=\{story\}/);
});

test("the chapter strip says which chapter the story is in", () => {
  assert.match(byOnClick(/al-story-chapter"/), /aria-current=/);
});

test("the home control is named for what it does, and keeps its readout in the name", () => {
  const home = byOnClick(/onClick=\{onHome\}/);
  assert.match(home, /aria-label=\{`Home[^`]*\$\{/, "the home button is named only by its readout");
});

test("the theme control is named for what it does, and keeps its visible word in the name", () => {
  const theme = byOnClick(/onClick=\{onTheme\}/);
  assert.match(theme, /aria-label=/, "the theme button is named only by the theme it is in");
});
