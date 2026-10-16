/**
 * Escape in the note field closes the note, and only the note.
 *
 * The dossier is an overlay and owns its Escape through the kit's `useOverlayEscape`, spread on the
 * dialog root: any Escape that bubbles up to it un-prevented closes the whole candidate. The note
 * field inside it handled Escape as "cancel this draft" and did not mark the key handled - so the
 * one press cancelled the draft AND bubbled on to close the dossier, two layers for one key. The
 * kit's protocol is the fix the overlay already expects: the inner layer speaks first and calls
 * `preventDefault()`, and `escapeClosesOverlay` declines a prevented key (modal-stack's
 * dismissal-semantics: one press, one layer).
 *
 * The runner cannot render a `.tsx`, so the field's own key handler is lifted out of the source and
 * run against a stand-in event, which then goes to the kit's real predicate - the same order React
 * bubbles it in.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { escapeClosesOverlay } from "@athena/demo-kit/zoom";

const ACTS = readFileSync(
  fileURLToPath(new URL("../components/board/dossier/Acts.tsx", import.meta.url)),
  "utf8",
);

/** The `onKeyDown` arrow on the note `<input>`, as source, with the braces balanced. */
function noteKeyHandler(): string {
  const input = ACTS.indexOf('className="bd-note-input"');
  assert.ok(input >= 0, "Acts.tsx has no note input");
  const start = ACTS.indexOf("onKeyDown={", input);
  assert.ok(start >= 0, "the note input has no key handler");
  let i = start + "onKeyDown={".length;
  let depth = 1;
  const from = i;
  for (; i < ACTS.length && depth > 0; i += 1) {
    if (ACTS[i] === "{") depth += 1;
    else if (ACTS[i] === "}") depth -= 1;
  }
  return ACTS.slice(from, i - 1);
}

interface StandIn {
  key: string;
  defaultPrevented: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

function press(key: string): { event: StandIn; closed: number } {
  let closed = 0;
  const handler = new Function("close", `return (${noteKeyHandler()});`)(() => {
    closed += 1;
  }) as (event: StandIn) => void;
  const event: StandIn = {
    key,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
  };
  handler(event);
  return { event, closed };
}

test("Escape in the note field cancels the draft", () => {
  assert.equal(press("Escape").closed, 1);
});

test("and the dossier's overlay declines the same press", () => {
  const { event } = press("Escape");
  assert.equal(escapeClosesOverlay(event), false, "one Escape closed the note and the dossier both");
});

test("any other key is left for the field and the overlay alone", () => {
  const { event, closed } = press("a");
  assert.equal(closed, 0);
  assert.equal(event.defaultPrevented, false);
});
