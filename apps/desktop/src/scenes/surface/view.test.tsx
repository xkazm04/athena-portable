/** Tests for the surface's view — README section 3.1, ADR 0026 and 0087. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { fixtureIds, fixtures } from "./fixtures";
import SurfaceView from "./view";

const html = (fixture: string) => renderToStaticMarkup(<SurfaceView model={fixtures[fixture]!} />);

describe("every fixture renders", () => {
  for (const id of fixtureIds) {
    it(id, () => {
      expect(html(id)).toContain("surface__marquee");
    });
  }
});

describe("her face", () => {
  it("replaces the Bell exactly when a face is chosen, at the Bell's size, naming her pose", async () => {
    // The face is its own chunk (first paint, ADR 0095): the first render asks for it, the Bell
    // holds the slot until it has arrived, and the next render draws the face.
    html("face");
    await import("./face");
    await new Promise((r) => setTimeout(r, 0));
    const face = html("face");
    expect(face).toContain('data-avatar="b04-owl"');
    expect(face).not.toContain('class="bell"');
    expect(face).toContain("width:420px");
    expect(face).toContain('aria-label="Athena, working"');
    expect(html("face origami")).toContain('data-avatar="d08-origami"');
    for (const id of fixtureIds.filter((f) => !f.startsWith("face"))) {
      expect(html(id), id).toContain('class="bell"');
      expect(html(id), id).not.toContain("data-avatar");
    }
    const origami = renderToStaticMarkup(<SurfaceView model={{ ...fixtures.typical!, avatar: "d08-origami" }} />);
    expect(origami).toContain('data-avatar="d08-origami"');
    expect(origami.match(/data-avatar=/g)).toHaveLength(1);
  });
});

describe("the surface", () => {
  it("draws her, and names her pose to a screen reader", () => {
    expect(html("typical")).toContain('aria-label="Athena, resting"');
    expect(html("asking")).toContain('aria-label="Athena, waiting on you"');
  });

  it("offers all five depths as buttons with their stat", () => {
    const h = html("typical");
    for (const word of ["Projects", "Chores", "Accounts", "Voice", "Mind"]) {
      expect(h).toContain(`surface__light-name">${word}<`);
    }
    expect(h).toContain("12 of 16 tested · $551 back found");
    expect(h).not.toContain(`surface__light-name">Apps<`); // Apps left the surface (ADR 0225)
    expect(h.match(/class="surface__light focus-ring"/g)).toHaveLength(5);
  });

  it("marks a light that needs the person", () => {
    expect(html("typical")).toMatch(/data-attention="true"/);
  });

  it("says she is resting, and what she is doing when she works", () => {
    expect(html("typical")).toContain(">Athena is resting<");
    expect(html("working")).toContain(">Reading Invoices<");
  });

  it("sends the person to her window when a card waits, and does not answer it here", () => {
    const h = html("asking");
    expect(h).toContain("Open her window to answer (2)");
    expect(h).not.toMatch(/Approve|Decline/);
    expect(html("typical")).not.toContain("Open her window to answer");
  });
});

describe("her illustration is the switch for her window", () => {
  it("is a button that says it shows her window while it is put away", () => {
    const h = html("typical");
    expect(h).toMatch(/<button type="button" class="surface__bell focus-ring" aria-label="Show Athena&#x27;s window">/);
    expect(h).not.toContain("Put Athena&#x27;s window away");
  });

  it("says it puts her window away while it is out", () => {
    const h = html("window out");
    expect(h).toContain('aria-label="Put Athena&#x27;s window away"');
    expect(h).not.toContain("Show Athena&#x27;s window");
  });

  it("holds her drawing inside the button", () => {
    expect(html("typical")).toMatch(/class="surface__bell focus-ring"[^>]*>\s*<svg[^>]*class="bell"/);
  });
});

describe("the ask box is the hand-over, and says so", () => {
  it("names where the words go", () => {
    expect(html("typical")).toContain("Your words go to her own window");
    expect(html("typical")).toContain("Hand it to her");
  });
  it("is off in a plain browser, with the reason", () => {
    const h = html("degraded");
    expect(h).toContain('disabled=""');
    expect(h).toContain("only there in the app");
  });
});

describe("a light that needs the person says so in its name, not only in a dot", () => {
  it("names the standing and adds needs you only where the model says attention", () => {
    const h = html("typical");
    expect(h).toContain('aria-label="Mind, ');
    expect(h.match(/aria-label="[^"]*needs you"/g)).toHaveLength(h.match(/data-attention="true"/g)!.length);
    expect(h.match(/data-attention="true"/g)!.length).toBeGreaterThan(0);
  });
});

describe("what needs you is a short list of dives", () => {
  it("case 6: draws no list when nothing needs you, and three plus a '+N more' when four or more do", () => {
    expect(fixtures["all well"]!.needs).toEqual([]);
    expect(html("all well")).not.toContain("surface__needs");
    const many = fixtures["many needs"]!;
    expect(many.needs.length).toBeGreaterThanOrEqual(4);
    const h = html("many needs");
    expect(h.match(/class="surface__need focus-ring"/g)).toHaveLength(3);
    expect(h).toContain(`>+${many.needs.length - 3} more<`);
  });

  it("names each need with its word and its reason, before the press", () => {
    const h = html("typical");
    expect(h).toContain('aria-label="What needs you now"');
    expect(h).toContain('surface__need-label">Gmail<');
    expect(h).toContain('surface__need-word">needs reconnecting<');
    expect(h).toContain("Gmail let the grant go; connect again to continue.");
  });

  it("case 7 (guard): a card waiting stays the summon and is never a need", () => {
    const h = html("asking");
    expect(h).toContain("Open her window to answer (2)");
    expect(fixtures.asking!.needs.every((n) => n.to.root !== null)).toBe(true);
    expect(fixtures.asking!.needs.some((n) => /waiting|answer/i.test(n.line + n.word))).toBe(false);
  });
});

describe("the lights' glyphs", () => {
  it("case 7: the view passes each light's facts to its glyph", () => {
    const lights = fixtures.typical!.lights.map((l) =>
      l.root === "chores" ? { ...l, art: { attention: false, filled: 0, of: 12 } } : l.root === "accounts" ? { ...l, attention: false, art: { attention: false, filled: 1, of: 3 } } : l,
    );
    const quiet = renderToStaticMarkup(<SurfaceView model={{ ...fixtures.typical!, lights }} />);
    expect(quiet).not.toContain("var(--status-success)");
    expect(quiet).not.toContain("var(--status-warning)");
    expect(html("typical")).toContain("var(--status-warning)");
  });
});
