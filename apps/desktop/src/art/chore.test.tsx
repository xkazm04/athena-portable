/** Tests for the chore drawings — README section 3.1, ADR 0040 and 0087. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ChoreArt, { MAX_WINDOWS, windowsFor, type ChoreArtFacts } from "./chore";

const base: ChoreArtFacts = { id: "carrier-refunds", portals: 3, gates: 2, traps: 2, audience: "work", weight: 0.5, verdict: "exceeds" };
const svg = (f: ChoreArtFacts) => renderToStaticMarkup(<ChoreArt facts={f} />);

describe("a chore's drawing", () => {
  it("is the same every time for the same chore", () => {
    expect(svg(base)).toBe(svg({ ...base }));
  });

  it("is a different drawing for a different chore, even with the same facts", () => {
    expect(svg({ ...base, id: "lien-desk" })).not.toBe(svg(base));
  });

  it("draws one window per portal, up to a crowd limit, and a count beyond it", () => {
    expect(windowsFor({ ...base, portals: 1 })).toHaveLength(1);
    expect(windowsFor({ ...base, portals: 4 })).toHaveLength(4);
    expect(windowsFor({ ...base, portals: 40 })).toHaveLength(MAX_WINDOWS);
    expect(windowsFor({ ...base, portals: 0 })).toHaveLength(1);
    expect(svg({ ...base, portals: 40 })).toContain("M-3 0h6M0 -3v6");
    expect(svg({ ...base, portals: 3 })).not.toContain("M-3 0h6M0 -3v6");
  });

  it("puts a household's chore under a roof and a business's among ledgers", () => {
    expect(svg({ ...base, audience: "home" })).toContain("M20 78 L88 26");
    expect(svg({ ...base, audience: "work" })).not.toContain("M20 78 L88 26");
  });

  it("says the bench's verdict in the seal's line, not only in its colour", () => {
    const ring = (verdict: ChoreArtFacts["verdict"]) => /r="15\.5"[^>]*?stroke-dasharray="([^"]*)"/.exec(svg({ ...base, verdict, gates: 0, traps: 0, portals: 1 }));
    expect(ring("exceeds")?.[1]).toBeUndefined();
    expect(new Set([ring("meets")?.[1], ring("short")?.[1], ring("unbenched")?.[1]]).size).toBe(3);
  });

  it("uses tokens and mixes of them, never a literal colour, and is decorative", () => {
    const h = svg(base);
    expect(h).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
    expect(h).toContain('aria-hidden="true"');
    expect(h).not.toContain("<script");
    expect(h).toContain('data-chore-art="carrier-refunds"');
  });

  it("floats only when asked", () => {
    expect(renderToStaticMarkup(<ChoreArt facts={base} float />)).toContain("chore-art__float");
    expect(svg(base)).not.toContain("chore-art__float");
  });
});
