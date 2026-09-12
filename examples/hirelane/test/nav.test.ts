/**
 * The route table, which is one route.
 *
 * This app had four routes, then two, and for a while `/` redirected to `/v`, a direction index
 * listing the single direction that had survived a review. That is one destination under three
 * names, and the masthead carried two links into it — a section vocabulary where a label promises
 * content it does not own. The board is the root route now and the index is gone, so what is left
 * to check is that nothing in the tree still points at the shape that was removed, and that every
 * internal link that IS in the tree lands on a page that exists.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const from = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path: string): string => readFileSync(from(path), "utf8");

/** `/` is served by `app/page.tsx`, `/x` by `app/x/page.tsx`. */
const pageFor = (route: string): string =>
  route === "/" ? "app/page.tsx" : `app${route}/page.tsx`;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(from(dir))) {
    const path = `${dir}/${entry}`;
    if (statSync(from(path)).isDirectory()) out.push(...sources(path));
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const TREE = [...sources("app"), ...sources("components"), ...sources("lib")];

test("the board is the root route, and it is the only page", () => {
  assert.ok(existsSync(from("app/page.tsx")), "app/page.tsx serves /");
  assert.match(read("app/page.tsx"), /<Board\b/, "and it renders the Board, rather than redirecting");
  const pages = TREE.filter((p) => p.endsWith("/page.tsx"));
  assert.deepEqual(pages, ["app/page.tsx"], "one page, so there is one place to be");
});

test("the direction index is gone, and nothing still points at it", () => {
  assert.ok(!existsSync(from("app/v")), "app/v/ was removed with the index");
  for (const file of TREE) {
    // String literals only. A comment may still narrate the route that was removed - the history
    // of why a vocabulary collapsed to one name is worth keeping - but nothing may ADDRESS it.
    const dead = read(file).match(/["']\/v(?:\/[a-z0-9/-]*)?["']/g);
    assert.equal(dead, null, `${file} still addresses ${dead?.join(", ")}`);
  }
});

test("every internal link in the tree lands on a page that exists", () => {
  const hrefs = new Set<string>();
  for (const file of TREE) {
    for (const match of read(file).matchAll(/\bhref="(\/[^"]*)"/g)) hrefs.add(match[1]!);
    for (const match of read(file).matchAll(/\b(?:router\.push|redirect|revalidatePath)\(\s*"(\/[^"]*)"/g)) {
      hrefs.add(match[1]!);
    }
  }
  assert.ok(hrefs.size > 0, "something in the tree addresses a route, or this asserts nothing");
  for (const href of hrefs) {
    assert.ok(existsSync(from(pageFor(href))), `${href} is served by ${pageFor(href)}`);
  }
});

test("the app ships no API route: what it offers an agent is on document.modelContext", () => {
  assert.ok(!existsSync(join(from("app"), "api")), "no app/api/ (DESIGN-LAW §8)");
});
