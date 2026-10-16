// Reading `--*` tokens into JS: the parsing, and the SSR branch.
//
// Formula §1 rule 4 — one clock per level change, in one module; JS reads tokens and never types
// a millisecond. Three apps wrote three parsers for `"260ms"` in round 1. Parsing is the part
// that can be wrong and it does not need a browser to be wrong in, so it is pure and pinned here;
// the DOM path is exercised against a stubbed `getComputedStyle`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  FLY_EASE,
  cssEase,
  cssMs,
  easeFromCss,
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

/* ------------------------------------------------------------------------ easing, from a token */

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

test("an ease from the cascade starts at 0, ends at 1 and never runs backwards", () => {
  for (const raw of ["linear", "ease-in-out", "cubic-bezier(0.2, 0, 0, 1)", "", "steps(4)"]) {
    const ease = easeFromCss(raw);
    near(ease(0), 0, 1e-6);
    near(ease(1), 1, 1e-6);
    let last = -1;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = ease(t);
      assert.ok(v >= last - 1e-6, `${raw} went backwards at ${t}`);
      last = v;
    }
  }
});

test("linear is exactly linear, and the kit's curve is not", () => {
  near(easeFromCss("linear")(0.25), 0.25, 1e-9);
  assert.ok(easeFromCss("cubic-bezier(0.2, 0, 0, 1)")(0.25) > 0.25);
});

test("the kit's default curve is the template's --dk-ease, read out of the stylesheet", () => {
  // Two authorities for one curve is a race with a delay fuse: the retune happens in the CSS and
  // the JS default goes on flying the old curve. The template is the kit's own scaffold, so its
  // stylesheet is the artefact this pins against, not a comment that says they match.
  const css = readFileSync(new URL("../template/app/globals.css", import.meta.url), "utf8");
  const declared = /--dk-ease:\s*([^;]+);/.exec(css)?.[1]?.trim();
  assert.ok(declared, "the template declares --dk-ease");
  assert.equal(FLY_EASE, declared);
  assert.ok(parseBezier(FLY_EASE), "and it is a curve the one parser reads");
});

test("an unreadable token falls back to exactly the FLY_EASE curve, not a second copy of it", () => {
  // The fallback is sampled FROM the string, so retyping one without the other cannot happen.
  const kit = easeFromCss(FLY_EASE);
  for (const raw of ["", "steps(4)", "cubic-bezier(1, 2)", null, undefined]) {
    const fallback = easeFromCss(raw);
    for (let t = 0; t <= 1; t += 0.125) near(fallback(t), kit(t), 1e-12);
  }
});

test("a curve means the same to easeFromCss as it does to parseBezier", () => {
  // One parser: whatever parseBezier refuses, easeFromCss treats as unreadable, and vice versa.
  const cases = ["cubic-bezier(0.4, 0, 0.2, 1)", " cubic-bezier( 0.4 ,0,0.2 , 1 ) ", "cubic-bezier(0.4, 0, 0.2)", "cubic-bezier(a, 0, 0, 1)", "CUBIC-BEZIER(0.4, 0, 0.2, 1)"];
  const fallback = easeFromCss("");
  for (const raw of cases) {
    const read = parseBezier(raw) !== null;
    const differs = [0.25, 0.5, 0.75].some((t) => Math.abs(easeFromCss(raw)(t) - fallback(t)) > 1e-6);
    assert.equal(differs, read, `${raw}: parseBezier ${read ? "reads" : "refuses"} it`);
  }
});
