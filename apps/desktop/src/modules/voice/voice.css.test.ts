/** The module's stylesheet — README section 3.1, ADR 0028 and 0087: it styles only what is drawn. */
import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./voice.css", import.meta.url), "utf8");

/** Every component source that can write a `vs-` class: the module's and the scene's. */
function sources(): string {
  const dirs = [new URL("./", import.meta.url), new URL("../../scenes/voice/", import.meta.url)];
  return dirs
    .flatMap((dir) => readdirSync(dir).map((name) => ({ dir, name })))
    .filter(({ name }) => /\.tsx$/.test(name) && !/\.test\./.test(name))
    .map(({ dir, name }) => readFileSync(new URL(name, dir), "utf8"))
    .join("\n");
}

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const head = "\n" + selector + " {";
  const at = css.indexOf(head);
  if (at === -1) throw new Error(`no rule ${selector}`);
  return css.slice(at, css.indexOf("\n}", at));
}

test("every vs- class the module's stylesheet styles is written by a component", () => {
  const code = sources();
  const classes = new Set(Array.from(css.matchAll(/\.(vs-[a-z]+(?:__[a-z]+)?)/g), (m) => m[1]!));
  expect(classes.size).toBeGreaterThan(8);
  const dead = [...classes].filter((name) => !code.includes(name));
  expect(dead).toEqual([]);
});

test("a key chip on a primary button is set in the button's own ink, which clears contrast in both themes", () => {
  const chip = rule(".btn--primary .vs-kbd");
  expect(chip).toMatch(/color:\s*var\(--primary-fg\)/);
  expect(chip).not.toMatch(/--on-primary/);
});

test("the install bar fills by scale, not width, and stills under Calm", () => {
  const fill = rule(".vs-progress > span");
  expect(fill).toMatch(/transition:\s*transform/);
  expect(fill).not.toMatch(/width\s+0|transition:\s*width/);
  expect(css).toMatch(/:root\[data-motion="calm"\] \.vs-progress > span \{\s*transition: none/);
});
