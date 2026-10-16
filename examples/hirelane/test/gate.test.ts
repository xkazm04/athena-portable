/**
 * An armed irreversible act starts on Cancel, never on the act.
 *
 * The dossier's gate arms before it fires: one press shows the sentence that names the person and
 * what stops being true, a second press on the fire button sends. That second press is the whole
 * consent, so it must be a separate, deliberate act. `dossier/Gate.tsx` put initial focus ON the
 * fire button when an offer armed - a keyboard user who armed "Record an offer" with Enter and held
 * the key for the auto-repeat delay, or pressed it twice, recorded an irreversible offer through a
 * sentence they never read. The other two arms put focus nowhere, so it fell to the document.
 *
 * The registry's modal-stack/destructive-confirmation technique states the rule: initial focus
 * belongs to the non-destructive choice, and the destructive action is never auto-focused. All
 * three armed states now land on their own Cancel.
 *
 * Read from the source because the runner cannot render a `.tsx`; comments are stripped first, so
 * a note ABOUT autoFocus cannot satisfy it.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const GATE = readFileSync(
  fileURLToPath(new URL("../components/board/dossier/Gate.tsx", import.meta.url)),
  "utf8",
)
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

interface Button {
  attrs: string;
  text: string;
}

/** Every `<button ...>...</button>`, with an attribute scan that steps over `{...}` (arrows have `>`). */
function buttons(source: string): Button[] {
  const out: Button[] = [];
  let at = source.indexOf("<button");
  while (at >= 0) {
    let i = at + "<button".length;
    let depth = 0;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
    }
    const close = source.indexOf("</button>", i);
    out.push({ attrs: source.slice(at, i), text: source.slice(i + 1, close).replace(/\s+/g, " ").trim() });
    at = source.indexOf("<button", close);
  }
  return out;
}

const ALL = buttons(GATE);
const focused = ALL.filter((b) => /\bautoFocus\b/.test(b.attrs));

test("the gate has its three arms, each with a fire button and a Cancel", () => {
  assert.equal(ALL.filter((b) => /data-fire="true"/.test(b.attrs)).length, 3, "three fire buttons");
  assert.equal(ALL.filter((b) => b.text === "Cancel").length, 3, "three Cancels");
});

test("no fire button takes focus when its act arms", () => {
  for (const b of ALL.filter((x) => /data-fire="true"/.test(x.attrs))) {
    assert.doesNotMatch(b.attrs, /\bautoFocus\b/, `"${b.text}" is auto-focused`);
  }
});

test("every armed state starts on its Cancel", () => {
  assert.equal(focused.length, 3, "one initial focus per armed state");
  for (const b of focused) assert.equal(b.text, "Cancel", `initial focus is on "${b.text}"`);
});
