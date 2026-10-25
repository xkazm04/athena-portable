/** Tests for the Projects scene's view — README section 3.5, ADR 0087, 0090 and 0225. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Path } from "@/depth/model";

import { PATHS, fixtureIds, fixtures } from "./fixtures";
import ProjectsView from "./view";

const go = () => {};
const html = (fixture: string, path: Path = PATHS.field!) =>
  renderToStaticMarkup(<ProjectsView model={fixtures[fixture]!} path={path} go={go} />);

const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;

describe("every fixture renders at every level", () => {
  for (const id of fixtureIds) {
    for (const [name, path] of Object.entries(PATHS)) {
      it(`${id} at ${name}`, () => {
        expect(html(id, path).length).toBeGreaterThan(0);
      });
    }
  }
});

describe("the field", () => {
  it("draws one ring per project, each carrying its apps as moons", () => {
    const h = html("typical");
    expect(count(h, /class="orbit"/g)).toBe(3);
    // Renovation has 3 apps, Taxes 2026 two, the Garden club none.
    expect(count(h, /class="moon"/g)).toBe(5);
    expect(count(h, /class="orb"/g)).toBe(5);
  });

  it("names every project in a button that says its counts and where Athena is", () => {
    const h = html("typical");
    expect(count(h, /class="orrery__name focus-ring"/g)).toBe(3);
    expect(h).toContain('aria-label="Renovation: 3 apps · 4 chores · 212 memories. Athena is working in it. Open it."');
    expect(h).toContain('aria-label="Garden club: 0 apps · 0 chores · 0 memories. Open it."');
    expect(h).toContain(">here</span>");
  });

  it("puts Athena's core at the centre as a button of its own", () => {
    const h = html("typical");
    expect(h).toContain("Athena&#x27;s core: what she knows everywhere. Open it.");
    expect(h).toContain('class="orrery__sun-name">Core<');
  });

  it("tints each ring by its hue and lights its halo by what it remembers", () => {
    const h = html("typical");
    expect(h).toContain("--hue:24");
    expect(h).toMatch(/--halo:0\.7\d*/);
    expect(h).toMatch(/--halo:0"[^>]*data-quiet="1"/);
  });

  it("says the default marquee, the count and where she works", () => {
    const h = html("typical");
    expect(h).toContain('class="projects__marquee">Your projects<');
    expect(h).toContain("Each one keeps its own memory. Core is what Athena knows everywhere.");
    expect(h).toContain("3 projects");
    expect(h).toContain("Athena is in Renovation");
  });

  it("offers a new project by name, and the door to every app", () => {
    const h = html("typical");
    expect(h).toContain('aria-label="Name of the new project"');
    expect(h).toMatch(/maxlength="60"/i);
    expect(h).toContain(">All apps<");
  });

  it("is the sun alone with one line and the new project, when there is none", () => {
    const h = html("empty");
    expect(count(h, /class="orbit"/g)).toBe(0);
    expect(h).toContain('data-lonely="1"');
    expect(h).toContain("No project yet.");
    expect(h).toContain("projects__new projects__new--lead");
    expect(h).toContain("Athena is in core");
  });

  it("says the daemon's reason verbatim when the list could not be read", () => {
    const h = html("degraded");
    expect(h).toContain("offline: The daemon is not running.");
    expect(h).toContain("could not be read");
    expect(h).toContain('role="alert"');
    expect(h).not.toContain("No project yet.");
  });

  it("says reading while the first list has not answered", () => {
    const h = html("reading");
    expect(h).toContain(">reading<");
    expect(h).toContain("Reading your projects…");
  });

  it("holds nine projects as nine rings, and says a crowded ring shows only some of its apps", () => {
    expect(count(html("heavy"), /class="orbit"/g)).toBe(9);
    const full = html("full");
    expect(full).toMatch(/Office move: 24 apps · 4 chores · 212 memories\. \(showing \d+ of 24 apps\) Open it\./);
    expect(full).toMatch(/class="moon moon--more">\+\d+</);
  });

  it("says a switch that waits on the running turn", () => {
    expect(html("switching")).toContain("switches to Renovation after this turn");
  });
});

describe("a project", () => {
  const h = html("typical", PATHS.project);

  it("is its name in display type, its counts, and that Athena works in it", () => {
    expect(h).toContain('class="projects__marquee projects__marquee--project">Renovation<');
    expect(h).toContain("3 apps · 4 chores · 212 memories");
    expect(h).toContain("Athena is working in this project");
    expect(h).toContain('aria-label="Rename Renovation"');
  });

  it("edits the brief in a labelled box with its counter and why it matters", () => {
    expect(h).toContain(">Brief</label>");
    expect(h).toContain("Athena reads this every turn while you are in this project.");
    expect(h).toContain(`${"The kitchen and the bathroom, from quotes to the last invoice.\nKeep every quote next to its contractor, and never pay a deposit above 20%.".length}/1600`);
    expect(h).toMatch(/maxlength="1600"/i);
  });

  it("shows its apps as orbs that open their layer, each with a way out", () => {
    expect(h).toContain('aria-label="localhost:3004. Open its layer."');
    expect(h).toContain('aria-label="builder.example.test, not registered. Open its layer."');
    expect(h).toContain('aria-label="Take crm.example.test out of Renovation"');
    expect(h).toContain(">Add app<");
  });

  it("lists its linked chores, a way to link another and to adopt one here", () => {
    expect(h).toContain(">Compare contractor quotes<");
    expect(h).toContain(">Keep the warranties<");
    expect(h).not.toContain(">Claim flight delays<");
    expect(h).toContain(">Link a chore<");
    expect(h).toContain(">Adopt one here<");
  });

  it("counts its memory by kind and links to it", () => {
    expect(h).toMatch(/Episodes<\/dt><dd[^>]*>168</);
    expect(h).toMatch(/Facts<\/dt><dd[^>]*>38</);
    expect(h).toMatch(/Procedures<\/dt><dd[^>]*>6</);
    expect(h).toContain(">Open its memory<");
  });

  it("offers Erase behind a first press", () => {
    expect(h).toContain('aria-label="Erase Renovation"');
    expect(h).not.toContain("this cannot be undone");
  });

  it("says when a project is unknown, or not read yet", () => {
    expect(html("typical", PATHS.missing)).toContain("No such project");
    expect(html("reading", PATHS.project)).toContain("Reading your projects…");
  });
});

describe("core", () => {
  const h = html("typical", PATHS.core);
  it("says what core is and links its memory, with no brief and no erase", () => {
    expect(h).toContain(">Core<");
    expect(h).toContain("What Athena knows everywhere.");
    expect(h).toContain(">Open core&#x27;s memory<");
    expect(h).not.toContain(">Brief</label>");
    expect(h).not.toContain("Erase");
  });
});

describe("memory", () => {
  it("filters by kind and starts by reading", () => {
    const h = html("typical", PATHS.memory);
    expect(h).toContain('role="radiogroup"');
    expect(h).toContain(">procedures<");
    expect(h).toContain("Reading the memory…");
    expect(h).toContain("Renovation&#x27;s memory");
  });
});
