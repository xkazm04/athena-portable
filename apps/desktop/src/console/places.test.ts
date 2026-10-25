/**
 * The finder's corpus and its ranking — README section 3.5, ADR 0087. Pure: no DOM, no store.
 */
import { describe, expect, it } from "vitest";

import { ROOTS, formatHash, isValid, itemsOf, samePath, type Path } from "@/depth/model";

import { placesOf, rank, type Place } from "./places";

const SOURCES = {
  projects: [{ id: "spc_0123456789ab", name: "Renovation" }],
  apps: [{ item: "host-1", label: "Ledgerbox" }],
  chores: [{ id: "invoice-chase", title: "Invoice chase" }],
  accounts: [{ id: "gh", label: "GitHub" }],
};

const has = (places: readonly Place[], path: Path) => places.some((p) => samePath(p.path, path));
const at = (places: readonly Place[], path: Path) => places.find((p) => samePath(p.path, path))!;

describe("placesOf", () => {
  const places = placesOf(SOURCES);

  it("holds the roots, the grammar's fixed items, New chore and every app, chore and account, each legal with its crumb trail", () => {
    for (const root of ROOTS) expect(has(places, { root }), root).toBe(true);
    for (const root of ["voice", "mind"] as const) {
      expect(itemsOf(root).length).toBeGreaterThan(0);
      for (const item of itemsOf(root)) expect(has(places, { root, item }), `${root}/${item}`).toBe(true);
    }
    expect(at(places, { root: "chores", item: "new" }).crumb).toBe("Chores > New chore");
    expect(has(places, { root: "apps", item: "host-1" })).toBe(true);
    expect(has(places, { root: "accounts", item: "gh" })).toBe(true);
    for (const p of places) expect(isValid(p.path), formatHash(p.path)).toBe(true);
    const chore = at(places, { root: "chores", item: "invoice-chase" });
    expect(chore.trail).toEqual(["Chores", "Invoice chase"]);
    expect(chore.crumb).toBe("Chores > Invoice chase");
    expect(at(places, { root: "apps", item: "host-1" }).crumb).toBe("Apps > Ledgerbox");
    expect(at(places, { root: "accounts", item: "gh" }).crumb).toBe("Accounts > GitHub");
  });

  it("names a place in the console's words when it is given its labeller, and drops an id the grammar refuses", () => {
    const named = placesOf({ ...SOURCES, chores: [...SOURCES.chores, { id: "", title: "Blank" }] }, (p) =>
      p.root === "mind" && p.item === "mic" ? "Microphone" : undefined,
    );
    expect(at(named, { root: "mind", item: "mic" }).crumb).toBe("Mind > Microphone");
    expect(named.some((p) => p.trail.includes("Blank"))).toBe(false);
  });
});

describe("placesOf, the projects (ADR 0225)", () => {
  it("lists each project under Projects by its name, and Athena's core as Core even with no project", () => {
    const places = placesOf(SOURCES);
    expect(at(places, { root: "projects", item: "spc_0123456789ab" }).crumb).toBe("Projects > Renovation");
    expect(at(places, { root: "projects", item: "core" }).crumb).toBe("Projects > Core");
    expect(rank("renov", places)[0]!.path).toEqual({ root: "projects", item: "spc_0123456789ab" });
    // Apps stay places of their own: a project does not hide the app root or its apps.
    expect(has(places, { root: "apps" })).toBe(true);
    const none = placesOf({ ...SOURCES, projects: [] });
    expect(at(none, { root: "projects", item: "core" }).crumb).toBe("Projects > Core");
    expect(none.filter((p) => p.path.root === "projects").map((p) => p.path.item)).toEqual([undefined, "core"]);
  });

  it("never lets a project take core's item, and names a project with no name", () => {
    const places = placesOf({
      ...SOURCES,
      projects: [
        { id: "core", name: "Impostor" },
        { id: "spc_ba9876543210", name: "" },
      ],
    });
    expect(at(places, { root: "projects", item: "core" }).crumb).toBe("Projects > Core");
    expect(at(places, { root: "projects", item: "spc_ba9876543210" }).crumb).toBe("Projects > Untitled project");
  });
});

describe("rank", () => {
  const places = placesOf(SOURCES);

  it("puts a word-start hit first, and returns nothing below the floor", () => {
    expect(rank("inv", places)[0]!.path).toEqual({ root: "chores", item: "invoice-chase" });
    expect(rank("mdev", places)[0]!.path).toEqual({ root: "mind", item: "devices" });
    expect(rank("zzq", places)).toEqual([]);
  });

  it("with no query lists the recent places first, never the one you are in, then the roots", () => {
    const engine: Path = { root: "mind", item: "engine" };
    const chore: Path = { root: "chores", item: "invoice-chase" };
    const out = rank("", places, { recent: [engine, chore], here: chore });
    expect(out[0]!.path).toEqual(engine);
    expect(out.some((p) => samePath(p.path, chore))).toBe(false);
    expect(out.slice(1).map((p) => p.path)).toEqual(ROOTS.map((root) => ({ root })));
  });

  it("orders equal scores by recency, then by the path's hash, the same on every run", () => {
    const twins = placesOf({
      projects: [],
      apps: [],
      chores: [
        { id: "b-chase", title: "Chase" },
        { id: "a-chase", title: "Chase" },
        { id: "c-chase", title: "Chase" },
      ],
      accounts: [],
    });
    const ids = (out: readonly Place[]) => out.filter((p) => p.trail.at(-1) === "Chase").map((p) => p.path.item);
    expect(ids(rank("chase", twins))).toEqual(["a-chase", "b-chase", "c-chase"]);
    expect(ids(rank("chase", [...twins].reverse()))).toEqual(["a-chase", "b-chase", "c-chase"]);
    expect(ids(rank("chase", twins, { recent: [{ root: "chores", item: "c-chase" }] }))).toEqual([
      "c-chase",
      "a-chase",
      "b-chase",
    ]);
  });
});
