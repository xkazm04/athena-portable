/** The halo stylesheet's rules — ADR 0027 (Athena is ambient), README section 3.1. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

import { CAPTION_LINGER_MS } from "./model";

const css = readFileSync(new URL("./halo.css", import.meta.url), "utf8");

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const head = "\n" + selector + " {";
  const at = css.indexOf(head);
  if (at === -1) throw new Error(`no rule ${selector}`);
  return css.slice(at, css.indexOf("\n}", at));
}

test("the shell hides an idle halo only after the caption's linger and every fade have finished", () => {
  // The pair: `HIDE_AFTER` in the shell, and the page's linger and fades. The Rust test pins its
  // own copy of the page's numbers; this one reads the page's real ones.
  const rust = readFileSync(new URL("../../src-tauri/src/halo.rs", import.meta.url), "utf8");
  const hide = rust.match(/HIDE_AFTER: Duration = Duration::from_millis\((\d+)\)/);
  expect(hide).not.toBeNull();
  const captionFade = rule(".caption").match(/transition: opacity (\d+)ms/);
  const edgeFade = rule('.halo[data-phase="idle"]').match(/--live (\d+)ms/);
  expect(captionFade).not.toBeNull();
  expect(edgeFade).not.toBeNull();
  const last = CAPTION_LINGER_MS + Math.max(Number(captionFade![1]), Number(edgeFade![1]));
  expect(last).toBeLessThanOrEqual(Number(hide![1]));
});

test("the hues spelled here are the house's dark-theme roles they name, not copies that can drift", () => {
  // The page cannot load `styles/app.css`, so it spells the hex; this keeps each spelling equal to
  // the token it copies. The dark theme's, because the halo is light on whatever is under it.
  const app = readFileSync(new URL("../styles/app.css", import.meta.url), "utf8");
  const dark = app.slice(app.indexOf('[data-theme="dark"] {'), app.indexOf('[data-theme="light"] {'));
  const value = (sheet: string, name: string) => sheet.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
  const copies: [string, string][] = [
    ["--halo-speak", "--accent"],
    ["--halo-think", "--role-agent"],
    ["--halo-gate", "--role-human"],
  ];
  for (const [halo, token] of copies) {
    expect(value(dark, token), token).toMatch(/^#[0-9a-f]{6}$/i);
    expect(value(css, halo), `${halo} copies ${token}`).toBe(value(dark, token));
  }
});

test("the halo page does not load the app's sheet, so every custom property it reads it also defines", () => {
  const defined = new Set([...css.matchAll(/(--[a-z][\w-]*)\s*:/g)].map((m) => m[1]));
  const read = [...css.matchAll(/var\((--[a-z][\w-]*)/g)].map((m) => m[1]);
  expect(read.length).toBeGreaterThan(0);
  for (const name of read) expect(defined.has(name), name).toBe(true);
});

test("the caption's who-label is a spelled size of at least 12px, not a step from a sheet the page lacks", () => {
  const size = rule(".caption .who").match(/font-size:\s*(\d+)px/);
  expect(size).not.toBeNull();
  expect(Number(size![1])).toBeGreaterThanOrEqual(12);
});

test("idle fades the edges, not the page: the caption lives inside the root and lingers after her reply", () => {
  expect(rule('.halo[data-phase="idle"]')).toContain("--live: 0");
  expect(rule('.halo[data-phase="idle"]')).not.toMatch(/(^|\s)opacity:/);
  expect(rule(".halo")).not.toMatch(/(^|\s)opacity:/);
  expect(rule(".halo")).toContain("transition: --live 400ms");
  expect(css).toMatch(/@property --live \{[^}]*initial-value: 1/);
  // every steady edge opacity is scaled by it, so a still glow does not show at idle either
  expect(rule(".edge")).toContain("* var(--live)");
  expect(rule('.halo[data-phase="thinking"] .edge')).toContain("var(--live)");
  expect(css.slice(css.indexOf("prefers-reduced-motion"))).toContain("opacity: calc(0.8 * var(--live))");
});
