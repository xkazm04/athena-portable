/**
 * The module contract, asserted on every module in the registry at once — plan §10.
 *
 * This is the test that stops the contract from being a document. Every module must render
 * against every fixture it ships, with no store, no IPC and no shell in the process: that is the
 * whole claim the preview harness rests on, and `renderToStaticMarkup` is the cheapest way to
 * make it a red test rather than a discovery. A view that reaches for a store fails here, in
 * Node, before anyone opens a window.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { DEFAULT_MODULE_ID, MODULE_ENTRIES, MODULE_REGISTRY, isModuleId, moduleFor } from "./registry";

test("every module is registered under its own id, once", () => {
  expect(MODULE_ENTRIES.length).toBeGreaterThan(0);
  for (const entry of MODULE_ENTRIES) {
    expect(MODULE_REGISTRY[entry.id]).toBe(entry);
  }
  const ids = MODULE_ENTRIES.map((m) => m.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("the default module resolves, and an unknown id falls back to it rather than blanking", () => {
  expect(isModuleId(DEFAULT_MODULE_ID)).toBe(true);
  expect(moduleFor("not-a-module").id).toBe(DEFAULT_MODULE_ID);
  expect(moduleFor(null).id).toBe(DEFAULT_MODULE_ID);
  expect(moduleFor("browser").id).toBe("browser");
});

test("every module ships the four fixtures the contract asks for", () => {
  for (const entry of MODULE_ENTRIES) {
    for (const required of ["empty", "typical", "heavy", "degraded"]) {
      expect(entry.fixtureIds, `${entry.id} is missing the ${required} fixture`).toContain(required);
    }
    expect(entry.label.length).toBeGreaterThan(0);
    expect(entry.blurb.length).toBeGreaterThan(0);
  }
});

test("every module renders against every fixture with no shell", () => {
  for (const entry of MODULE_ENTRIES) {
    for (const fixture of entry.fixtureIds) {
      const html = renderToStaticMarkup(entry.preview(fixture));
      expect(html.length, `${entry.id}/${fixture} rendered nothing`).toBeGreaterThan(0);
    }
  }
});
