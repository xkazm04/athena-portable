/** Tests for the engine section and its stylesheet — README section 3.5, ADR 0087 and 0089. */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { fixtures } from "@/modules/setup/fixtures";

import EngineSection from "./EngineSection";

const css = readFileSync(new URL("./engine.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const html = (id: string) => renderToStaticMarkup(<EngineSection model={fixtures[id]!} />);

describe("an engine's standing (house style 4b)", () => {
  it("says it with the shared badge, whose word stays in the foreground and whose hue rides a dot", () => {
    const h = html("typical");
    expect(h).toContain('class="badge typo-label"');
    expect(h).toContain("status-dot--success");
    expect(h).not.toContain("engines__badge");
    expect(css).not.toMatch(/engines__badge/);
  });

  it("warns with a warning dot when the engine is missing", () => {
    expect(html("notFound")).toContain("status-dot--warning");
  });

  it("puts the summary's hue on a dot as well, never on the words", () => {
    const h = html("typical");
    expect(h).toMatch(/class="engines__fact"[^>]*><span class="status-dot status-dot--[a-z]+"/);
    expect(css).not.toMatch(/engines__fact\[data-standing/);
  });
});

describe("copy", () => {
  it("uses the ellipsis character like every other busy label", () => {
    expect(html("checking")).toContain("Checking…");
    expect(html("checking")).not.toContain("Checking...");
  });
});

describe("the chosen card", () => {
  it("eases its edge and glow in and out, on opacity and border colour only", () => {
    expect(css).toMatch(/\.engines__card\s*\{[^}]*transition:[^;]*border-color var\(--duration-fast\)/);
    expect(css).toMatch(/\.engines__card::after\s*\{[^}]*transition:\s*opacity var\(--duration-fast\)/);
    expect(css).not.toMatch(/transition:\s*all/);
    expect(css).not.toMatch(/\.engines__card\[data-chosen="true"\]\s*\{[^}]*box-shadow/);
  });

  it("holds still under Calm", () => {
    expect(css).toMatch(/\[data-motion="calm"\] \.engines__card[\s\S]*transition: none/);
  });
});

describe("spacing", () => {
  it("is the app's density tokens, or the 8px inner gap, never a one-off pad", () => {
    const values = [...css.matchAll(/(?:^|[\s;{])(?:gap|padding)\s*:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(values.length).toBeGreaterThan(4);
    for (const v of values) {
      const ok = v === "0" || v === "8px" || /^var\(--density-(gap|pad|pad-sm)\)( var\(--density-(gap|pad|pad-sm)\))?$/.test(v);
      expect(ok, v).toBe(true);
    }
  });
});

describe("the restart notice", () => {
  it("fades in on the shared depth clock, opacity only", () => {
    expect(css).toMatch(/\.engines__notice\s*\{[^}]*animation:\s*engines-notice-in var\(--dur-depth\) var\(--ease-depth\)/);
    const frames = /@keyframes engines-notice-in\s*\{([\s\S]*?\n\})/.exec(css)?.[1] ?? "";
    const props = [...frames.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) expect(p).toBe("opacity");
  });
});
