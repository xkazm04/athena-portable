/**
 * Every rule in app.css has a user — README section 3.1, ADR 0087 and 0095.
 *
 * The global sheet outlives the views it was written for: the scene cutover (ADR 0095) deleted
 * the page shell, the layer and the module bar, and their rules stayed behind, read by nobody and
 * still read as the house style by the next person to open the sheet. So the sheet is held to the
 * tree: a class it styles is spelled in a view's string, a keyframes it declares is animated by
 * some sheet, and a custom property it sets is read by some sheet or view.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const here = decodeURIComponent(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const src = join(here, "..");
const app = join(src, "..");

const sheet = readFileSync(join(here, "app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function walk(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, keep));
    else if (keep(entry.name)) out.push(path);
  }
  return out;
}

const read = (path: string) => readFileSync(path, "utf8");
// Comments go first: prose that names a class (or holds a stray backtick) is not a user of it.
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const views = walk(src, (n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)).map((p) => code(read(p)));
const pages = readdirSync(app)
  .filter((n) => n.endsWith(".html"))
  .map((n) => [...read(join(app, n)).matchAll(/\sclass="([^"]*)"/g)].map((m) => `"${m[1]}"`).join("\n"));
const sheets = walk(src, (n) => n.endsWith(".css")).map((p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ""));

/** Every quoted piece of every view, where a class name is spelled. A class word inside UI copy
 * still counts, so this errs towards keeping a rule; it never reports a used one as dead. */
const strings = [...views, ...pages].flatMap((t) => [...t.matchAll(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g)].map((m) => m[0]));
/** `btn--${variant}`: a template that finishes a class name at run time. */
const prefixes = new Set(strings.flatMap((s) => [...s.matchAll(/([\w-]+--)\$\{/g)].map((m) => m[1]!)));

function used(cls: string): boolean {
  const word = new RegExp(`(?<![\\w-])${cls}(?![\\w-])`);
  if (strings.some((s) => word.test(s))) return true;
  return [...prefixes].some((p) => cls.startsWith(p));
}

const selectors = [...sheet.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1]!);
const classes = [...new Set(selectors.flatMap((s) => [...s.matchAll(/\.([a-z][\w-]*)/gi)].map((m) => m[1]!)))];
const keyframes = [...sheet.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]!);
const properties = [...new Set([...sheet.matchAll(/(?:^|[\s;{])(--[\w-]+)\s*:/g)].map((m) => m[1]!))];

test("the sweep sees the sheet, its views and its siblings", () => {
  expect(classes.length).toBeGreaterThan(40);
  expect(properties.length).toBeGreaterThan(40);
  expect(views.length).toBeGreaterThan(100);
  expect(sheets.length).toBeGreaterThan(5);
});

test("every class app.css styles is spelled by a view", () => {
  expect(classes.filter((c) => !used(c))).toEqual([]);
});

test("every keyframes app.css declares is animated by a sheet", () => {
  expect(keyframes.filter((k) => !sheets.some((s) => new RegExp(`animation[\\w-]*:[^;]*\\b${k}\\b`).test(s)))).toEqual([]);
});

test("every custom property app.css sets is read by a sheet or a view", () => {
  const readers = [...sheets, ...views];
  const unread = properties.filter(
    (p) => !readers.some((t) => t.includes(`var(${p})`) || t.includes(`var(${p},`) || t.includes(`"${p}"`)),
  );
  expect(unread).toEqual([]);
});
