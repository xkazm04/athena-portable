/** Tests for the Chores scene's pure helpers — README section 3.5, ADR 0040, 0090 and 0096. */
import { describe, expect, it } from "vitest";

import { isValid, parseHash, formatHash, type Path } from "@/depth/model";

import { compact, gateSlots, stillsOf, timeCell } from "./facts";
import { fixtureIds, fixtures, pathFor } from "./fixtures";
import { labeller } from "./index";
import {
  adoptPath,
  beforeAfterOf,
  blueprintOf,
  choreAt,
  chorePath,
  emptyLine,
  lowerFirst,
  runPath,
  shortLine,
  totalsLine,
  turnAt,
  valueCell,
} from "./model";
import { REPLAY_STEP_MS, isPlaying, setPlaying, stopPlaying } from "./replay";
import { blocks, lead } from "./rich";

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

describe("the catalogue's and the topic's words", () => {
  const unbenched = typical.items.find((v) => v.verdict.word === "unbenched")!;

  it("says the bench's totals in one line, and claims nothing when nothing is benched", () => {
    expect(totalsLine(typical)).toBe("3 playbooks · 1 of 2 benched exceed the bar · $551.40 found on the bench");
    expect(totalsLine(fixtures.degraded!)).toBe("1 playbook · none benched yet");
  });

  it("names the area and the job a filter that leaves nothing was set to", () => {
    expect(emptyLine({ category: "health", job: "contest" })).toBe(
      "No playbook in Health & clinics whose job is to win a dispute.",
    );
    expect(emptyLine({ category: "family", job: "all" })).toBe("No playbook in Family & estate.");
    expect(emptyLine({ category: "all", job: "comply" })).toBe("No playbook in any area whose job is to stay compliant.");
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

  it("draws the flow's result and its guard from the playbook alone, the bar where it is unbenched", () => {
    const plan = blueprintOf(refunds);
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
});

describe("the crumbs", () => {
  const names = labeller(new Map([["carrier-refunds", "Late-parcel refunds"]]));
  it("names a chore by its title, a turn by its number, its studio by its door, and nothing else", () => {
    expect(names(chorePath("carrier-refunds"))).toBe("Late-parcel refunds");
    expect(names(runPath("carrier-refunds", 2))).toBe("Turn 3");
    expect(names(adoptPath("carrier-refunds"))).toBe("Make it yours");
    expect(names({ root: "chores" })).toBeUndefined();
    expect(names(chorePath("unknown"))).toBeUndefined();
    expect(names({ root: "apps", item: "carrier-refunds" })).toBeUndefined();
  });
});

describe("the topic page's facts", () => {
  it("keeps a duration to a few characters for a cell", () => {
    expect(compact(0)).toBe("–");
    expect(compact(0.5)).toBe("30s");
    expect(compact(45)).toBe("45m");
    expect(compact(180)).toBe("3h");
    expect(compact(150)).toBe("2.5h");
    expect(compact(60 * 12.4)).toBe("12h");
  });

  it("sets the time by hand against her measured run, and says nothing measured when unbenched", () => {
    expect(timeCell(refunds)).toEqual({ hand: "3h", athena: "6m" });
    expect(timeCell(typical.items.find((v) => v.playbook.bench === null)!).athena).toBeNull();
  });

  it("keeps only the stills this build carries, in order", () => {
    const withStory = fixtures.ledger!.items.find((v) => v.id === "carrier-refunds")!;
    expect(stillsOf(withStory).map((s) => s.caption)).toEqual([
      "Abstract",
      "Turn 2 - Carrier billing centre: list the invoice",
      "What she filed",
    ]);
    const story = [{ url: "", caption: "x", turn: null }];
    const blank = { ...withStory, playbook: { ...withStory.playbook, evidence: { ...withStory.playbook.evidence!, story } } };
    expect(stillsOf(blank)).toEqual([]);
  });

  it("puts a gate before the step that shares the most words with it, or last when none does", () => {
    const steps = [
      "Read the carrier invoices.",
      "Match each late parcel to an order.",
      "File the refund claims for signature.",
    ];
    expect(gateSlots(steps, [{ label: "File a refund claim", action: "file_claim" }])).toEqual([2]);
    expect(gateSlots(steps, [{ label: "Pay the vendor", action: "send_payment" }])).toEqual([-1]);
    expect(gateSlots([], [{ label: "File a refund claim", action: "file_claim" }])).toEqual([-1]);
  });

  it("reads a persona mid-sentence, leaving an acronym as it is", () => {
    expect(lowerFirst("Store owners shipping parcels")).toBe("store owners shipping parcels");
    expect(lowerFirst("EU travellers")).toBe("EU travellers");
  });
});

describe("the brief's simple markdown", () => {
  it("splits paragraphs on blank lines, joins a paragraph's lines, and lists the `- ` lines", () => {
    expect(blocks("One\ntwo.\n\n- a\n- b\nAfter")).toEqual([
      { kind: "p", lines: ["One two."] },
      { kind: "ul", lines: ["a", "b"] },
      { kind: "p", lines: ["After"] },
    ]);
    expect(blocks("")).toEqual([]);
  });

  it("teases a row with the first paragraph, its bold marks dropped", () => {
    expect(lead("- a list first\n\nA **bold** lead.\n\nMore.")).toBe("A bold lead.");
    expect(lead("- only a list")).toBe("");
  });
});

describe("the fixtures", () => {
  it("lead with typical (the perf gate renders the first) and each opens at its own place", () => {
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
