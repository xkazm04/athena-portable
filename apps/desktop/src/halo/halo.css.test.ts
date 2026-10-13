/** The halo stylesheet's rules — ADR 0027 (Athena is ambient), README section 3.1. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./halo.css", import.meta.url), "utf8");

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const head = "\n" + selector + " {";
  const at = css.indexOf(head);
  if (at === -1) throw new Error(`no rule ${selector}`);
  return css.slice(at, css.indexOf("\n}", at));
}

test("the halo page does not load the app's sheet, so every custom property it reads it also defines", () => {
  const defined = new Set([...css.matchAll(/(--[a-z][\w-]*)\s*:/g)].map((m) => m[1]));
  const read = [...css.matchAll(/var\((--[a-z][\w-]*)/g)].map((m) => m[1]);
  expect(read.length).toBeGreaterThan(0);
  for (const name of read) expect(defined.has(name), name).toBe(true);
});

test("the caption's who-label is a spelled size of at least 12px, not a step from a sheet the page lacks", () => {
  const size = rule(".caption .who").match(/font-size:\s*(\d+)px/);
  expect(size).not.toBeNull();
  expect(Number(size![1])).toBeGreaterThanOrEqual(12);
});
