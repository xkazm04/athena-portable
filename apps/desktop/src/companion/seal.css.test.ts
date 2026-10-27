/**
 * The seal's skin (`seal.css`): what loops forever moves by transform and opacity only, so a seal
 * that sits on the screen edge all day costs the compositor and never the layout (README 3.5, the
 * repo's motion rule: animate transform and opacity only).
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const seal = readFileSync(new URL("./seal.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The properties a `@keyframes` block sets. */
function keyframeProps(name: string): string[] {
  const at = seal.indexOf(`@keyframes ${name} {`);
  if (at === -1) throw new Error(`no @keyframes ${name}`);
  let depth = 0;
  let end = at;
  for (let i = seal.indexOf("{", at); i < seal.length; i++) {
    if (seal[i] === "{") depth++;
    if (seal[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  return [...seal.slice(at, end).matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]!);
}

test("every animation that loops forever moves by transform and opacity only", () => {
  const looping = [...new Set([...seal.matchAll(/animation:\s*(seal-[a-z-]+)[^;]*\binfinite\b/g)].map((m) => m[1]!))];
  expect(looping.length).toBeGreaterThanOrEqual(5);
  for (const name of looping) for (const prop of keyframeProps(name)) expect(["transform", "opacity"], `${name} animates ${prop}`).toContain(prop);
});
