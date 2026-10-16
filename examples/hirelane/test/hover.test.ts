/**
 * A hover eases every property it changes, the way its sibling controls do.
 *
 * The board's controls are a family: the back pill, the register summary, the group rows, the
 * bench rows and the dossier's buttons each change colour or edge on hover and ease it on a duration
 * token. Two did not. The carousel's arrows changed colour and edge with no transition at all, so
 * beside the back pill - the same round control, the same hover - they snapped. The GATED buttons
 * changed their edge on hover while `.bd-btn` eased only its fill, so the fill came up over a beat
 * and the border jumped at frame zero, on the one zone a reader is meant to approach slowly.
 *
 * This reads every `:hover` rule in the direction's stylesheets and asks the rule that styles the
 * same element at rest whether it transitions each property the hover sets. Comments are blanked
 * first, so a rule described in prose is not read as a rule.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const STYLE = fileURLToPath(new URL("../components/board/style/", import.meta.url));

function sheets(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sheets(path);
    return path.endsWith(".css") ? [path] : [];
  });
}

interface Rule {
  selectors: string[];
  body: string;
}

/** Top-level and `@media`-nested rules alike, flattened: a selector, then its declarations. */
function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(",").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
    out.push({ selectors, body: m[2]! });
  }
  return out;
}

const RULES = sheets(STYLE).flatMap((file) => rules(readFileSync(file, "utf8")));

/** The properties a body sets, by name. */
const sets = (body: string): string[] =>
  [...body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].map((m) => m[1]!).filter((p) => p !== "transition");

/** The properties a body's `transition` eases, by name. */
function eases(body: string): string[] | null {
  const value = body.match(/(?:^|;)\s*transition\s*:\s*([^;]+)/)?.[1];
  if (!value) return null;
  return value.split(",").map((part) => part.trim().split(/\s+/)[0]!);
}

/** The rest-state rule that carries this element's transition, most specific first. */
function restTransition(hover: string): string[] | null {
  const base = hover.replace(/:hover/g, "").replace(/:not\([^)]*\)/g, "").trim();
  const last = base.split(" ").at(-1)!;
  const bare = last.replace(/\[[^\]]*\]/g, "");
  for (const candidate of [base, last, bare]) {
    for (const rule of RULES) {
      if (!rule.selectors.includes(candidate)) continue;
      const list = eases(rule.body);
      if (list) return list;
    }
  }
  return null;
}

const HOVERS = RULES.flatMap((rule) =>
  rule.selectors
    .filter((s) => s.includes(":hover") && !s.includes("::-webkit-scrollbar"))
    .map((selector) => ({ selector, props: sets(rule.body) })),
);

test("the direction has hover rules to check, or this asserts nothing", () => {
  assert.ok(HOVERS.length >= 6, `found ${HOVERS.length} hover rules`);
});

test("every property a hover changes is eased by the element's own transition", () => {
  const snaps: string[] = [];
  for (const { selector, props } of HOVERS) {
    const list = restTransition(selector);
    if (!list) {
      snaps.push(`${selector}: no transition at rest`);
      continue;
    }
    for (const prop of props) {
      const covered = list.includes(prop) || list.includes("all") || (prop === "background-color" && list.includes("background"));
      if (!covered) snaps.push(`${selector}: ${prop} is not in "${list.join(", ")}"`);
    }
  }
  assert.deepEqual(snaps, []);
});
