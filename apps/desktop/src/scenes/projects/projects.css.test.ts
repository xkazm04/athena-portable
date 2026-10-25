/** Source guards on the Projects depth's stylesheet — README section 3.5, ADR 0087, 0089 and 0225. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./projects.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first rule whose whole selector, at the start of a line, is `selector`. */
function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `${selector} is styled`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
}

describe("the field does not move under the pointer", () => {
  it("reserves two lines for the brief, so hovering a project never pushes the orrery down", () => {
    expect(rule(".projects__line")).toMatch(/min-height:\s*3em/);
  });
});

describe("the orrery turns on the compositor and holds still under Calm", () => {
  it("turns a ring with rotate, and turns each moon back by its arm and the ring, unsquashed", () => {
    expect(rule(".orbit")).toMatch(/animation:\s*orbit-turn var\(--period\) linear infinite/);
    const moon = rule(".moon");
    expect(moon).toMatch(/rotate:\s*calc\(-1 \* var\(--a\)\)/);
    expect(moon).toMatch(/scale:\s*1 calc\(1 \/ var\(--k\)\)/);
    expect(moon).toMatch(/animation:\s*moon-turn var\(--period\) linear infinite/);
    expect(css).toMatch(/@keyframes moon-turn\s*\{\s*from\s*\{\s*rotate:\s*calc\(-1 \* var\(--a\)\);\s*\}\s*to\s*\{\s*rotate:\s*calc\(-1 \* var\(--a\) - 360deg\);/);
  });

  it("stops every turn under Calm, so each moon rests where its angle puts it", () => {
    expect(css).toMatch(/:root\[data-motion="calm"\] \.orbit,\s*:root\[data-motion="calm"\] \.moon\s*\{\s*animation:\s*none;/);
  });

  it("animates only what the compositor plays, and never transitions all", () => {
    expect(css).not.toMatch(/transition:\s*all/);
    for (const [, body] of css.matchAll(/@keyframes [\w-]+\s*\{([\s\S]*?\}\s*)\}/g)) {
      for (const [, prop] of body!.matchAll(/([\w-]+):/g)) expect(["rotate", "transform", "opacity", "scale"]).toContain(prop);
    }
  });
});

describe("tokens only", () => {
  it("spells no literal colour: the theme's tokens, and a project's hue as its data", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    for (const [hsl] of css.matchAll(/hsl\([^)]*\)/g)) expect(hsl).toMatch(/^hsl\(var\(--hue/);
  });

  it("sets no text under 12px", () => {
    for (const [, size] of css.matchAll(/font-size:\s*([\d.]+)rem/g)) expect(Number(size)).toBeGreaterThanOrEqual(0.75);
    expect(css).not.toMatch(/font-size:\s*\d+px/);
  });
});
