/** The surface stylesheet's rules — README section 3.1, ADR 0087 and 0089. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./surface.css", import.meta.url), "utf8");

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const head = "\n" + selector + " {";
  const at = css.indexOf(head);
  if (at === -1) throw new Error(`no rule ${selector}`);
  return css.slice(at, css.indexOf("\n}", at));
}

test("the eyebrow is set in the primary, which clears 4.5:1 in both themes, not the accent", () => {
  expect(rule(".surface__eyebrow")).toMatch(/color:\s*var\(--primary\)/);
  expect(rule(".surface__eyebrow")).not.toMatch(/--accent/);
});

test("every control the pointer can press eases its hover on the fast duration, and has a hover", () => {
  const blocks = css.split("}").filter((b) => /cursor:\s*pointer/.test(b));
  expect(blocks.length).toBeGreaterThan(0);
  for (const b of blocks) expect(b, b.trim().split("{")[0]).toMatch(/transition:[^;]*var\(--duration-fast\)/);
  for (const sel of [".surface__summon", ".surface__send", ".surface__input"]) {
    expect(css.includes(`${sel}:hover`), sel).toBe(true);
  }
});
