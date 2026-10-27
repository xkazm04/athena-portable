/**
 * The face's arrival - ADR 0120, README section 3.1. The canvas starts hidden and the runtime flips
 * it to `data-face="ready"` when the rest frame is drawn; the stylesheet turns that flip into an
 * opacity ease on the depth tokens instead of a one-frame cut, and holds still under Calm and a
 * reduced-motion machine. Source guards on the rules a render test cannot see.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
/** Comments stripped first, so a rule that is only talked about does not satisfy a guard. */
const css = read("./avatar.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of every flat rule (outside an at-rule) whose selector list contains `selector`. */
function decls(selector: string, source = css): string {
  const out: string[] = [];
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.split(",").map((s) => s.trim()).includes(selector)) out.push(m[2]!);
  }
  if (out.length === 0) throw new Error(`no rule ${selector}`);
  return out.join("\n");
}

describe("her face arriving", () => {
  it("eases in by opacity alone, on the depth duration and easing", () => {
    const base = decls("[data-face] > canvas");
    expect(base).toMatch(/opacity:\s*0/);
    expect(base).toMatch(/transition:\s*opacity var\(--dur-depth\) var\(--ease-depth\)/);
    expect(decls('[data-face="ready"] > canvas')).toMatch(/opacity:\s*1/);
    const props = [...css.matchAll(/transition:\s*([a-z-]+)/g)].map((m) => m[1]);
    expect([...new Set(props)].sort()).toEqual(["none", "opacity"]);
  });

  it("spells no literal duration or easing", () => {
    expect(css).not.toMatch(/\d(ms|s)\b/);
    expect(css.replace(/var\([^)]*\)/g, "")).not.toMatch(/cubic-bezier|\bease(-in|-out|-in-out)?\b|linear/);
  });

  it("lands at once under Calm and under a reduced-motion machine that has not chosen full motion", () => {
    expect(decls(':root[data-motion="calm"] [data-face] > canvas')).toMatch(/transition:\s*none/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*:root:not\(\[data-motion="full"\]\) \[data-face\] > canvas \{[^}]*transition:\s*none/,
    );
  });

  it("is loaded with the lazy runtime, which sets data-face=ready when the rest frame is drawn, so the first frame carries no byte of it", () => {
    const runtime = read("./runtime.ts");
    expect(runtime).toMatch(/import "\.\/avatar\.css"/);
    expect(runtime).toMatch(/canvas\.style\.visibility = "visible";\s*root\.setAttribute\("data-face", "ready"\)/);
    expect(read("./Avatar.tsx")).toMatch(/data-face="loading"[\s\S]*<canvas/);
    expect(read("./Avatar.tsx")).not.toMatch(/avatar\.css/);
  });
});
