/**
 * What opening Main loads — README section 3.5, ADR 0089 and 0095.
 *
 * The first-paint budget is kept by what the console imports **statically**: the stage, the surface
 * and the first act, and for each depth only its live part, whose view is a `lazy` chunk. A fixture,
 * the preview harness, the eager copy of the shipped playbooks or a depth's view in that graph would
 * put hundreds of kilobytes in the first frame and say nothing. This walks the static imports from
 * the module `chrome.html` loads (the document Tauri puts in the Main webview), so an import added
 * to the entry itself is walked too, and fails on any of them, so the budget cannot be spent by an
 * import nobody noticed. A depth's view is known by the `import()` that fetches it, and every other
 * file under a depth's folder is held out of the first frame unless it is named as shared.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ROOTS } from "@/depth/model";

const SRC = path.join(__dirname, "..");
const APP = path.join(SRC, "..");

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

/**
 * The files of a depth the first frame may carry besides its live part: the models the console's
 * own following and the surface read (`apps/model`, `chores/model`), and the page band the Apps
 * depth draws over a page (`apps/strip`). Anything else under a depth's folder belongs to its lazy
 * chunk; adding one here is a decision to pay for it in the first paint.
 */
const SHARED_DEPTH_FILES = ["scenes/apps/model.ts", "scenes/apps/strip.tsx", "scenes/chores/model.ts"];

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (base === null) return null; // a package
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  return null; // a stylesheet or an asset
}

const rel = (file: string) => path.relative(SRC, file).replaceAll("\\", "/");

/** The files `entry` imports statically, and the chunks those files fetch with `import()`. */
function graph(entry: string): { files: Set<string>; lazy: Set<string> } {
  const seen = new Set<string>();
  const lazy = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(STATIC_IMPORT)) {
      const next = resolve(file, m[1]!);
      if (next) visit(next);
    }
    for (const m of text.matchAll(DYNAMIC_IMPORT)) {
      const chunk = resolve(file, m[1]!);
      if (chunk) lazy.add(rel(chunk));
    }
  };
  visit(entry);
  return { files: new Set([...seen].map(rel)), lazy };
}

/** The module script `chrome.html` loads: the real first frame starts there, not at the console. */
function mainEntry(): string {
  const html = readFileSync(path.join(APP, "chrome.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const scripts = [...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="\/([^"]+)"/g)].map((m) => m[1]!);
  expect(scripts, "chrome.html loads exactly one module script").toHaveLength(1);
  return path.join(APP, scripts[0]!);
}

describe("what the console loads when Main opens", () => {
  const entry = mainEntry();
  const { files: loaded, lazy } = graph(entry);

  it("starts at the module chrome.html loads, and walks the stage, the surface and the first act", () => {
    expect(path.relative(SRC, entry).replaceAll("\\", "/")).toBe("chrome.tsx");
    for (const expected of ["console/root.tsx", "stage/Stage.tsx", "scenes/surface/view.tsx", "scenes/waking/view.tsx", "console/Console.tsx"]) {
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

  it("fetches every depth's view as a lazy chunk, and imports no lazy chunk statically", () => {
    // Read from the code's own `import()` calls, so a chunk with another name (Chores fetches
    // `live-view.tsx`) or a new depth is covered without a list here to keep in step.
    for (const root of ROOTS) {
      expect([...lazy].some((f) => f.startsWith(`scenes/${root}/`)), `${root} has no lazy view`).toBe(true);
    }
    expect([...lazy].filter((f) => loaded.has(f))).toEqual([]);
  });

  it("fetches the finder and its corpus only when summoned, never in the first frame", () => {
    expect(loaded).not.toContain("console/finder.tsx");
    expect(loaded).not.toContain("console/places.ts");
    expect(lazy).toContain("console/finder.tsx");
  });

  it("carries no file of a depth beyond its live part and the few the first frame shares", () => {
    const allowed = new Set([...ROOTS.map((root) => `scenes/${root}/live.tsx`), ...SHARED_DEPTH_FILES]);
    const depths = new RegExp(`^scenes/(${ROOTS.join("|")})/`);
    const extra = [...loaded].filter((f) => depths.test(f) && !allowed.has(f));
    expect(extra, "a depth's own file is in the first paint; import it from its lazy view instead").toEqual([]);
  });
});
