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
