/**
 * The component catalog against the tree — README section 3.1, ADR 0087; `CATALOG.md` "Adding one".
 *
 * The catalog table is written by hand, so this is what keeps it honest: every primitive in
 * `src/components/` carries its `@catalog` tag, has its row, and has at least one importer outside
 * the folder. A primitive nobody imports is not a primitive, it is a file the next reader
 * mistakes for one (registry: ui-controls, control-inventory-and-discovery, the zero-adopter
 * signal).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const here = decodeURIComponent(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const src = join(here, "..");

const primitives = readdirSync(here)
  .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
  .map((f) => ({ name: f.replace(/\.tsx$/, ""), text: readFileSync(join(here, f), "utf8") }));

const catalog = readFileSync(join(here, "CATALOG.md"), "utf8");
const rows = [...catalog.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]!);

function sources(dir: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path !== here) out.push(...sources(path));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push({ path, text: readFileSync(path, "utf8") });
    }
  }
  return out;
}

const outside = sources(src);

test("the sweep sees the primitives and the rows", () => {
  expect(primitives.length).toBeGreaterThan(5);
  expect(rows.length).toBeGreaterThan(5);
});

test("every primitive carries a @catalog tag", () => {
  for (const p of primitives) expect(p.text, p.name).toMatch(/@catalog \S/);
});

test("the catalog's rows are exactly the primitives in the folder", () => {
  expect([...rows].sort()).toEqual(primitives.map((p) => p.name).sort());
});

test("every primitive has an importer outside src/components", () => {
  for (const { name } of primitives) {
    const from = new RegExp(`from "@/components/${name}"`);
    const users = outside.filter((s) => from.test(s.text));
    expect(users.length, `${name} has no importer`).toBeGreaterThan(0);
  }
});
