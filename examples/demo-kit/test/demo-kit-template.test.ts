// The template's own promises, held to the tree: what someone copies to start a host app.
//
// A defect in `examples/demo-kit/template` is inherited by every copy, so each test here pins one
// thing the template says or does against the ground truth it describes. The template is outside
// the pnpm workspace; this file reaches it by relative path, and reads only modules that import
// nothing (`lib/constants.ts`) or the source text itself.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { VIEWS, routeFor, viewFor } from "../template/lib/constants.ts";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(KIT, "template");
const EXAMPLES = join(KIT, "..");

/** The template's source: what a copy runs and what its author reads. README.md is not in it. */
function payload(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|css|mjs)$/.test(entry.name)) {
        out.push({ file: relative(TEMPLATE, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") });
      }
    }
  };
  walk(TEMPLATE);
  return out;
}

/** Where the browser actually lands for a pushed href: the URL parser collapses `.` and `..`. */
function landsOn(href: string): string {
  return viewFor(new URL(href, "http://app.invalid").pathname);
}

test("navigate never answers detail for an id whose route lands on another view", () => {
  // `/..` and `/.` collapse to `/`, the list; `/activity` is the static route, which wins over
  // `app/[id]`; `/activity-log` IS `app/[id]`, a record page, whatever its prefix.
  for (const id of ["rec-0001", "..", ".", "activity", "activity-log", "rec 1/../x", "%2e%2e"]) {
    const decision = routeFor("detail", id);
    if (decision.ok) {
      assert.equal(
        landsOn(decision.href),
        "detail",
        `navigate({ view: "detail", id: ${JSON.stringify(id)} }) answered ok and pushed ${decision.href}, which lands on ${landsOn(decision.href)}`,
      );
    } else {
      assert.ok(!("href" in decision), "a refusal must carry no route to push");
      assert.match(decision.error, /record/);
    }
  }
});

test("an ordinary record id, and every view, still route to where they say", () => {
  const ids: Record<string, string | undefined> = { detail: "rec-0001" };
  for (const view of VIEWS) {
    const decision = routeFor(view, ids[view]);
    assert.ok(decision.ok, `navigate({ view: "${view}" }) was refused`);
    assert.equal(landsOn(decision.href), view);
  }
  assert.ok(routeFor("detail", "activity-log").ok, "a record whose id starts with activity is still a record");
});

test("read_current_view names a record page whose id starts with activity as detail", () => {
  assert.equal(viewFor("/activity"), "activity");
  assert.equal(viewFor("/activity-log"), "detail");
  assert.equal(viewFor("/"), "list");
});

test("the template's prose names no sibling app and counts none: a copy is the next sibling", () => {
  // Ground truth: the Next apps beside the kit today. The template is copied in among them, so a
  // sentence that lists them or counts them is stale in the copy the day it is made, and goes
  // stale in the template the day a fifth app lands (one of them already had: atlas was missing).
  const apps = readdirSync(EXAMPLES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(EXAMPLES, d.name, "app", "layout.tsx")))
    .map((d) => d.name);
  assert.ok(apps.length >= 2, `expected the example apps beside the kit, found ${apps.join(", ")}`);
  const named = new RegExp(String.raw`\b(${apps.join("|")})\b`, "i");
  const counted = /\b(?:all|of the)\s+(?:two|three|four|five|six)\b|\b(?:one|two|three|four|five|six)\b[^.]{0,20}\b(?:shipped|reference)\s+apps?\b/i;
  const hits: string[] = [];
  for (const { file, text } of payload()) {
    text.split("\n").forEach((line, i) => {
      if (named.test(line) || counted.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], "the template describes its siblings instead of its own seam");
});

/** The template's stylesheet with its comments stripped, so prose about a rule cannot satisfy it. */
function templateCss(): string {
  return readFileSync(join(TEMPLATE, "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

test("the template spends the kit's spacing scale and never re-types a step of it", () => {
  // The kit's `--dk-gap` is `var(--dk-space-6)`, so re-pointing the scale moves every rule that
  // spends it. A literal here pins half the kit while the other half follows the scale.
  const spacing = /^(?:--dk-gap|(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z-]+)?)$/;
  const offenders: string[] = [];
  for (const [, prop, value] of templateCss().matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)) {
    if (!spacing.test(prop!)) continue;
    const rest = value!.replace(/var\(\s*--dk-(?:space-\d+|inset-[a-z]+|gap)\s*\)/g, "");
    if (/\d/.test(rest.replace(/(^|\s)0(?=\s|$)/g, ""))) offenders.push(`${prop}: ${value!.trim()}`);
  }
  assert.deepEqual(offenders, [], "a spacing value that is not a step of the kit's scale");
});

test("every class the template's stylesheet defines is drawn by the template or the kit", () => {
  // A rule with no element is copied into every new app and explained there as if it ran.
  const sources = payload()
    .filter(({ file }) => /\.tsx?$/.test(file))
    .map(({ text }) => text);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) sources.push(readFileSync(path, "utf8"));
    }
  };
  walk(join(KIT, "src"));
  const drawn = sources.join("\n");
  const defined = new Set([...templateCss().matchAll(/\.(dk-[a-z0-9-]+)/g)].map((m) => m[1]!));
  const orphans = [...defined].filter((name) => !new RegExp(String.raw`["'\s\`]${name}["'\s\`]`).test(drawn));
  assert.deepEqual(orphans, [], "a class the stylesheet styles and nothing renders");
});

test("a template file that sends the reader to a README appendix sends them to one that exists", () => {
  const readme = readFileSync(join(TEMPLATE, "README.md"), "utf8");
  const hasAppendix = /^#+\s.*appendix/im.test(readme);
  const pointers = payload().filter(({ text }) => /appendix/i.test(text)).map(({ file }) => file);
  if (!hasAppendix) assert.deepEqual(pointers, [], "README.md has no appendix to point at");
});
