/** Tests for the depth model — README section 3.1 and 3.5, ADR 0087 and 0088. No DOM. */
import { describe, expect, it } from "vitest";

import {
  INITIAL,
  ROOTS,
  ROOT_LABEL,
  SURFACE,
  SURFACE_ROOTS,
  crumbs,
  depthOf,
  formatHash,
  isValid,
  itemsOf,
  parentOf,
  parseHash,
  reduce,
  riseLabel,
  samePath,
  shapeOf,
  type DepthState,
  type Path,
} from "./model";

/** Every legal place the grammar allows, for a sample of ids. The properties below run over all. */
function everyPath(): Path[] {
  const out: Path[] = [SURFACE];
  for (const root of ROOTS) out.push({ root });
  const open = ["host-1", "a/b", "web_https_sledger_dtest", "é ü", "100%", "new"]; // "new": the Chores front door
  for (const id of open) {
    out.push({ root: "apps", item: id });
    out.push({ root: "apps", item: id, sub: { kind: "page" } });
    out.push({ root: "apps", item: id, sub: { kind: "tool", arg: "page_read" } });
    out.push({ root: "apps", item: id, sub: { kind: "tool", arg: "x/y z" } });
    out.push({ root: "chores", item: id });
    out.push({ root: "chores", item: id, sub: { kind: "run", arg: "2" } });
    out.push({ root: "chores", item: id, sub: { kind: "adopt" } });
    out.push({ root: "chores", item: id, sub: { kind: "case", arg: "proj_0123456789ab" } });
    out.push({ root: "accounts", item: id });
    out.push({ root: "accounts", item: id, sub: { kind: "allowlist" } });
    out.push({ root: "projects", item: id });
    out.push({ root: "projects", item: id, sub: { kind: "memory" } });
  }
  for (const item of ["core", "spc_0123456789ab"]) {
    out.push({ root: "projects", item });
    out.push({ root: "projects", item, sub: { kind: "memory" } });
  }
  for (const item of ["studio", "settings"]) out.push({ root: "voice", item });
  for (const item of ["engine", "brain", "look", "data", "mic", "devices"]) out.push({ root: "mind", item });
  return out;
}

const all = everyPath();

describe("the grammar", () => {
  it("accepts every path everyPath builds", () => {
    for (const p of all) expect(isValid(p), JSON.stringify(p)).toBe(true);
  });

  it("refuses places the grammar does not offer", () => {
    const bad: Path[] = [
      { root: "voice", item: "nope" },
      { root: "mind", item: "engine", sub: { kind: "tool", arg: "x" } },
      { root: "apps", item: "a", sub: { kind: "run", arg: "1" } },
      { root: "apps", item: "a", sub: { kind: "adopt" } }, // the studio is a chore's
      { root: "chores", item: "a", sub: { kind: "adopt", arg: "x" } }, // the studio takes none
      { root: "chores", item: "a", sub: { kind: "case" } }, // a case is named by its id
      { root: "apps", item: "a", sub: { kind: "case", arg: "proj_0123456789ab" } }, // a case is a chore's
      { root: "apps", item: "a", sub: { kind: "tool" } }, // a tool needs a name
      { root: "apps", item: "a", sub: { kind: "page", arg: "x" } }, // a page takes none
      { root: "apps", sub: { kind: "page" } }, // a sub-level needs an item
      { root: "chores", item: "" },
      { root: null, item: "a" },
      { root: "constructor" as never },
      { root: "apps", item: "a", sub: { kind: "constructor" as never } },
      { root: "projects", item: "spc_0123456789ab", sub: { kind: "tool", arg: "x" } }, // a tool is an app's
      { root: "projects", item: "core", sub: { kind: "memory", arg: "fact" } }, // memory takes none
      { root: "projects", sub: { kind: "memory" } }, // whose memory?
      { root: "apps", item: "a", sub: { kind: "memory" } }, // memory is a project's
    ];
    for (const p of bad) expect(isValid(p), JSON.stringify(p)).toBe(false);
  });

  it("is never deeper than three moves from the surface", () => {
    for (const p of all) expect(depthOf(p)).toBeLessThanOrEqual(3);
    expect(Math.max(...all.map(depthOf))).toBe(3);
  });
});

describe("the Projects depth (ADR 0225)", () => {
  it("is a root with its own word, whose items are space ids or core, each with a memory below", () => {
    expect(ROOT_LABEL.projects).toBe("Projects");
    for (const p of [
      { root: "projects" },
      { root: "projects", item: "spc_0123456789ab" },
      { root: "projects", item: "spc_0123456789ab", sub: { kind: "memory" } },
      { root: "projects", item: "core" },
      { root: "projects", item: "core", sub: { kind: "memory" } },
    ] satisfies Path[]) {
      expect(isValid(p), JSON.stringify(p)).toBe(true);
      expect(parseHash(formatHash(p))).toEqual(p);
    }
    expect(depthOf({ root: "projects", item: "core", sub: { kind: "memory" } })).toBe(3);
    expect(parseHash("#/projects/spc_0123456789ab/tool/x")).toEqual(SURFACE);
  });

  it("leads the surface, which no longer lights Apps, though Apps stays a place", () => {
    expect([...SURFACE_ROOTS]).toEqual(["projects", "chores", "accounts", "voice", "mind"]);
    expect(SURFACE_ROOTS).not.toContain("apps" as never);
    expect(isValid({ root: "apps", item: "https://a.example.test" })).toBe(true);
    for (const root of SURFACE_ROOTS) expect(ROOTS).toContain(root);
  });

  it("falls back to the item and the sub-level kind where the scene names nothing", () => {
    const c = crumbs({ root: "projects", item: "core", sub: { kind: "memory" } });
    expect(c.map((x) => x.label)).toEqual(["Athena", "Projects", "core", "memory"]);
  });
});

describe("the hash", () => {
  it("round-trips every legal path, including ids with slashes, spaces and percent signs", () => {
    for (const p of all) expect(parseHash(formatHash(p)), formatHash(p)).toEqual(p);
  });

  it("reads the surface from an empty or missing hash", () => {
    expect(parseHash("")).toEqual(SURFACE);
    expect(parseHash("#")).toEqual(SURFACE);
    expect(parseHash("#/")).toEqual(SURFACE);
  });

  it("falls back to the surface on anything that is not a place, and never throws", () => {
    for (const junk of [
      "#/nowhere",
      "#/apps/a/tool", // a tool with no name
      "#/apps/a/run/1",
      "#/voice/nope",
      "#/mind/engine/extra/more/still",
      "#/apps/%E0%A4%A", // a broken escape
      "#/__proto__",
      "#/apps/a/constructor",
      "#apps",
      "apps/a",
    ]) {
      expect(isValid(parseHash(junk)), junk).toBe(true);
    }
    expect(parseHash("#/nowhere")).toEqual(SURFACE);
    expect(parseHash("#/apps/%E0%A4%A")).toEqual(SURFACE);
    expect(parseHash("#/apps/a/tool")).toEqual(SURFACE);
  });

  it("reads a chore's Adopt studio from its link", () => {
    expect(parseHash("#/chores/travel-credit-refunds/adopt")).toEqual({
      root: "chores",
      item: "travel-credit-refunds",
      sub: { kind: "adopt" },
    });
  });

  it("reads a deep link straight to the depth it names", () => {
    expect(parseHash("#/chores/carrier-refunds/run/3")).toEqual({
      root: "chores",
      item: "carrier-refunds",
      sub: { kind: "run", arg: "3" },
    });
  });
});

describe("rise", () => {
  it("reaches the surface from every place in its depth, one level at a time", () => {
    for (const start of all) {
      let s: DepthState = { ...INITIAL, path: start };
      let steps = 0;
      while (s.path.root !== null) {
        const before = depthOf(s.path);
        s = reduce(s, { type: "rise" });
        expect(depthOf(s.path)).toBe(before - 1);
        steps += 1;
        expect(steps).toBeLessThanOrEqual(3);
      }
      expect(steps).toBe(depthOf(start));
    }
  });

  it("stays at the surface, so Escape there is a no-op and never a way out", () => {
    expect(reduce(INITIAL, { type: "rise" })).toBe(INITIAL);
  });

  it("is the parent, and the surface is its own parent", () => {
    for (const p of all) expect(isValid(parentOf(p))).toBe(true);
    expect(parentOf(SURFACE)).toEqual(SURFACE);
  });
});

describe("go", () => {
  it("moves down, up and across, and names the move", () => {
    let s = reduce(INITIAL, { type: "go", to: { root: "apps" } });
    expect(s.move).toBe("down");
    s = reduce(s, { type: "go", to: { root: "apps", item: "a" } });
    expect(s.move).toBe("down");
    s = reduce(s, { type: "go", to: { root: "apps", item: "b" } });
    expect(s.move).toBe("across");
    s = reduce(s, { type: "go", to: { root: "chores" } });
    expect(s.move).toBe("up");
  });

  it("ignores an invalid destination and a move to where it already is", () => {
    const at = reduce(INITIAL, { type: "go", to: { root: "apps" } });
    expect(reduce(at, { type: "go", to: { root: "voice", item: "nope" } })).toBe(at);
    expect(reduce(at, { type: "go", to: { root: "apps" } })).toBe(at);
  });

  it("jumps to the surface from anywhere", () => {
    const deep = reduce(INITIAL, {
      type: "go",
      to: { root: "accounts", item: "gmail", sub: { kind: "allowlist" } },
    });
    const s = reduce(deep, { type: "surface" });
    expect(s.path).toEqual(SURFACE);
    expect(s.move).toBe("up");
  });
});

describe("an interrupted move", () => {
  it("lands where the person last asked, and an older settle cannot cancel the newer move", () => {
    let s = reduce(INITIAL, { type: "go", to: { root: "apps" } });
    const first = s.seq;
    s = reduce(s, { type: "rise" }); // changed their mind mid-dive
    s = reduce(s, { type: "go", to: { root: "mind" } });
    expect(s.path).toEqual({ root: "mind" });

    const stale = reduce(s, { type: "settle", seq: first });
    expect(stale).toBe(s);
    expect(stale.from).not.toBeNull();

    const done = reduce(s, { type: "settle", seq: s.seq });
    expect(done.from).toBeNull();
    expect(done.move).toBe("none");
    expect(done.path).toEqual({ root: "mind" });
  });

  it("counts every accepted move and nothing else", () => {
    let s = INITIAL;
    s = reduce(s, { type: "go", to: { root: "apps" } });
    s = reduce(s, { type: "go", to: { root: "apps" } });
    s = reduce(s, { type: "go", to: { root: "voice", item: "x" } });
    expect(s.seq).toBe(1);
  });
});

describe("the window's shape (ADR 0088)", () => {
  it("is a page only at apps/<app>/page", () => {
    for (const p of all) {
      const page = p.root === "apps" && p.sub?.kind === "page";
      expect(shapeOf(p), JSON.stringify(p)).toBe(page ? "page" : "scene");
    }
  });

  it("returns to the scene on one rise from the page", () => {
    const page: Path = { root: "apps", item: "a", sub: { kind: "page" } };
    expect(shapeOf(page)).toBe("page");
    expect(shapeOf(parentOf(page))).toBe("scene");
  });
});

describe("crumbs and the Rise button", () => {
  it("starts at the surface and walks down to here", () => {
    const p: Path = { root: "apps", item: "host-1", sub: { kind: "tool", arg: "page_read" } };
    const c = crumbs(p);
    expect(c.map((x) => x.label)).toEqual(["Athena", "Apps", "host-1", "page_read"]);
    expect(c.map((x) => x.depth)).toEqual([0, 1, 2, 3]);
    expect(samePath(c[c.length - 1]!.path, p)).toBe(true);
  });

  it("uses the person's words for roots, not module ids", () => {
    expect(ROOT_LABEL.mind).toBe("Mind");
    expect(crumbs({ root: "mind" })[1]!.label).toBe("Mind");
    expect(crumbs({ root: "chores" })[1]!.label).toBe("Chores");
  });

  it("lets a scene name its items", () => {
    const c = crumbs({ root: "apps", item: "web_https_a" }, (p) =>
      p.item === "web_https_a" && p.sub === undefined ? "a.example.test" : undefined,
    );
    expect(c[2]!.label).toBe("a.example.test");
  });

  it("says where one rise lands, and nothing at the surface", () => {
    expect(riseLabel(SURFACE)).toBeNull();
    expect(riseLabel({ root: "apps" })).toBe("Athena");
    expect(riseLabel({ root: "apps", item: "a" })).toBe("Apps");
    expect(riseLabel({ root: "apps", item: "a", sub: { kind: "page" } })).toBe("a");
  });
});

describe("itemsOf", () => {
  it("gives every fixed item a root offers, each a legal place, and none for an open root", () => {
    expect(itemsOf("voice")).toEqual(["studio", "settings"]);
    expect(itemsOf("mind")).toContain("devices");
    for (const root of ROOTS) {
      for (const item of itemsOf(root)) expect(isValid({ root, item }), `${root}/${item}`).toBe(true);
    }
    expect(itemsOf("apps")).toEqual([]);
    expect(itemsOf("chores")).toEqual([]);
    expect(itemsOf("accounts")).toEqual([]);
  });
});
