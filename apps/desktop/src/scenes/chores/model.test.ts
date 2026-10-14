/** Tests for the Chores scene's pure helpers — README section 3.5, ADR 0040 and 0090. */
import { describe, expect, it } from "vitest";

import { isValid, parseHash, formatHash, type Path } from "@/depth/model";

import { facetFor, fixtureIds, fixtures, pathFor } from "./fixtures";
import { labeller } from "./index";
import {
  EDGE_FROM,
  EDGE_ORDER,
  LEDGER_WIDE,
  SPINE_STEPS,
  artFor,
  beforeAfterOf,
  blueprintOf,
  choreAt,
  chorePath,
  emptyLine,
  firstSentence,
  markLabel,
  markPoints,
  markSize,
  nextSort,
  pct,
  pickedRow,
  runPath,
  shortLine,
  stillStep,
  totalsLine,
  turnAt,
  valueCell,
} from "./model";
import { REPLAY_STEP_MS, isPlaying, setPlaying, stopPlaying } from "./replay";

const typical = fixtures.typical!;
const refunds = typical.items.find((v) => v.id === "carrier-refunds")!;

describe("places", () => {
  it("names a chore and a turn by paths the depth grammar accepts, and the hash round-trips", () => {
    for (const p of [chorePath("carrier-refunds"), runPath("carrier-refunds", 0), runPath("carrier-refunds", 8)]) {
      expect(isValid(p)).toBe(true);
      expect(parseHash(formatHash(p))).toEqual(p);
    }
    expect(runPath("a", 2).sub).toEqual({ kind: "run", arg: "3" });
  });

  it("finds a chore by its place, and says nothing for the field or an id this build lacks", () => {
    expect(choreAt(typical, chorePath("carrier-refunds"))?.title).toBe("Late-parcel refunds");
    expect(choreAt(typical, { root: "chores" })).toBeNull();
    expect(choreAt(typical, chorePath("no-such-chore"))).toBeNull();
  });

  it("reads a turn as 0-based from a 1-based number, and refuses anything that is not a turn of this run", () => {
    expect(turnAt(runPath("x", 0), 4)).toBe(0);
    expect(turnAt(runPath("x", 3), 4)).toBe(3);
    const at = (arg: string): Path => ({ root: "chores", item: "x", sub: { kind: "run", arg } });
    expect(turnAt(at("0"), 4)).toBeNull();
    expect(turnAt(at("5"), 4)).toBeNull();
    expect(turnAt(at("two"), 4)).toBeNull();
    expect(turnAt(at("1.5"), 4)).toBeNull();
    expect(turnAt(chorePath("x"), 4)).toBeNull();
  });
});

describe("the marks", () => {
  it("labels a mark for a screen reader with its value, verdict and edge", () => {
    expect(markLabel(refunds)).toBe("Late-parcel refunds: $4,940 a year, Exceeds, on the edge");
  });

  it("sizes marks smaller when the map is crowded, and bigger for more value", () => {
    expect(markSize(1, true)).toBeLessThan(markSize(0, false));
    expect(markSize(1, false)).toBeGreaterThan(markSize(0, false));
  });

  it("keeps a few chores in a cell as the module rings them, and spreads a crowd over a disc", () => {
    const few = markPoints(typical.items);
    typical.items.forEach((v, i) => expect(few[i]).toEqual({ x: v.point.x, y: v.point.y }));

    const heavy = fixtures.shipped!;
    const pts = markPoints(heavy.items);
    expect(pts).toHaveLength(heavy.items.length);
    // No two marks share a place, and none strays more than half a step from its own cell.
    const seen = new Set(pts.map((p) => `${p.x.toFixed(4)}:${p.y.toFixed(4)}`));
    expect(seen.size).toBe(pts.length);
    heavy.items.forEach((v, i) => {
      expect(Math.abs(pts[i]!.x - v.playbook.edge.difficulty)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(pts[i]!.y - v.playbook.edge.usefulness)).toBeLessThanOrEqual(0.5);
    });
    expect(markPoints(heavy.items)).toEqual(pts);
  });

  it("puts the edge zone where the module says a chore is on the edge", () => {
    expect(EDGE_FROM).toBe(3.5);
    expect(pct(0.5)).toBe(0);
    expect(pct(5.5)).toBe(100);
    expect(pct(EDGE_FROM)).toBeGreaterThan(pct(3));
    expect(pct(EDGE_FROM)).toBeLessThan(pct(4));
  });
});

describe("the ledger's words", () => {
  const unbenched = typical.items.find((v) => v.verdict.word === "unbenched")!;

  it("says the bench's totals in one line, and claims nothing when nothing is benched", () => {
    expect(totalsLine(typical)).toBe("3 playbooks · 1 of 2 benched exceed the bar · $551.40 found on the bench");
    expect(totalsLine(fixtures.degraded!)).toBe("1 playbook · none benched yet");
  });

  it("cycles a column's head: most first, then turned round, then the edge's order back", () => {
    let s = EDGE_ORDER;
    s = nextSort(s, "value");
    expect(s).toEqual({ key: "value", dir: "desc" });
    s = nextSort(s, "value");
    expect(s).toEqual({ key: "value", dir: "asc" });
    expect(nextSort(s, "value")).toEqual(EDGE_ORDER);
    expect(nextSort(s, "time")).toEqual({ key: "time", dir: "desc" });
  });

  it("names the area and the job a filter that leaves nothing was set to", () => {
    expect(emptyLine({ category: "health", job: "contest" })).toBe(
      "No playbook in Health & clinics whose job is to win a dispute.",
    );
    expect(emptyLine({ category: "family", job: "all" })).toBe("No playbook in Family & estate.");
    expect(emptyLine({ category: "all", job: "comply" })).toBe("No playbook in any area whose job is to stay compliant.");
  });

  it("keeps the pick while the rows show it, and falls back to the first row when they do not", () => {
    expect(pickedRow(typical.items, "flight-compensation")?.id).toBe("flight-compensation");
    expect(pickedRow(typical.items, "gone")?.id).toBe(typical.items[0]!.id);
    expect(pickedRow([], "gone")).toBeNull();
  });

  it("puts a month's value on the year's scale and leaves a claim's in its own unit", () => {
    const chargebacks = typical.items.find((v) => v.id === "chargeback-evidence")!;
    expect(valueCell(chargebacks)).toEqual({ figure: "$21,600", per: "a year" });
    expect(valueCell(refunds)).toEqual({ figure: "$4,940", per: "a year" });
  });

  it("keeps a long sentence to its first clause, cut at a word", () => {
    expect(shortLine("Agencies charge 25 percent; some charge more.")).toBe("Agencies charge 25 percent");
    const cut = shortLine("word ".repeat(40), 30);
    expect(cut.length).toBeLessThanOrEqual(31);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("draws the blueprint from the playbook alone: its portals, at most six steps, its gates, its result", () => {
    const plan = blueprintOf(refunds);
    expect(plan.portals.map((a) => a.name)).toEqual(refunds.playbook.apps.map((a) => a.name));
    expect(plan.steps.length).toBeLessThanOrEqual(SPINE_STEPS);
    expect(plan.steps.length + plan.more).toBe(refunds.playbook.steps.length);
    expect(plan.gates).toHaveLength(refunds.playbook.gates.length);
    expect(plan.result.measured).toBe(true);
    expect(plan.guard).toEqual({ avoided: 2, of: 2 });
    const bar = blueprintOf(unbenched);
    expect(bar.result.measured).toBe(false);
    expect(bar.result.line).toContain("not benched");
    expect(bar.guard).toBeNull();
  });

  it("sets the chore by hand against her measured run, and says nothing measured when unbenched", () => {
    const band = beforeAfterOf(refunds);
    expect(band.manual.figure).toBe("3 h");
    expect(band.athena?.figure).toMatch(/min$/);
    expect(band.athena?.line).toContain("turns");
    expect(band.ratio).toBe(refunds.speed);
    expect(beforeAfterOf(unbenched).athena).toBeNull();
  });

  it("steps along the strip and holds at its ends", () => {
    expect(stillStep(0, "ArrowRight", 3)).toBe(1);
    expect(stillStep(2, "ArrowRight", 3)).toBe(2);
    expect(stillStep(0, "ArrowLeft", 3)).toBe(0);
    expect(stillStep(1, "End", 3)).toBe(2);
    expect(stillStep(1, "Home", 3)).toBe(0);
    expect(stillStep(1, "a", 3)).toBeNull();
    expect(stillStep(0, "ArrowRight", 0)).toBeNull();
  });

  it("collapses at the width the stylesheet's container query names", () => {
    expect(LEDGER_WIDE).toBe(1100);
  });
});

describe("words", () => {
  it("takes the first sentence", () => {
    expect(firstSentence("One. Two.")).toBe("One.");
    expect(firstSentence("No full stop")).toBe("No full stop");
  });
});

describe("a chore's drawing is made from the chore", () => {
  it("reads its own portals, gates, traps, audience and weight", () => {
    const f = artFor(refunds);
    expect(f).toMatchObject({ id: "carrier-refunds", portals: 2, gates: 1, traps: 2, audience: "work", verdict: "exceeds" });
    expect(f.weight).toBeGreaterThan(0);
  });
});

describe("the crumbs", () => {
  const names = labeller(new Map([["carrier-refunds", "Late-parcel refunds"]]));
  it("names a chore by its title and a turn by its number, and nothing else", () => {
    expect(names(chorePath("carrier-refunds"))).toBe("Late-parcel refunds");
    expect(names(runPath("carrier-refunds", 2))).toBe("Turn 3");
    expect(names({ root: "chores" })).toBeUndefined();
    expect(names(chorePath("unknown"))).toBeUndefined();
    expect(names({ root: "apps", item: "carrier-refunds" })).toBeUndefined();
  });
});

describe("the fixtures", () => {
  it("lead with typical (the perf gate renders the first) and each opens where its old layer did", () => {
    expect(fixtureIds[0]).toBe("typical");
    for (const id of fixtureIds) {
      const p = pathFor(id);
      expect(isValid(p), id).toBe(true);
      expect(p.root, id).toBe("chores");
      if (p.item !== undefined) expect(choreAt(fixtures[id]!, p), id).not.toBeNull();
    }
    expect(pathFor("typical")).toEqual({ root: "chores" });
    expect(pathFor("open-run")).toEqual(runPath("carrier-refunds", 0));
    expect(pathFor("open-turn-2")).toEqual(runPath("carrier-refunds", 1));
    expect(pathFor("open-traps")).toEqual(chorePath("carrier-refunds"));
    expect(pathFor("open-short")).toEqual(chorePath("chargeback-evidence"));
  });
  it("opens a chore on the facet the old layer opened on, and the replay is a place not a facet", () => {
    expect(facetFor("open-traps")).toBe("traps");
    expect(facetFor("open-short-proof")).toBe("result");
    expect(facetFor("open-evidence")).toBe("evidence");
    expect(facetFor("open-run")).toBeNull();
    expect(facetFor("open")).toBeNull();
  });
});

describe("whether the replay is playing", () => {
  it("is playing only for the chore that was started, and goes stale if nobody steps it", () => {
    stopPlaying();
    expect(isPlaying("a")).toBe(false);
    const t0 = 1_000_000;
    setPlaying("a", t0);
    expect(isPlaying("a", t0 + 1000)).toBe(true);
    expect(isPlaying("b", t0 + 1000)).toBe(false);
    expect(isPlaying("a", t0 + REPLAY_STEP_MS * 2)).toBe(false);
    setPlaying(null, t0);
    expect(isPlaying("a", t0)).toBe(false);
  });
});
