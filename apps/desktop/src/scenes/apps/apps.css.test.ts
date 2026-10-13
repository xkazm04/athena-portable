/** Source guards on the Apps depth's stylesheet — README section 3.5, ADR 0087 and 0089. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./apps.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is styled`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
}

describe("the field does not move under the pointer", () => {
  it("reserves two lines for the summary, so hovering an app never pushes the orbs down", () => {
    // The hovered app's summary replaces a one-line prompt; at 1.5em the header grew a line and the
    // orb under the cursor slid away from it.
    expect(rule(".apps__line")).toMatch(/min-height:\s*3em/);
  });
});

describe("the page chips and the tools answer a pointer as the orbs do", () => {
  it("eases the tool pill's hover and the chip's focused border on the shared token", () => {
    expect(rule(".apps__tool")).toMatch(/transition:[^;]*var\(--duration-fast\)/);
    expect(rule(".apps__chip")).toMatch(/transition:[^;]*border-color var\(--duration-fast\)/);
  });
  it("gives both chip buttons a hover, and the focused chip a fill that is not colour alone", () => {
    expect(css).toMatch(/\.apps__chip-main:hover/);
    expect(css).toMatch(/\.apps__chip-close:hover/);
    expect(css).toMatch(/\.apps__chip\[data-focused="true"\]\s*\{[^}]*background/);
  });
  it("never transitions all", () => {
    expect(css).not.toMatch(/transition:\s*all/);
  });
});
