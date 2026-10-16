/**
 * THE LANE SHEET'S MOTION, READ OFF THE STYLESHEET — DESIGN.md §7 and the formula's rule 3.
 *
 * A CSS transition runs on the property values of the style AFTER the change. So a transition
 * declared only on the HIDDEN state of something animates the way out and never the way in: the
 * detail arrives as a pop and leaves as a fade, which is the reverse of "box, then ink". The
 * assertions below read `lanes.css` as rules (comments stripped first, so a comment that describes
 * a transition cannot satisfy the check) and hold each state the drawing changes to a transition
 * that applies in BOTH states.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const CSS = readFileSync(
  new URL("../components/atlas/variants/archify-lanes/lanes.css", import.meta.url),
  "utf8",
);

interface Rule {
  selectors: string[];
  decls: Map<string, string>;
}

/** Rules at the top level and inside `@media`; `@keyframes` bodies are not rules. */
function rulesOf(source: string): Rule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open === -1) break;
    const prelude = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth += 1;
      else if (text[j] === "}") depth -= 1;
      j += 1;
    }
    const body = text.slice(open + 1, j - 1);
    if (prelude.startsWith("@media")) out.push(...rulesOf(body));
    else if (!prelude.startsWith("@")) {
      const decls = new Map<string, string>();
      for (const d of body.split(";")) {
        const colon = d.indexOf(":");
        if (colon === -1) continue;
        decls.set(d.slice(0, colon).trim(), d.slice(colon + 1).trim());
      }
      out.push({ selectors: prelude.split(",").map((s) => s.trim()), decls });
    }
    i = j;
  }
  return out;
}

const RULES = rulesOf(CSS);

/** The last compound of a selector, and the class it starts with: `.al-run-label[x]` → `.al-run-label`. */
const subjectOf = (selector: string): string => selector.split(/\s+/).pop()!;
const classOf = (compound: string): string => /^\.[\w-]+/.exec(compound)?.[0] ?? compound;

/** True when some rule that does not depend on `stateAttr` gives `cls` an opacity transition. */
function easesOpacityInEveryState(cls: string, stateAttr: RegExp): boolean {
  return RULES.some(
    (r) =>
      /\bopacity\b|\ball\b/.test(r.decls.get("transition") ?? "") &&
      r.selectors.some((s) => !stateAttr.test(s) && classOf(subjectOf(s)) === cls),
  );
}

test("the instrument reads rules, not prose", () => {
  assert.ok(RULES.length > 50, `only ${RULES.length} rules parsed`);
  const seeded = rulesOf(`/* .x { transition: opacity 1s } */ .x[data-on] { opacity: 0 }`);
  assert.equal(seeded.length, 1, "a commented-out rule was parsed");
});

test("a detail tier fades in as well as out: the band only sets opacity, never the transition", () => {
  const band = /\[data-band=/;
  const hidden = RULES.filter(
    (r) => r.decls.get("opacity") === "0" && r.selectors.some((s) => band.test(s)),
  ).flatMap((r) => r.selectors.map((s) => classOf(subjectOf(s))));
  assert.ok(hidden.length >= 2, "the band no longer hides any detail tier — re-read this test");
  for (const cls of new Set(hidden)) {
    assert.ok(
      easesOpacityInEveryState(cls, band),
      `${cls} is hidden by the band but only eases while hidden, so it pops in at L1`,
    );
  }
});
