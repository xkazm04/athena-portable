// Reading `--*` tokens into JS: the parsing, and the SSR branch.
//
// Formula §1 rule 4 — one clock per level change, in one module; JS reads tokens and never types
// a millisecond. Three apps wrote three parsers for `"260ms"` in round 1. Parsing is the part
// that can be wrong and it does not need a browser to be wrong in, so it is pure and pinned here;
// the DOM path is exercised against a stubbed `getComputedStyle`.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cssEase,
  cssMs,
  parseBezier,
  parseEase,
  parseMs,
  readTokens,
  secs,
  styleOf,
} from "../src/zoom/tokens.ts";

test("both CSS spellings of a duration answer in milliseconds", () => {
  assert.equal(parseMs("260ms"), 260);
  assert.equal(parseMs("0.26s"), 260);
  assert.equal(parseMs("  420ms  "), 420);
  assert.equal(parseMs(".5s"), 500);
});

test("anything that is not a duration answers the caller's fallback", () => {
  assert.equal(parseMs(""), 0);
  assert.equal(parseMs(undefined), 0);
  assert.equal(parseMs("ease-out"), 0);
  assert.equal(parseMs("12"), 0, "a bare number is not a CSS duration");
  assert.equal(parseMs("", 400), 400);
});

test("zero is a legitimate duration and is not mistaken for a miss", () => {
  assert.equal(parseMs("0ms", 400), 0);
  assert.equal(parseMs("0s", 400), 0);
});

test("an easing is a string, because that is what CSS and motion both take", () => {
  assert.equal(parseEase("cubic-bezier(0.2, 0, 0, 1)"), "cubic-bezier(0.2, 0, 0, 1)");
  assert.equal(parseEase("  ease-out "), "ease-out");
  assert.equal(parseEase("", "linear"), "linear");
});

test("a bezier can also be had as four numbers, and a keyword is not one", () => {
  assert.deepEqual(parseBezier("cubic-bezier(0.2, 0, 0, 1)"), [0.2, 0, 0, 1]);
  assert.equal(parseBezier("ease-out"), null);
  assert.equal(parseBezier("cubic-bezier(0.2, 0, 0)"), null);
  assert.equal(parseBezier(undefined), null);
});

test("secs is the other half of rule 4's arithmetic", () => {
  assert.equal(secs(350), 0.35);
  assert.equal(secs(0), 0);
});

test("many tokens off one style read, which is one layout read rather than N", () => {
  const style = {
    reads: 0,
    getPropertyValue(name: string) {
      this.reads += 1;
      return { "--x-dur": "260ms", "--x-ease": "cubic-bezier(0.2, 0, 0, 1)" }[name] ?? "";
    },
  };
  const t = readTokens(["--x-dur", "--x-ease", "--x-missing"], style);
  assert.equal(t["--x-dur"].ms, 260);
  assert.equal(t["--x-ease"].ease, "cubic-bezier(0.2, 0, 0, 1)");
  assert.deepEqual(t["--x-missing"], { raw: "", ms: 0, ease: "" });
  assert.equal(style.reads, 3);
});

test("no style source at all — the server — is every token at its default", () => {
  const t = readTokens(["--x-dur"], null);
  assert.deepEqual(t["--x-dur"], { raw: "", ms: 0, ease: "" });
});

test("SSR: with no window, every reader answers its documented default", () => {
  assert.equal(typeof globalThis.window, "undefined");
  assert.equal(styleOf(), null);
  assert.equal(cssMs("--x-dur"), 0);
  assert.equal(cssMs("--x-dur", null, 400), 400);
  assert.equal(cssEase("--x-ease", null, "linear"), "linear");
});

test("in a browser the value comes off the element you name", () => {
  // A fake element and a stubbed `getComputedStyle`: the kit reads the cascade through the
  // window, which is exactly what makes it stubbable without a DOM.
  const scoped = { tokens: { "--bd-dur-move": "350ms", "--bd-ease": "cubic-bezier(0.2,0,0,1)" } };
  const root = { tokens: { "--bd-dur-move": "999ms" } };
  const g = globalThis as Record<string, unknown>;
  g.window = {
    getComputedStyle: (el: { tokens: Record<string, string> }) => ({
      getPropertyValue: (name: string) => el.tokens[name] ?? "",
    }),
  };
  g.document = { documentElement: root };
  try {
    assert.equal(cssMs("--bd-dur-move", scoped as unknown as Element), 350);
    assert.equal(cssEase("--bd-ease", scoped as unknown as Element), "cubic-bezier(0.2,0,0,1)");
    // No element named: the document element, which is where an app-wide token is declared.
    assert.equal(cssMs("--bd-dur-move"), 999);
    // A token the scope does not declare still answers the fallback rather than throwing.
    assert.equal(cssMs("--nope", scoped as unknown as Element, 400), 400);
  } finally {
    delete g.window;
    delete g.document;
  }
});
