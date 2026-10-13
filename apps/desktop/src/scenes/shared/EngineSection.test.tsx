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
});
