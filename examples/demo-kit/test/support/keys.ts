// Test helpers shared by the Escape tests. Outside the `test/*.test.ts` glob, so node --test does
// not run it as a suite; imported by relative path with its extension, like everything else here.

import { MODAL_SELECTOR, type EscapeEvent } from "../../src/zoom/escape.ts";

/** A keydown, with an optional modal ancestor the fake `closest` answers from. */
export function keydown(key: string, { prevented = false, modal = false } = {}): EscapeEvent {
  return {
    key,
    defaultPrevented: prevented,
    target: { closest: (selector: string) => (modal && selector === MODAL_SELECTOR ? {} : null) },
  };
}
