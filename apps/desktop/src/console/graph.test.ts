/**
 * What opening Main loads — README section 3.5, ADR 0089.
 *
 * The first-paint budget is kept by what the console imports **statically**: the stage, the surface
 * and the first act, and for each depth only its live part, whose view is a `lazy` chunk. A fixture,
 * the preview harness, the eager copy of the shipped playbooks or a depth's view in that graph would
 * put hundreds of kilobytes in the first frame and say nothing. This walks the static imports from
 * the console's root and fails on any of them, so the budget cannot be spent by an import nobody
 * noticed.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(__dirname, "..");

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm;

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (base === null) return null; // a package
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  return null; // a stylesheet or an asset
}

function graph(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(STATIC_IMPORT)) {
      const next = resolve(file, m[1]!);
      if (next) visit(next);
    }
  };
  visit(entry);
  return new Set([...seen].map((f) => path.relative(SRC, f).replaceAll("\\", "/")));
}

describe("what the console loads when Main opens", () => {
  const loaded = graph(path.join(SRC, "console", "root.tsx"));

  it("walks the stage, the surface and the first act", () => {
    for (const expected of ["stage/Stage.tsx", "scenes/surface/view.tsx", "scenes/waking/view.tsx", "console/Console.tsx"]) {
      expect(loaded, expected).toContain(expected);
    }
  });

  it("holds no fixture, no preview and no eager copy of the shipped playbooks", () => {
    const heavy = [...loaded].filter(
      (f) =>
        /(^|\/)fixtures\.tsx?$/.test(f) ||
        f === "lib/playbooks.shipped.ts" ||
        f === "scenes/registry.ts" ||
        f === "console/preview.tsx" ||
        f.endsWith("/preview.tsx"),
    );
    expect(heavy).toEqual([]);
  });

  it("holds no depth's view: each is a lazy chunk, fetched when the depth is entered", () => {
    const views = [...loaded].filter((f) => /^scenes\/(apps|chores|accounts|voice|mind)\/view\.tsx$/.test(f));
    expect(views).toEqual([]);
  });
});
