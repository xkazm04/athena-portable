/** Tests for the Chores scene's pure helpers — README section 3.5, ADR 0040, 0090 and 0096. */
import { describe, expect, it } from "vitest";

import { isValid, parseHash, formatHash, crumbs, type Path } from "@/depth/model";
import { parsePlaybook } from "@/lib/playbooks";
import { PLAYBOOKS } from "@/lib/playbooks.shipped";
import { selectPlaybooks } from "@/modules/playbooks/model";

import { compact, gateSlots, stillsOf, timeCell } from "./facts";
import { fixtureIds, fixtures, pathFor } from "./fixtures";
import { labeller } from "./index";
import {
  adoptPath,
  choreAt,
  chorePath,
  emptyLine,
  lowerFirst,
  NEW_ITEM,
  newChorePath,
  runPath,
  shortLine,
  turnAt,
} from "./model";
import { beforeAfterOf, blueprintOf, cardValue, fitRows, totalsLine, valueCell, whereWords, worthOf } from "./worth";
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

  it("says the test runs' totals in one line, and claims nothing when nothing is tested", () => {
    expect(totalsLine(typical)).toBe(
      "3 playbooks · 1 of 2 tested beat their bar on the latest run · $551.40 back found in test runs on invented cases",
    );
    expect(totalsLine(fixtures.degraded!)).toBe("1 playbook · none tested yet");
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
    expect(valueCell(chargebacks)).toEqual({ figure: "$21,600", per: "a year", kind: "back" });
    expect(valueCell(refunds)).toEqual({ figure: "$4,940", per: "a year", kind: "back" });
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
    expect(bar.result.line).toContain("not tested");
    expect(bar.guard).toBeNull();
  });

  it("sets the chore by hand against her run plus your review, and says nothing measured when untested", () => {
    const band = beforeAfterOf(refunds);
    expect(band.manual.figure).toBe("3 h");
    // 372 s of her run and 150 s of your review: 8.7 min, and the ratio is 180 / 8.7, not 180 / 6.2.
    expect(band.athena?.figure).toBe("9 min");
    expect(band.athena?.review).toBe("including about 3 min of your review");
    expect(band.ratio).toBe("21× faster");
    expect(band.ratio).toBe(refunds.speed);
    expect(beforeAfterOf(unbenched).athena).toBeNull();
  });

  /** A view of one playbook through the same reader and selector the shipped set goes through. */
  const one = (raw: Record<string, unknown>, bench: Record<string, unknown> | null = null) =>
    selectPlaybooks([parsePlaybook({ id: "x", ...raw }, bench)!], {
      copy: () => Promise.resolve(),
      open: () => {},
      hand: () => {},
    }).items[0]!;

  it("one money headline: the example's money back, the estimate beneath it in its own kind and unit", () => {
    const back = worthOf(one({ economics: { value_usd: 20000, per: "year", example_usd: 26410, basis: "Home care costs." } }));
    expect(back.example).toBe("$26,410");
    expect(back.estimate).toBe("Typical value: about $20,000 a year, author's estimate");
    expect(back.basis).toBe("Home care costs.");
    const lien = worthOf(one({ economics: { value_usd: 380000, per: "year", value_kind: "money_protected", example_usd: null } }));
    expect(lien.example).toBeNull();
    expect(lien.instead).toContain("protects money that is at risk");
    expect(lien.estimate).toBe("Typical value: about $380,000 a year protected, author's estimate");
    const episode = worthOf(one({ economics: { value_usd: 40000, per: "episode", example_usd: 20000 } }));
    expect(episode.estimate).toBe("Typical value: about $40,000 an episode, author's estimate");
    // The catalogue cell and the topic's secondary line read one function, so they cannot disagree.
    const monthly = one({ economics: { value_usd: 1800, per: "month" } });
    expect(worthOf(monthly).estimate).toContain(valueCell(monthly).figure);
    expect(worthOf(monthly).example).toBeNull();
  });

  it("says a card's value by its kind: a weight never as dollars", () => {
    expect(cardValue("count", 1000)).toBe("");
    expect(cardValue("money_protected", 36000)).toBe("$36,000 protected");
    expect(cardValue("penalty_avoided", 5000)).toBe("$5,000 in penalties avoided");
    expect(cardValue("money_back", 24.1)).toBe("$24.10");
    expect(cardValue("money_back", null)).toBe("");
  });

  it("states where it fits from the playbook's fit, and nothing at all without one", () => {
    expect(fitRows(null)).toEqual([]);
    const rows = fitRows(
      one({
        fit: {
          where: ["TX"],
          where_note: "Texas law; elsewhere the deadlines differ",
          who: "A homeowner who lives in the house",
          not_for: "A landlord",
          asks_for: ["your appraisal notice", "your deed"],
          costs: "No fees; only your Claude usage",
        },
      }).playbook.fit,
    );
    expect(rows.map((r) => r.label)).toEqual(["Where", "Who it is for", "Not for", "She will ask you for", "What it costs"]);
    expect(rows[0]!.text).toBe("Texas. Texas law; elsewhere the deadlines differ");
    expect(rows[3]!.text).toBe("your appraisal notice; your deed");
    expect(whereWords(["CA", "OR"])).toBe("California or Oregon");
    expect(whereWords(["US"])).toBe("the United States");
    expect(one({ fit: {} }).playbook.fit).toBeNull();
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
    // Her 6.2 min plus your 2.5 min of review.
    expect(timeCell(refunds)).toEqual({ hand: "3h", athena: "9m" });
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
      // The front door is a place, not a chore: "new" is reserved and names none.
      if (p.item !== undefined && p.item !== NEW_ITEM) expect(choreAt(fixtures[id]!, p), id).not.toBeNull();
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

describe("the front door's place (ADR 0098)", () => {
  it("is chores/new, a legal place that round-trips through the hash", () => {
    expect(newChorePath()).toEqual({ root: "chores", item: "new" });
    expect(isValid(newChorePath())).toBe(true);
    expect(parseHash(formatHash(newChorePath()))).toEqual(newChorePath());
  });

  it("reserves the id: no chore in the shipped library, and no fixture chore, is called new", () => {
    expect(NEW_ITEM).toBe("new");
    expect(PLAYBOOKS.map((p) => p.id)).not.toContain(NEW_ITEM);
    for (const model of Object.values(fixtures)) expect(model.items.map((v) => v.id)).not.toContain(NEW_ITEM);
  });

  it("is called New chore in the crumb, and names no chore", () => {
    const label = labeller(new Map([["carrier-refunds", "Late-parcel refunds"]]));
    expect(crumbs(newChorePath(), label).map((c) => c.label)).toEqual(["Athena", "Chores", "New chore"]);
    expect(choreAt(typical, newChorePath())).toBeNull();
  });
});
