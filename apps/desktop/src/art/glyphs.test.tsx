/** Tests for the shared glyph stylesheet and the account drawings — README section 3.1, ADR 0087 and 0089. */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountArt } from "./accounts";
import VoiceArt from "./voice";

const css = readFileSync(new URL("./glyphs.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the install ring", () => {
  it("slides to each new poll's progress rather than jumping, and holds still under Calm", () => {
    const h = renderToStaticMarkup(<VoiceArt kind="kokoro" ring={0.4} />);
    expect(h).toContain('class="voice-art__ring"');
    expect(renderToStaticMarkup(<VoiceArt kind="kokoro" />)).not.toContain("voice-art__ring");
    expect(css).toMatch(/\.voice-art__ring\s*\{[^}]*transition:\s*stroke-dasharray var\(--dur-settle\) var\(--ease-settle\)/);
    expect(css).toMatch(/\[data-motion="calm"\] \.voice-art__ring[^{]*\{[^}]*transition: none/);
  });
});

describe("an account's drawing being switched on", () => {
  it("inks over the depth clock instead of snapping, and holds still under Calm", () => {
    expect(css).toMatch(/\.account-art[^{]*\{[^}]*transition:[^;]*stroke var\(--dur-depth\)[^;]*fill var\(--dur-depth\)/);
    expect(css).toMatch(/\[data-motion="calm"\] \.account-art[^{]*\{[^}]*transition: none/);
    expect(css).not.toMatch(/transition:\s*all/);
  });

  it("gives the plinth a fill colour in both states, so the fill can ease and not switch from none", () => {
    for (const lit of [true, false]) {
      const h = renderToStaticMarkup(<AccountArt id="gmail" lit={lit} />);
      expect(h).toMatch(/<ellipse[^>]*fill="color-mix/);
    }
  });
});
