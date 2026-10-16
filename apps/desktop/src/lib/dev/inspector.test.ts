/**
 * The 12px text floor, for inline styles — README section 3.1, the overlay's "no text under 12px".
 *
 * The stylesheets have their own guards (`companion.css.test.ts`, `halo.css.test.ts`, ...); a size
 * written in a component's `style` prop escapes every one of them. The dev inspector was the only
 * component that wrote one, which is why the guard lives beside it, but it reads every `.tsx` under
 * `src`, so the next inline size is held to the same floor wherever it lands.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");

function components(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return components(full);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [full] : [];
  });
}

/** Comments out, so a sentence about a size is never read as one. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** Every inline text size in `text`, in px: `fontSize: 11`, `fontSize: "11px"`, `font: "700 11px/1.4 ..."`. */
function inlineTextSizes(text: string): number[] {
  const src = code(text);
  const sizes: number[] = [];
  for (const m of src.matchAll(/\bfontSize:\s*["'`]?(\d+(?:\.\d+)?)(?:px)?\b/g)) sizes.push(Number(m[1]));
  for (const m of src.matchAll(/\bfont:\s*["'`][^"'`]*?(\d+(?:\.\d+)?)px/g)) sizes.push(Number(m[1]));
  return sizes;
}

describe("inline text sizes", () => {
  it("are read from every form a style prop writes them in", () => {
    expect(inlineTextSizes(`style={{ fontSize: 11 }} x={{ fontSize: "10px" }} y={{ font: \`700 9px/1.4 \${MONO}\` }}`)).toEqual([
      11, 10, 9,
    ]);
    expect(inlineTextSizes("// fontSize: 8 in a comment\nconst a = 1;")).toEqual([]);
  });

  it("are never under 12px in a component", () => {
    const files = components(SRC);
    expect(files.length).toBeGreaterThan(50);
    const under = files.flatMap((file) =>
      inlineTextSizes(readFileSync(file, "utf8"))
        .filter((px) => px < 12)
        .map((px) => `${path.relative(SRC, file).replaceAll("\\", "/")}: ${px}px`),
    );
    expect(under).toEqual([]);
  });
});
