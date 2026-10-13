/** The stage's stylesheet — README section 3.1, ADR 0087 and 0089. Source guards on the rules a render test cannot see. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const raw = readFileSync(new URL("./stage.css", import.meta.url), "utf8");
/** Comments stripped first, so a rule that is only talked about does not satisfy a guard. */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of every flat rule whose selector list contains exactly `selector`. */
function decls(selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = m[1]!.split(",").map((s) => s.trim());
    if (list.includes(selector)) out.push(m[2]!);
  }
  if (out.length === 0) throw new Error(`no rule ${selector}`);
  return out.join("\n");
}

describe("the light shafts under a reduced-motion machine", () => {
  it("stand still, because the global 1 ms duration would turn an infinite sway into a flicker", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.backdrop__shafts i \{[^}]*animation: none/,
    );
  });
});

describe("the dock", () => {
  it("arrives on the depth clock, by transform and opacity only", () => {
    expect(decls(".stage__dock")).toMatch(/animation:\s*dock-in var\(--dur-depth\) var\(--ease-depth\)/);
    const frames = /@keyframes dock-in\s*\{([\s\S]*?\}\s*)\}/.exec(css);
    expect(frames).not.toBeNull();
    const props = [...frames![1]!.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
    expect([...new Set(props)].sort()).toEqual(["opacity", "transform"]);
  });
});

describe("the gauge's ticks", () => {
  it("light by opacity on the mark's own clock, not by a background swap that jumps", () => {
    expect(decls(".stage__rail i::after")).toMatch(/transition:\s*opacity var\(--dur-depth\) var\(--ease-depth\)/);
    expect(decls('.stage__rail i[data-reached="true"]::after')).toMatch(/opacity:\s*1/);
    expect(decls('.stage__rail i')).not.toMatch(/opacity:/);
    expect(css).not.toMatch(/\.stage__rail i\[data-reached="true"\]\s*\{/);
  });
});

describe("the current depth root", () => {
  it("does not grow: every root already holds the border the current one is drawn with", () => {
    expect(decls(".stage__roots button")).toMatch(/border:\s*1px solid transparent/);
    expect(decls('.stage__roots button[aria-current="true"]')).not.toMatch(/border:\s*1px solid/);
    expect(decls('.stage__roots button[aria-current="true"]')).toMatch(/border-color:\s*var\(--line-strong\)/);
  });
});

describe("hover and current states ease like the scenes' do", () => {
  for (const sel of [".stage__rise", ".stage__crumb button", ".stage__roots button", ".stage__dock-athena"]) {
    it(`${sel} carries a colour transition on the shared fast duration`, () => {
      expect(decls(sel)).toMatch(/transition:[^;]*var\(--duration-fast\)/);
    });
  }
  it("the dock's Athena button answers a hover like the buttons beside it", () => {
    expect(decls(".stage__dock-athena:hover")).toMatch(/border-color:\s*var\(--accent\)/);
  });
});
