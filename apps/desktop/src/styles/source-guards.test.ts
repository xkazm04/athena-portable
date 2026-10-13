/** Source guards over every stylesheet in src — README section 3.1, ADR 0026 and 0089. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function sheets(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sheets(path));
    else if (entry.name.endsWith(".css")) out.push(path);
  }
  return out;
}

const all = sheets(decodeURIComponent(root)).map((path) => ({ path, text: readFileSync(path, "utf8") }));

test("the sweep sees the stylesheets", () => {
  expect(all.length).toBeGreaterThan(5);
});

test("text is never coloured with --accent, which is 3.2:1 on the light theme; --accent-text is the ink", () => {
  for (const { path, text } of all) {
    if (path.endsWith("app.css")) continue;
    expect(text, path).not.toMatch(/(^|[\s;{])color:\s*var\(--accent\)/);
  }
});

test("every use of --duration-fast names --ease-fast beside it", () => {
  let uses = 0;
  for (const { path, text } of all) {
    for (const m of text.matchAll(/var\(--duration-fast\)(?! var\(--ease-fast\))/g)) {
      expect(m[0], `${path} at ${m.index}`).toBe("");
    }
    uses += (text.match(/var\(--duration-fast\)/g) ?? []).length;
  }
  expect(uses).toBeGreaterThan(40);
});
