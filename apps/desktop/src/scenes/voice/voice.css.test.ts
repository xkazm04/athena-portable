/** The Voice depth's stylesheet rules — README section 3.1, ADR 0087 and 0089. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./voice.css", import.meta.url), "utf8");

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const head = "\n" + selector + " {";
  const at = css.indexOf(head);
  if (at === -1) throw new Error(`no rule ${selector}`);
  return css.slice(at, css.indexOf("\n}", at));
}

test("the field's line, which changes on every hover, holds two lines so the places stay put", () => {
  expect(rule(".vsc--field .vsc-lead")).toMatch(/min-height:\s*3\.1em/);
});

test("the engine option and the rail's steps ease their hover and choice on the fast duration", () => {
  expect(rule(".vsc-opt")).toMatch(/transition:[^;]*background var\(--duration-fast\)[^;]*border-color var\(--duration-fast\)/);
  expect(rule(".vsc-step")).toMatch(/transition:[^;]*background var\(--duration-fast\)/);
});

test("the chosen option's ring is a layer that fades, not a box-shadow that swaps", () => {
  expect(rule('.vsc-opt[aria-pressed="true"]')).not.toMatch(/box-shadow/);
  expect(rule(".vsc-opt::after")).toMatch(/transition:\s*opacity var\(--duration-fast\)/);
  expect(rule('.vsc-opt[aria-pressed="true"]::after')).toMatch(/opacity:\s*1/);
});

test("the take, the voice card and the wave frame ease the state that changes their border", () => {
  expect(rule(".vsc-take")).toMatch(/transition:[^;]*border-color var\(--duration-fast\)[^;]*opacity var\(--duration-fast\)/);
  expect(rule('.vsc-take[data-picked="true"]')).not.toMatch(/box-shadow/);
  expect(rule(".vsc-take::after")).toMatch(/transition:\s*opacity var\(--duration-fast\)/);
  expect(rule(".vsc-voice")).toMatch(/transition:\s*border-color var\(--duration-fast\)/);
  expect(rule(".vsc-wave")).toMatch(/transition:\s*border-color var\(--duration-fast\)/);
});
