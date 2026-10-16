/**
 * The board's stylesheets, read for the rules a person meets with a keyboard and a pointer.
 *
 * Each case derives its ground truth from the tree rather than from a list kept beside it: the tags
 * the board's components actually render, the tokens `base/tokens.css` actually declares. Comments
 * are blanked before anything is matched, so a sheet that explains a rule in prose is not read as
 * obeying it.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const BOARD = fileURLToPath(new URL("../components/board/", import.meta.url));
const STYLE = join(BOARD, "style");

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return files(path, ext);
    return path.endsWith(ext) ? [path] : [];
  });
}

const blank = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  file: string;
  selectors: string[];
  body: string;
}

/** A selector list split on its top-level commas only, so `:where(a, b)` stays one selector. */
function splitList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of list) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
}

/** Every rule in the direction, `@media` and `@container` bodies flattened in. */
const RULES: Rule[] = files(STYLE, ".css").flatMap((file) =>
  [...blank(readFileSync(file, "utf8")).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    file: file.slice(STYLE.length + 1).replace(/\\/g, "/"),
    selectors: splitList(m[1]!),
    body: m[2]!,
  })),
);

const JSX = files(BOARD, ".tsx").map((file) => readFileSync(file, "utf8"));

/** The focus-visible rule for the room, and the elements its `:where()` list names. */
function roomFocusList(): string[] {
  const rule = RULES.find((r) => r.selectors.some((s) => s.startsWith(".bd-root :where(") && s.endsWith(":focus-visible")));
  assert.ok(rule, "the room has no `.bd-root :where(...):focus-visible` rule");
  const selector = rule.selectors.find((s) => s.startsWith(".bd-root :where("))!;
  return selector
    .slice(".bd-root :where(".length, selector.lastIndexOf(")"))
    .split(",")
    .map((s) => s.trim());
}

test("the room's focus ring names every focusable tag the board renders", () => {
  // The tags are read out of the components, not listed here: a disclosure added to a component
  // is a tag this list did not know about, which is how the foot's <summary> was missed.
  const FOCUSABLE = ["a", "button", "input", "select", "textarea", "summary"];
  const rendered = FOCUSABLE.filter((tag) => JSX.some((src) => new RegExp(`<${tag}[\\s>]`).test(src)));
  if (JSX.some((src) => /\btabIndex=/.test(src))) rendered.push("[tabindex]");
  assert.ok(rendered.includes("button") && rendered.includes("summary"), `read ${rendered.join(", ")}`);
  const named = roomFocusList();
  assert.deepEqual(
    rendered.filter((tag) => !named.includes(tag)),
    [],
    `the focus ring names ${named.join(", ")}`,
  );
});
