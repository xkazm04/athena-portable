/**
 * The theme contract over the real sheets, and the defects it must catch — README section 3.1,
 * ADR 0023 and 0142. Cases three to six are seeded-red negative controls: a contract that cannot
 * fail on them cannot be trusted when it passes.
 */
import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "vitest";

import { BASE_SKIN, SKINS, THEMES } from "@/stores/shell";

import { bindingSets, checkThemeContract } from "./theme-contract";

const at = (rel: string) => new URL(rel, import.meta.url);
const read = (rel: string) => readFileSync(at(rel), "utf8");
const base = read("./app.css");
const sheetIds = readdirSync(at("./skins/"))
  .filter((n) => n.endsWith(".css"))
  .map((n) => n.slice(0, -".css".length));
const skinSheets = Object.fromEntries(sheetIds.map((id) => [id, read(`./skins/${id}.css`)]));
const realSets = bindingSets(sheetIds);

test("binding sets are derived from THEMES x SKINS against the sheets, and a gap fails naming it", () => {
  expect(realSets.map((s) => s.id)).toEqual(["athena/dark", "athena/light", "loop-tide/dark", "loop-tide/light", "wavefront/dark", "wavefront/light"]);
  expect(() => bindingSets(sheetIds, { themes: THEMES, skins: [...SKINS, "ember"], baseSkin: BASE_SKIN })).toThrow(
    'SKINS entry "ember" has no styles/skins/ember.css',
  );
  expect(() => bindingSets([...sheetIds, "dusk"])).toThrow("styles/skins/dusk.css has no SKINS entry");
});

test("every text pair clears 4.5:1 and every graphic pair 3:1 in all four sets of the real sheets", () => {
  expect(checkThemeContract({ base, skins: skinSheets, sets: realSets })).toEqual([]);
});

const fixtureSets = bindingSets(["x"], { themes: THEMES, skins: [BASE_SKIN, "x"], baseSkin: BASE_SKIN });

test("negative control: a role the skin binds in its dark block only is reported as taking the dark value in light", () => {
  const x = ':root[data-skin="x"] {\n  --status-info: #5cb4ff;\n}\n:root[data-skin="x"][data-theme="light"] {\n  --focus: #0064e0;\n}\n';
  expect(checkThemeContract({ base, skins: { x }, sets: fixtureSets })).toContain("x/light: --status-info takes the skin's dark value");
});

test("negative control: a light pair under the floor is reported with its ratio", () => {
  const x = ':root[data-skin="x"][data-theme="light"] {\n  --muted-foreground: #8a94a6;\n  --card-bg: #f8faff;\n}\n';
  expect(checkThemeContract({ base, skins: { x }, sets: fixtureSets })).toContain("x/light --muted-foreground on --card-bg 2.9 < 4.5");
});

test("negative control: a role whose var() chain ends at an undeclared property is unresolved", () => {
  const broken = base.replace("--line: var(--border-default);", "--line: var(--nope);");
  expect(broken).not.toBe(base);
  expect(checkThemeContract({ base: broken, skins: skinSheets, sets: realSets })).toContain("--line unresolved in athena/dark");
});

test("zero input is fatal: a sheet with no theme block throws, never a green empty answer", () => {
  expect(() => checkThemeContract({ base: ".x { color: red; }", skins: {}, sets: realSets })).toThrow("no binding set");
  expect(() => checkThemeContract({ base, skins: skinSheets, sets: [] })).toThrow("no binding set");
});

test("the entries name no skin sheet: each imports @/styles/skins, whose eager glob covers every sheet", () => {
  for (const entry of ["../athena.tsx", "../chrome.tsx", "../preview.tsx"]) {
    const text = read(entry);
    expect(text, entry).not.toMatch(/styles\/skins\/[\w-]+\.css/);
    expect(text, entry).toMatch(/^import "@\/styles\/skins";$/m);
  }
  expect(read("./skins/index.ts")).toMatch(/import\.meta\.glob\("\.\/\*\.css", \{ eager: true \}\)/);
});
