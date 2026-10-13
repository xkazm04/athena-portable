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
