/**
 * Tests for the Chores depth's view — README section 3.5, ADR 0040, 0053, 0087, 0090 and 0096.
 *
 * Every fixture renders at the place it is meant to be seen, and every level is asserted drawn:
 * the catalogue (the totals, the area tabs with their counts, the job chips, the order switch, the
 * rows with a still or a glyph, the time and the value; the empty, loading and problem states), a
 * chore's topic page (the crumb, the eyebrow, the title, the brief as simple markdown or the
 * promise, the figures, the flow with its portals, steps, gate and result, the gallery and the
 * adopt row) and a turn of the replay. Their wiring (a click does what it says) is in
 * `wired.test.tsx`.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Path } from "@/depth/model";
import type { Economics, Fit } from "@/lib/playbooks";
import { CATEGORIES, JOBS } from "@/lib/playbook-taxonomy";
import { selectPlaybooks, type PlaybooksModel } from "@/modules/playbooks/model";

import { fixtureIds, fixtures, pathFor } from "./fixtures";
import { chorePath, runPath } from "./model";
import ChoresView from "./view";

const noop = () => {};

function render(model: PlaybooksModel, path: Path): string {
  return renderToStaticMarkup(<ChoresView model={model} path={path} go={noop} />);
}

function html(fixture: string, path: Path = pathFor(fixture)): string {
  return render(fixtures[fixture]!, path);
}

const count = (h: string, needle: string | RegExp) =>
  typeof needle === "string" ? h.split(needle).length - 1 : (h.match(needle) ?? []).length;

/** The ledger fixture with a brief written for the refunds playbook, so the topic has markdown to read. */
function withBrief(brief: string): PlaybooksModel {
  const m = fixtures.ledger!;
  return {
    ...m,
    items: m.items.map((v) => (v.id === "carrier-refunds" ? { ...v, playbook: { ...v.playbook, brief } } : v)),
  };
}

/** The ledger fixture with the refunds playbook's economics (and fit) changed, re-selected so every
 *  derived figure (the tally, the verdict, the totals) follows. */
function withEconomics(over: Partial<Economics>, extra: { brief?: string; fit?: Fit | null } = {}): PlaybooksModel {
  const m = fixtures.ledger!;
  const books = m.items.map((v) =>
    v.id === "carrier-refunds"
      ? { ...v.playbook, ...extra, economics: { ...v.playbook.economics, ...over } }
      : v.playbook,
  );
  return selectPlaybooks(books, m.actions);
}

/** Every distinct dollar figure on a page, in the order first seen. */
const dollars = (h: string) => [...new Set([...h.matchAll(/\$[\d,]+(?:\.\d+)?/g)].map((m) => m[0]))];

describe("every fixture renders at its own place, and its catalogue too", () => {
  for (const id of fixtureIds) {
    it(id, () => {
      const here = html(id);
      expect(here).toMatch(/class="(pa-page|chores)/);
      expect(html(id, { root: "chores" })).toContain('class="pa-page');
    });
  }
});

describe("the catalogue", () => {
  const h = html("typical", { root: "chores" });
  const l = html("ledger", { root: "chores" });

  it("heads the catalogue with its title and the test runs' totals in one line", () => {
    expect(l).toContain(">Chores</h1>");
    expect(l).toContain(">New chore</button>");
    expect(h).toContain(
      "3 playbooks · 1 of 2 tested beat their bar on the latest run · $551.40 back found in test runs on invented cases",
    );
  });

  it("sums only money back into the totals: an exposure or a weight is never found money", () => {
    const protectedOnly = withEconomics({ kinds: { file_claim: "money_protected" }, exampleUsd: null });
    const before = fixtures.ledger!.totals.foundUsd;
    expect(protectedOnly.totals.foundUsd).toBe(Math.round((before - 96.4) * 100) / 100);
    const weighted = withEconomics({ kinds: { file_claim: "count" }, exampleUsd: null });
    expect(weighted.totals.foundUsd).toBe(protectedOnly.totals.foundUsd);
  });

  it("lists every area as a tab with its count, All current, an empty area disabled", () => {
    expect(l).toContain('aria-label="Areas"');
    expect(count(l, /class="pa-tab focus-ring"/g)).toBe(1 + CATEGORIES.length);
    expect(l).toMatch(/aria-current="page"[^>]*aria-label="All, 3"/);
    expect(l).toContain('aria-label="Freight &amp; trade, 1"');
    expect(l).toMatch(/disabled=""[^>]*aria-label="Health &amp; clinics, 0"/);
    // The tab says the area's first word; its full name is its title.
    expect(l).toContain('<span class="pa-tab__label">Freight</span>');
  });

  it("offers the job as pressed chips and the order as a three-way switch, edge first", () => {
    expect(l).toContain('aria-label="Job"');
    for (const j of ["All jobs", ...JOBS.map((x) => x.label)]) expect(l).toMatch(new RegExp(`>${j}</button>`));
    expect(l).toMatch(/aria-pressed="true"[^>]*>All jobs</);
    expect(l).toContain('aria-label="Order"');
    expect(l).toMatch(/aria-pressed="true"[^>]*>Best fit</);
    expect(l).toMatch(/aria-pressed="false"[^>]*>Most value</);
    expect(l).toMatch(/aria-pressed="false"[^>]*>Most time saved</);
    expect(l).toContain("3 playbooks in all areas");
  });

  it("is a pickable table of every row in the edge's order, none picked until one is opened", () => {
    expect(l).toContain('role="grid"');
    expect(count(l, /<tr aria-selected=/g)).toBe(3);
    expect(count(l, /aria-selected="true"/g)).toBe(0);
    const titles = [...l.matchAll(/class="pa-name"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(titles).toEqual(fixtures.ledger!.items.map((v) => v.playbook.shortTitle));
  });

  it("is one line a row: no still, no lead line, no run count, no portals", () => {
    expect(l).not.toContain("pa-thumb");
    expect(l).not.toContain("pa-name__lead");
    expect(l).not.toContain("pa-name__runs");
    expect(l).not.toContain(">Portals<");
  });

  it("gives each row its job, its time by hand against hers and its value on the year's scale", () => {
    expect(l).toContain(">Recover money</span>");
    expect(l).toContain('<span class="pa-time__hand">3h</span>');
    // Her 6.2 min plus your 2.5 min of review.
    expect(l).toContain('<span class="pa-time__athena" title="Her test run plus your review">9m</span>');
    expect(l).toContain('<span class="pa-time__athena">not run</span>');
    expect(l).toContain('<span class="pa-value__n">$4,940</span><span class="pa-value__per">a year back, est.</span>');
    const lien = render(withEconomics({ valueKind: "money_protected" }), { root: "chores" });
    expect(lien).toContain('<span class="pa-value__n">$4,940</span><span class="pa-value__per">a year protected, est.</span>');
  });

  it("keeps a row's lead line, or its promise when it has no brief, as the name's hover title", () => {
    expect(l).toContain(fixtures.ledger!.items[1]!.playbook.promise.replace(/'/g, "&#x27;"));
    const b = render(withBrief("Late parcels, **refunded**.\n\n- one\n- two"), { root: "chores" });
    expect(b).toContain('<span class="pa-name" title="Late parcels, refunded.">');
  });

  it("is an empty state of its own when the build ships nothing, with no totals", () => {
    const e = html("empty", { root: "chores" });
    expect(e).toContain("No playbooks in this build");
    expect(e).not.toContain("pa-tabs");
  });

  it("says a load that failed as a problem, the reason verbatim, never as an empty catalogue", () => {
    const model = { ...fixtures.typical!, items: [], loading: false, problem: "ENOENT playbooks/x/bench.json" };
    for (const path of [{ root: "chores" } as Path, chorePath("carrier-refunds")]) {
      const p = render(model, path);
      expect(p).toContain('role="alert"');
      expect(p).toContain("The playbooks could not be read.");
      expect(p).toContain("ENOENT playbooks/x/bench.json");
      expect(p).not.toContain("No playbooks in this build");
    }
  });

  it("says it is loading while the set is on its way", () => {
    const p = render({ ...fixtures.typical!, items: [], loading: true }, { root: "chores" });
    expect(p).toContain("Loading the playbooks");
  });

  it("copes with a half-written playbook: a row, nothing invented", () => {
    const d = html("degraded", { root: "chores" });
    expect(d).toContain("1 playbook · none tested yet");
    expect(count(d, /<tr aria-selected=/g)).toBe(1);
  });

  it("shows the whole shipped set as rows", () => {
    const many = html("shipped", { root: "chores" });
    expect(count(many, /<tr aria-selected=/g)).toBe(fixtures.shipped!.items.length);
  });
});

describe("a chore's topic page", () => {
  const t = html("ledger", chorePath("carrier-refunds"));

  it("has a way back, the area and job, and the short title as the page's heading", () => {
    expect(t).toContain("All playbooks</button>");
    expect(t).toContain("Freight &amp; trade · Recover money");
    expect(t).toContain('<h1 id="pa-title" class="pa-title">Late-parcel refunds</h1>');
  });

  it("reads the brief as simple markdown: paragraphs, bullets and bold, never HTML", () => {
    const b = render(
      withBrief("A store **owed refunds**.\n\nWhat she does:\n- reads the invoices\n- files the claims\n\n<b>not markup</b>"),
      chorePath("carrier-refunds"),
    );
    expect(b).toContain('<div class="rich pa-brief"><p>A store <strong>owed refunds</strong>.</p>');
    expect(b).toContain("<ul><li>reads the invoices</li><li>files the claims</li></ul>");
    expect(b).toContain("&lt;b&gt;not markup&lt;/b&gt;");
  });

  it("falls back to the promise when the playbook has no brief", () => {
    expect(t).toContain('<p class="pa-brief pa-brief--promise">');
    expect(t).toContain(fixtures.ledger!.items[0]!.playbook.promise.replace(/'/g, "&#x27;"));
  });

  it("states the example's money back, the time by hand against hers with your review, and the mistakes avoided", () => {
    expect(t).toContain('<span class="pa-kpi__label">In the example case</span><span class="pa-kpi__n">$96.40</span>');
    expect(t).toContain("back, in the invented example");
    expect(t).toContain(">Time saved</span>");
    // 3 h by hand against her 6.2 min plus your 2.5 min of review: 21×, not the bare 29×.
    expect(t).toContain("3 h");
    expect(t).toContain("9 min");
    expect(t).toContain("including about 3 min of your review · 21× faster");
    expect(t).not.toContain("29× faster");
    expect(t).toContain(">Mistakes avoided</span>");
    expect(t).not.toContain("Traps avoided");
    expect(t).not.toContain("for the persona");
  });

  it("puts the author's estimate on one line that opens on its basis, sources and caveat", () => {
    expect(t).toContain('<summary class="pa-estimate__sum focus-ring">Typical value: about $4,940 a year, author&#x27;s estimate</summary>');
    expect(t).toContain("About 95 late parcels a year at a median $52 refund");
    expect(t).toContain(">Carrier service guarantee terms</button>");
    expect(t).toContain("The carrier, the store and every parcel here are invented.");
    // The old "Worth $X" line is gone: the estimate is said once.
    expect(t).not.toContain("Worth $");
    expect(count(t, "$4,940")).toBe(1);
  });

  it("draws the estimate's basis and caveat as markdown bullets, never as markup", () => {
    const b = render(
      withEconomics({ basis: "- 95 parcels a year x **$52** = $4,940 (carrier terms)\n- Late in 1 of 20 <b>shipments</b>" }),
      chorePath("carrier-refunds"),
    );
    expect(b).toContain('<div class="rich pa-estimate__basis"><ul><li>95 parcels a year x <strong>$52</strong> = $4,940 (carrier terms)</li>');
    expect(b).toContain("<li>Late in 1 of 20 &lt;b&gt;shipments&lt;/b&gt;</li>");
    expect(b).not.toContain("- 95 parcels");
    expect(b).toContain('<div class="rich pa-estimate__caveat pa-muted">');
  });

  it("never shows two different totals for one quantity on a page", () => {
    // The brief states the example's total; the headline and the flow say the same money back.
    const b = render(withEconomics({}, { brief: "A store **owed $96.40** across five parcels." }), chorePath("carrier-refunds"));
    expect(b).toContain("Invented example case: its names and figures are not yours");
    // Every dollar figure on the page is one of three quantities, each said once in its own words:
    // the example's money back, and the author's estimate with the basis it quotes.
    expect(dollars(b)).toEqual(["$96.40", "$4,940", "$52"]);
    expect(b).toContain("$96.40 back");
    expect(count(b, "$4,940")).toBe(1);
  });

  it("says what a chore protects in words when none of its example is money back, and shows no dollars for a weight", () => {
    const lien = render(
      withEconomics({ valueKind: "money_protected", kinds: { file_claim: "money_protected" }, exampleUsd: null }),
      chorePath("carrier-refunds"),
    );
    expect(lien).toContain("No money comes back in the example case: this chore protects money that is at risk.");
    expect(lien).toContain("Typical value: about $4,940 a year protected, author&#x27;s estimate");
    expect(lien).toContain("$96.40 of $96.40 protected");
    expect(lien).not.toContain("$96.40 back");
    const weighted = render(withEconomics({ kinds: { file_claim: "count" }, exampleUsd: null }), chorePath("carrier-refunds"));
    // A weight is never a dollar figure: the flow counts items, the verdict says no money.
    expect(weighted).toContain('<span class="pa-result__n">5 of 5</span>');
    expect(weighted).not.toContain("$96.40 back");
    expect(weighted).toContain("Beat its bar in its one test run: 5 of 5 found, no false claims.");
    expect(weighted).not.toMatch(/\$(24\.10|18\.75|21\.30|16\.90|15\.35)/);
  });

  it("shows the verdict and the runs it stands on", () => {
    expect(t).toContain('<span class="pa-verdict__label">Beats its bar</span>');
    expect(t).toContain("Beat its bar in its one test run: 5 of 5 found, $96.40 back of $96.40, no false claims.");
  });

  it("states where it fits from the playbook's fit, and nothing about fit without one", () => {
    expect(t).toContain(">Where it fits</h2>");
    expect(t).toContain("<dt>Where</dt><dd>the United States. The carrier&#x27;s US service guarantee; other countries&#x27; terms differ</dd>");
    expect(t).toContain("<dt>She will ask you for</dt><dd>your carrier account&#x27;s invoices; your store&#x27;s order export</dd>");
    expect(t).toContain("<dt>What it costs</dt><dd>No fees; only your Claude usage</dd>");
    const none = render(withEconomics({}, { fit: null }), chorePath("carrier-refunds"));
    expect(none).not.toContain("Where it fits");
    expect(none).not.toContain("pa-fit");
  });

  it("draws how it runs: the portals she reads, the numbered steps, the gate before its step, what she filed", () => {
    const p = fixtures.ledger!.items[0]!.playbook;
    expect(t).toContain(">How it runs</h2>");
    expect(count(t, /class="pa-source"/g)).toBe(p.apps.length);
    expect(count(t, /class="pa-step"/g)).toBe(p.steps.length);
    expect(count(t, /class="pa-gate"/g)).toBe(p.gates.length);
    expect(t).toContain('<span class="pa-gate__label">File a refund claim</span>');
    expect(t).toContain("Found in the test run");
    expect(t).toContain('<span class="pa-result__n">$96.40 back</span>');
    const un = html("ledger", chorePath("flight-compensation"));
    expect(un).toContain("Not tested yet");
    expect(un).toContain("the bar it will be held to");
  });

  it("shows every still of the run large, each with its caption and a way to enlarge it", () => {
    expect(t).toContain(">See it run</h2>");
    expect(t).toContain("Screens of the test run, on invented portals");
    expect(t).not.toContain("Real screens");
    expect(count(t, /class="pa-frame focus-ring"/g)).toBe(3);
    expect(t).toContain('aria-label="Enlarge: Turn 2 - Carrier billing centre: list the invoice"');
    expect(t).not.toContain('role="dialog"');
    const none = html("ledger", chorePath("chargeback-evidence"));
    expect(none).toContain("No step screens captured for this run yet.");
    expect(none).toContain("No screens captured for this run yet.");
  });

  it("offers the studio, the replay where there is a run, and the command", () => {
    expect(t).toContain(">Make it yours</h2>");
    expect(t).toContain(">Talk it through with her</button>");
    expect(t).toContain(">Watch the run turn by turn</button>");
    expect(t).toContain(">Copy the command</button>");
    expect(html("ledger", chorePath("chargeback-evidence"))).not.toContain("Watch the run turn by turn");
  });

  it("draws a shipped playbook from its own brief and its own stills", () => {
    const s = html("shipped", chorePath("travel-credit-refunds"));
    expect(s).toContain("Airline credits turned back into card refunds");
    expect(s).toContain("<strong>15 airline credits and fees</strong>");
    expect(count(s, /class="pa-frame focus-ring"/g)).toBe(5);
  });
});

describe("the replay", () => {
  const first = html("open-run");
  const second = html("open-turn-2");

  it("opens at its turn: the number in display type, the portal, a dot for every turn and a route of visits", () => {
    expect(first).toContain("ch-marquee ch-marquee--run");
    expect(first).toContain("Turn 1");
    expect(first).toContain(" of 4");
    expect(count(first, /class="ch-dot focus-ring"/g)).toBe(4);
    expect(count(first, /class="ch-rail__visit"/g)).toBe(3);
    expect(count(first, /class="ch-rail__visit" data-here=""/g)).toBe(1);
    expect(first).toContain('aria-current="step"');
    expect(first).toContain('aria-label="Turns, by tab"');
  });

  it("says in words what each dot is, so colour is never the only carrier", () => {
    expect(first).toContain("Turn 2, Carrier billing centre, filed");
    expect(first).toContain("Turn 1, Carrier billing centre, read");
    expect(first).toContain("only spoke");
    expect(first).toContain("filed a wrong card");
  });

  it("shows what she read, each tool once with its count, and keeps a whole turn uncut", () => {
    expect(first).toContain("list invoice ×2");
    expect(first).not.toContain("read guarantee ×");
    expect(first).not.toContain("(showing");
  });

  it("says the page answered, not the person, on a turn the run loop continued", () => {
    expect(second).toContain("Turn 2");
    expect(second).toContain("the run loop handed her their results");
    expect(second).toContain("1Z88A0");
    expect(second).toContain('aria-label="Cards she proposed this turn"');
    expect(second).toContain("Right claim");
  });

  it("announces a cut turn and keeps the money found so far", () => {
    expect(second).toContain("(showing");
    expect(second).toContain("back so far, in the test run");
    expect(second).toContain("$64.15");
    expect(first).toContain("$0");
  });

  it("counts a weighted run in items, never in dollars, and says another kind in its own words", () => {
    const weighted = render(withEconomics({ kinds: { file_claim: "count" }, exampleUsd: null }), runPath("carrier-refunds", 1));
    expect(weighted).toContain("items found so far, in the test run");
    expect(weighted).not.toContain("$");
    const lien = render(withEconomics({ kinds: { file_claim: "money_protected" }, exampleUsd: null }), runPath("carrier-refunds", 1));
    expect(lien).toContain("$24.10 protected");
    expect(lien).not.toContain("back so far");
  });

  it("offers play, back, next, the arrows and a way to pick a turn; back is disabled at the first turn", () => {
    expect(first).toContain(">Play</button>");
    expect(first).toContain(">Back</button>");
    expect(first).toContain(">Next</button>");
    expect(first).toContain("Left and right arrows step.");
    expect(first).toContain('aria-label="This is the first turn"');
    expect(first).not.toContain('aria-label="This is the last turn"');
    const last = html("open-run", runPath("carrier-refunds", 3));
    expect(last).toContain('aria-label="This is the last turn"');
    expect(last).toContain(">Replay</button>");
  });

  it("lists every card of the run, each a way to its turn, and folds a long list with a way to show all", () => {
    expect(first).toContain('aria-label="Every card of this run"');
    expect(first).toContain("The cards, turn by turn");
    expect(count(first, /class="ch-ledger__row focus-ring"/g)).toBe(5);
    const shipped = fixtures.shipped!;
    const long = shipped.items.find((v) => (v.playbook.bench?.trace ?? []).flatMap((t) => t.cards).length > 6);
    if (long) expect(render(shipped, runPath(long.id, 0))).toMatch(/Show all \d+ \(showing 6 of \d+\)/);
  });
});

describe("a place that is not there is said, with the way back", () => {
  it("an unknown chore", () => {
    const h = html("typical", chorePath("nope"));
    expect(h).toContain("That playbook is not in this build");
    expect(h).toContain("All playbooks");
  });
  it("a replay of a chore that was never benched", () => {
    const h = html("open-unbenched", runPath("flight-compensation", 0));
    expect(h).toContain("There is no run to watch");
    expect(h).toContain("not tested yet, so there is no recorded run");
    expect(h).toContain("Back to the chore");
  });
  it("a replay of a benched chore whose run kept no turns", () => {
    const h = html("open-short", runPath("chargeback-evidence", 0));
    expect(h).toContain("There is no run to watch");
    expect(h).toContain("kept no turn-by-turn record");
  });
  it("a turn that is not in the run", () => {
    const h = html("open-run", { root: "chores", item: "carrier-refunds", sub: { kind: "run", arg: "9" } });
    expect(h).toContain("That turn is not in this run");
    expect(h).toContain("The run has 4 turns");
    expect(h).toContain("Go to turn 1");
  });
});
