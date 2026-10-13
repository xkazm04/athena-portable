/** The console's frame stylesheet — README section 3.5, ADR 0087. Every class it styles is one the console draws. */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./console.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const root = readFileSync(new URL("./root.tsx", import.meta.url), "utf8");

it("styles only classes root.tsx draws (the old bridged-module wrapper is gone)", () => {
  const classes = [...css.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]!);
  expect(classes.length).toBeGreaterThan(0);
  for (const c of classes) expect(root, c).toContain(`"${c}"`);
});
