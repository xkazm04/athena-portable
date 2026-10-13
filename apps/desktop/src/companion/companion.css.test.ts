/** The companion stylesheet's rules — ADR 0026, README sections 3.1 and 3.5. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./companion.css", import.meta.url), "utf8");

test("nothing readable is set under 12px, at either text-size step", () => {
  const sizes = [
    ...css.matchAll(/font-size:\s*(?:calc\()?(\d+(?:\.\d+)?)px/g),
    ...css.matchAll(/font:\s*[\w.]+\s+(?:calc\()?(\d+(?:\.\d+)?)px/g),
  ].map((m) => Number(m[1]));
  expect(sizes.length).toBeGreaterThan(10);
  for (const px of sizes) expect(px).toBeGreaterThanOrEqual(12);
});
