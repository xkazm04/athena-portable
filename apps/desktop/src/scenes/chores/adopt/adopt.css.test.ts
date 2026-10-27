/** The studio's stylesheet: its motion is timed on the app's duration tokens, never a literal. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./adopt.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `animation*` / `transition*` declaration, value only. */
const timings = [...css.matchAll(/(?:^|[\s;{])((?:animation|transition)[\w-]*)\s*:\s*([^;}]+)/g)].map((m) => ({ prop: m[1]!, value: m[2]! }));

test("the studio times its motion on duration tokens, with no literal ms or s", () => {
  expect(timings.length).toBeGreaterThanOrEqual(6);
  const literal = timings.filter(({ value }) => /(?:^|[^\w-])[\d.]+m?s\b/.test(value.replace(/var\(--[\w-]+\)/g, "")));
  expect(literal.map((t) => `${t.prop}: ${t.value.trim()}`)).toEqual([]);
});
