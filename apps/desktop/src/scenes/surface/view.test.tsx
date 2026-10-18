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
    for (const id of fixtureIds.filter((f) => f !== "face")) {
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
    for (const word of ["Apps", "Chores", "Accounts", "Voice", "Mind"]) {
      expect(h).toContain(`surface__light-name">${word}<`);
    }
    expect(h).toContain("12 of 16 benched · $551 found");
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
