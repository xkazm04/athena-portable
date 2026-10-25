/** Tests for the shared glyph stylesheet and the account drawings — README section 3.1, ADR 0087 and 0089. */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ROOTS, type Root } from "@/depth/model";

import { AccountArt } from "./accounts";
import Glyph, { type GlyphFacts } from "./glyphs";
import InstrumentArt from "./mind";
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

describe("the depth glyphs draw their light's live facts", () => {
  const draw = (root: Root, facts: GlyphFacts) => renderToStaticMarkup(<Glyph root={root} facts={facts} />);
  const STATUS = /var\(--status-/;

  it("case 1: the accounts drawing carries no warning when no account needs the person", () => {
    expect(draw("accounts", { attention: false, filled: 2, of: 3 })).not.toContain("var(--status-warning)");
  });

  it("case 2: an account under attention carries the warning as a shape, a dot and a ring, not by hue alone", () => {
    const h = draw("accounts", { attention: true, filled: 1, of: 3 });
    expect(h).toMatch(/<circle[^>]*fill="var\(--status-warning\)"/);
    expect(h).toMatch(/<circle[^>]*fill="none"[^>]*stroke="var\(--status-warning\)"/);
  });

  it("case 3: the chores drawing wears the success mark only once something is tested", () => {
    expect(draw("chores", { attention: false, filled: 0, of: 12 })).not.toContain("var(--status-success)");
    expect(draw("chores", { attention: false, filled: 3, of: 12 })).toContain("var(--status-success)");
  });

  it("case 4: the apps drawing inks one window frame per app switched on, the rest muted outlines", () => {
    const inked = (h: string) => (h.match(/<rect[^>]*stroke="var\(--accent\)"/g) ?? []).length;
    expect(inked(draw("apps", { attention: false, filled: 2, of: 5 }))).toBe(2);
    const none = draw("apps", { attention: false, filled: 0, of: 0 });
    expect(inked(none)).toBe(0);
    const frames = none.match(/<rect[^>]*>/g) ?? [];
    expect(frames).toHaveLength(3);
    for (const f of frames) expect(f).toContain('stroke="var(--muted-foreground)"');
  });

  it("case 5: a count that is not known (of: null) draws no status at all, for every root", () => {
    for (const root of ROOTS) {
      for (const attention of [false, true]) {
        expect(draw(root, { attention, filled: 1, of: null }), `${root} ${attention}`).not.toMatch(STATUS);
      }
    }
  });

  it("case 6: the voice waves are dashed and muted until her voice is ready; Mind rings its core in the warning shape", () => {
    const waves = (h: string) => h.match(/<path d="M(86 22|34 22)[^>]*>/g) ?? [];
    const off = waves(draw("voice", { attention: false, filled: 0, of: 1 }));
    expect(off).toHaveLength(2);
    for (const w of off) {
      expect(w).toContain('stroke="var(--muted-foreground)"');
      expect(w).toContain("stroke-dasharray");
    }
    const on = waves(draw("voice", { attention: false, filled: 1, of: 1 }));
    expect(on).toHaveLength(2);
    for (const w of on) {
      expect(w).toContain('stroke="var(--accent)"');
      expect(w).not.toContain("stroke-dasharray");
    }
    const mind = draw("mind", { attention: true, filled: 0, of: 1 });
    expect(mind).toMatch(/<circle cx="60" cy="46"[^>]*fill="var\(--status-warning\)"/);
    expect(mind).toMatch(/<circle cx="60" cy="46"[^>]*fill="none"[^>]*stroke="var\(--status-warning\)"/);
    expect(mind).not.toContain('fill="var(--foreground)"');
    expect(draw("mind", { attention: false, filled: 1, of: 1 })).not.toMatch(STATUS);
  });

  it("case 8 (guard): every root in every state is decorative, floats, and uses tokens only; Mind and Engine draw the same facet", () => {
    const states: Record<string, GlyphFacts> = {
      unknown: { attention: false, filled: 0, of: null },
      empty: { attention: false, filled: 0, of: 0 },
      partial: { attention: false, filled: 1, of: 3 },
      full: { attention: false, filled: 3, of: 3 },
      attention: { attention: true, filled: 1, of: 3 },
    };
    for (const root of ROOTS) {
      for (const [name, facts] of Object.entries(states)) {
        const h = draw(root, facts);
        expect(h, `${root} ${name}`).toContain('aria-hidden="true"');
        expect(h, `${root} ${name}`).toContain('focusable="false"');
        expect(h, `${root} ${name}`).toContain('class="glyph__float"');
        expect(h, `${root} ${name}`).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
      }
    }
    expect(renderToStaticMarkup(<InstrumentArt item="engine" />)).toBe(renderToStaticMarkup(<Glyph root="mind" />));
  });
});
