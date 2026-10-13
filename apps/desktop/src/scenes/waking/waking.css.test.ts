/** The first act's stylesheet rules — README section 3.1, ADR 0087 and 0089. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./waking.css", import.meta.url), "utf8");

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const head = "\n" + selector + " {";
  const at = css.indexOf(head);
  if (at === -1) throw new Error(`no rule ${selector}`);
  return css.slice(at, css.indexOf("\n}", at));
}

test("the eyebrow is set in the primary, which clears 4.5:1 in both themes, not the accent", () => {
  expect(rule(".waking__eyebrow")).toMatch(/color:\s*var\(--primary\)/);
  expect(rule(".waking__eyebrow")).not.toMatch(/--accent/);
});

test("every control the pointer can press eases its hover on the fast duration", () => {
  const blocks = css.split("}").filter((b) => /cursor:\s*pointer/.test(b));
  expect(blocks.length).toBeGreaterThan(0);
  for (const b of blocks) expect(b, b.trim().split("{")[0]).toMatch(/transition:[^;]*var\(--duration-fast\)/);
  expect(css).toMatch(/\.waking__step:hover\s*\{/);
  expect(css).toMatch(/\.waking__later:hover\s*\{/);
});
