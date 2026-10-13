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

test("every vs- class the module's stylesheet styles is written by a component", () => {
  const code = sources();
  const classes = new Set(Array.from(css.matchAll(/\.(vs-[a-z]+(?:__[a-z]+)?)/g), (m) => m[1]!));
  expect(classes.size).toBeGreaterThan(8);
  const dead = [...classes].filter((name) => !code.includes(name));
  expect(dead).toEqual([]);
});
