/** Tests for the Projects scene's model and the orrery's geometry — README section 3.5, ADR 0225. No DOM. */
import { describe, expect, it } from "vitest";

import { isValid } from "@/depth/model";
import { CORE } from "@/lib/spaces";

import { fixtures, RENOVATION } from "./fixtures";
import { labelOf } from "./live";
import { spaceAsked } from "./live-view";
import {
  briefLine,
  countsLine,
  haloOf,
  MAX_MOONS,
  MAX_ORBITS,
  memoryPath,
  moonAngles,
  moonCapacity,
  orbitOf,
  orbitRadius,
  orrery,
  PLANE,
  projectApp,
  projectPath,
  spaceOfItem,
  spotOf,
} from "./model";

const typical = fixtures.typical!;

describe("places", () => {
  it("names a project by its id, core by `core` and never by the empty string, each with a memory below", () => {
    expect(projectPath(RENOVATION.id)).toEqual({ root: "projects", item: RENOVATION.id });
    expect(projectPath(CORE)).toEqual({ root: "projects", item: "core" });
    expect(memoryPath(CORE)).toEqual({ root: "projects", item: "core", sub: { kind: "memory" } });
    for (const p of [projectPath(RENOVATION.id), projectPath(CORE), memoryPath(RENOVATION.id), memoryPath(CORE)]) {
      expect(isValid(p), JSON.stringify(p)).toBe(true);
    }
  });

  it("reads a path item back into the space it names, and a path into the space it asks to be in", () => {
    expect(spaceOfItem("core")).toBe(CORE);
    expect(spaceOfItem(RENOVATION.id)).toBe(RENOVATION.id);
    expect(spaceOfItem(undefined)).toBeNull();
    expect(spaceAsked({ root: "projects" })).toBeNull();
    expect(spaceAsked({ root: "projects", item: "core", sub: { kind: "memory" } })).toBe(CORE);
    expect(spaceAsked({ root: "chores", item: RENOVATION.id })).toBeNull();
  });

  it("calls a project by its name in the crumbs, core Core, and the memory level Memory", () => {
    const spaces = typical.projects.map((p) => p.space);
    expect(labelOf(spaces, projectPath(RENOVATION.id))).toBe("Renovation");
    expect(labelOf(spaces, projectPath(CORE))).toBe("Core");
    expect(labelOf(spaces, memoryPath(RENOVATION.id))).toBe("Memory");
    expect(labelOf(spaces, { root: "projects" })).toBeUndefined();
    expect(labelOf(spaces, projectPath("spc_999999999999"))).toBeUndefined();
  });
});

describe("the model", () => {
  it("orders the projects oldest first, so a ring never jumps when another is edited", () => {
    expect(typical.projects.map((p) => p.space.name)).toEqual(["Renovation", "Taxes 2026", "Garden club"]);
  });

  it("says a project in one line, and its brief by its first line", () => {
    expect(countsLine(typical.projects[0]!)).toBe("3 apps · 4 chores · 212 memories");
    expect(countsLine(typical.projects[2]!)).toBe("0 apps · 0 chores · 0 memories");
    expect(briefLine(RENOVATION.brief)).toBe("The kitchen and the bathroom, from quotes to the last invoice.");
    expect(briefLine("\n\n  ")).toBe("");
  });

  it("draws a registered app with its standing, and a forgotten origin as an app not opened", () => {
    const [invoicing, crm, builder] = typical.projects[0]!.apps;
    expect(invoicing).toMatchObject({ host: "localhost:3004", registered: true });
    expect(crm!.standing).toBe("disabled");
    expect(builder).toEqual({
      origin: "https://builder.example.test",
      host: "builder.example.test",
      monogram: "B",
      standing: "closed",
      registered: false,
    });
    expect(projectApp("not a url", []).host).toBe("not a url");
  });

  it("knows which project is active and which waits, and links each chore to its own", () => {
    expect(typical.projects[0]!.active).toBe(true);
    expect(typical.projects[0]!.chores.map((c) => c.title)).toHaveLength(4);
    expect(typical.projects[1]!.chores.map((c) => c.title)).toEqual(["Sort this year's receipts"]);
    const switching = fixtures.switching!;
    expect(switching.projects.find((p) => p.pending)?.space.name).toBe("Renovation");
    expect(switching.projects.find((p) => p.active)?.space.name).toBe("Taxes 2026");
  });
});

describe("the orrery's geometry", () => {
  it("spaces the rings from the inside out, inside the plane, never further apart than the gap", () => {
    for (const count of [1, 2, 3, 9, MAX_ORBITS]) {
      const radii = Array.from({ length: count }, (_, i) => orbitRadius(i, count));
      for (const r of radii) {
        expect(r).toBeGreaterThanOrEqual(PLANE.inner);
        expect(r).toBeLessThanOrEqual(PLANE.outer);
      }
      for (let i = 1; i < radii.length; i++) {
        expect(radii[i]! - radii[i - 1]!).toBeGreaterThan(0);
        expect(radii[i]! - radii[i - 1]!).toBeLessThanOrEqual(PLANE.gap + 1e-9);
      }
    }
  });

  it("draws at most MAX_ORBITS rings and lists the rest", () => {
    const nine = orrery(fixtures.heavy!.projects);
    expect(nine.rings).toHaveLength(9);
    expect(nine.rest).toHaveLength(0);
    const many = Array.from({ length: MAX_ORBITS + 3 }, () => fixtures.typical!.projects[0]!);
    const cut = orrery(many);
    expect(cut.rings).toHaveLength(MAX_ORBITS);
    expect(cut.rest).toHaveLength(3);
  });

  it("puts a ring's moons evenly around it, none born under its name", () => {
    const angles = moonAngles(4, 30);
    expect(angles).toEqual([75, 165, 255, 345]);
    for (const a of angles) expect(Math.abs(((a - 30 + 540) % 360) - 180)).toBeLessThan(180);
  });

  it("shows at most the moons a ring has room for, and the rest as one +N moon, said as such", () => {
    expect(moonCapacity(PLANE.inner)).toBeLessThanOrEqual(MAX_MOONS);
    expect(moonCapacity(0.01)).toBe(3);
    const crowded = fixtures.full!.projects.find((p) => p.apps.length === 24)!;
    const orbit = orbitOf(crowded, 0, 2);
    expect(orbit.moons.length + orbit.more).toBe(24);
    expect(orbit.more).toBeGreaterThan(0);
    const small = orbitOf(typical.projects[0]!, 0, 3);
    expect(small.moons).toHaveLength(3);
    expect(small.more).toBe(0);
  });

  it("lights the halo on a log scale: nothing is faint, a thousand is full, and a dozen already shows", () => {
    expect(haloOf(0)).toBe(0);
    expect(haloOf(12)).toBeGreaterThan(0.3);
    expect(haloOf(212)).toBeLessThan(haloOf(1000));
    expect(haloOf(1000)).toBe(1);
    expect(haloOf(100_000)).toBe(1);
  });

  it("places a point on the tilted ring: as wide as the radius, half as tall", () => {
    expect(spotOf(0, 0.5)).toEqual({ x: 25, y: 0 });
    expect(spotOf(90, 0.5)).toEqual({ x: 0, y: 25 * PLANE.tilt });
    expect(spotOf(180, 1).x).toBe(-50);
  });
});
