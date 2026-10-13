/** The motion and depth tokens in app.css — README section 3.1, ADR 0087 and 0089. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");

/** The declarations of every rule whose selector is exactly `selector`, joined. */
function rule(selector: string): string {
  const head = "\n" + selector + " {";
  const out: string[] = [];
  for (let at = css.indexOf(head); at !== -1; at = css.indexOf(head, at + 1)) {
    out.push(css.slice(at, css.indexOf("\n}", at)));
  }
  if (out.length === 0) throw new Error(`no rule ${selector}`);
  return out.join("\n");
}

test("the depth move has a duration and an easing, and calm removes the duration", () => {
  const root = rule(":root");
  expect(root).toMatch(/--dur-depth:\s*360ms/);
  expect(root).toMatch(/--ease-depth:\s*cubic-bezier/);
  expect(rule(':root[data-motion="calm"]')).toMatch(/--dur-depth:\s*0ms/);
});

test("the depth colours are mixes of the palette, never a literal colour", () => {
  const root = rule(":root");
  for (const n of [0, 1, 2, 3]) {
    const line = new RegExp(`--depth-${n}:([^;]+);`).exec(root);
    expect(line, `--depth-${n}`).not.toBeNull();
    expect(line![1]).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    expect(line![1]).toMatch(/var\(--/);
  }
});
