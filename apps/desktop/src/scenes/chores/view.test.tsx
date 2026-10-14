/**
 * Tests for the Chores depth's view — README section 3.5, ADR 0040, 0053, 0055, 0087, 0090 and 0096.
 *
 * Every fixture renders at the place it is meant to be seen, and every capability the Playbooks
 * module's own view had is asserted present at its depth: the field (the ledger's rail, job chips,
 * table, totals, verdicts, the simulated line, the preview with its blueprint, storyboard,
 * before-and-after band and adopt row; the empty, loading and problem states), a chore (facets,
 * portals with Open, method, gates, proof, traps, run, film with its currency, lessons, money,
 * Copy, Hand) and a turn of the replay. Their wiring (a click does what it says) is in
 * `wired.test.tsx`.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Path } from "@/depth/model";
import { CATEGORIES, JOBS } from "@/lib/playbook-taxonomy";

import { facetFor, fixtureIds, fixtures, pathFor } from "./fixtures";
import { SIMULATED_LINE, SPINE_STEPS, chorePath, runPath } from "./model";
import ChoresView from "./view";

const noop = () => {};

function html(fixture: string, path: Path = pathFor(fixture), initialFacet = facetFor(fixture)): string {
  return renderToStaticMarkup(
    <ChoresView model={fixtures[fixture]!} path={path} go={noop} initialFacet={initialFacet} />,
  );
}

const count = (h: string, needle: string | RegExp) =>
  typeof needle === "string" ? h.split(needle).length - 1 : (h.match(needle) ?? []).length;

describe("every fixture renders at its own place, and its field too", () => {
  for (const id of fixtureIds) {
    it(id, () => {
      const here = html(id);
      expect(here).toContain('class="chores');
      const field = html(id, { root: "chores" });
      expect(field).toContain('class="chores ch-field');
    });
  }
});

describe("the field: the ledger", () => {
  const h = html("typical", { root: "chores" });
  const l = html("ledger", { root: "chores" });

  it("heads the ledger with its title, the bench's totals in one line and the simulated line", () => {
    expect(h).toContain("What only Athena does");
    expect(h).toContain("3 playbooks · 1 of 2 benched exceed the bar · $551.40 found on the bench");
    expect(h).toContain(SIMULATED_LINE);
    expect(h.indexOf(SIMULATED_LINE)).toBeGreaterThan(h.indexOf("found on the bench"));
  });

  it("lists every area on the rail with its count, the one in force current, and names none twice", () => {
    expect(l).toContain('aria-label="Areas"');
    expect(count(l, /class="ch-area focus-ring"/g)).toBe(1 + CATEGORIES.length);
    expect(l).toMatch(/aria-current="true"[^>]*><span class="ch-area__name">All<\/span><span class="ch-area__n ch-data">3</);
    expect(l).toContain('Freight &amp; trade</span><span class="ch-area__n ch-data">1<');
    expect(l).toContain('Health &amp; clinics</span><span class="ch-area__n ch-data">0<');
    expect(l).not.toContain("Uncategorised");
  });

  it("lists the playbooks that name no area under Uncategorised, never hiding them", () => {
    expect(h).toContain('Uncategorised</span><span class="ch-area__n ch-data">3<');
  });

  it("offers the job as pressed buttons and the view as Ledger or Map, the ledger first", () => {
    expect(h).toContain('aria-label="Job"');
    for (const j of ["Every job", ...JOBS.map((x) => x.label)]) expect(h).toContain(`>${j}</button>`);
    expect(h).toMatch(/aria-pressed="true"[^>]*>Every job</);
    expect(h).toMatch(/aria-pressed="true"[^>]*>Ledger</);
    expect(h).toMatch(/aria-pressed="false"[^>]*>Map</);
    expect(h).not.toContain('role="radiogroup"');
  });

  it("is a pickable table in the edge's order, the first row picked, money and hours the sortable heads", () => {
    expect(h).toContain('role="grid"');
    expect(count(h, /<tr aria-selected=/g)).toBe(3);
    expect(count(h, /aria-selected="true"/g)).toBe(1);
    const titles = [...h.matchAll(/class="ch-row__title">([^<]+)</g)].map((m) => m[1]);
    expect(titles).toEqual(["Late-parcel refunds", "Chargeback evidence packs", "Delayed-flight compensation"]);
    expect(count(h, 'aria-sort="none"')).toBe(2);
    expect(h).toContain(">Time saved<");
    expect(h).toContain(">Value<");
  });

  it("gives each row its domain, job, portals, hours by hand, value on the year's scale and verdict", () => {
    expect(l).toContain("E-commerce</span>");
    expect(l).toContain("Recover money</span>");
    expect(h).toContain("Unsorted</span>");
    expect(h).toContain("$21,600");
    expect(h).toContain("3 h");
    expect(h).toContain("29× faster");
    for (const word of ["Exceeds", "Falls short", "Not benched"]) expect(h).toContain(word);
  });

  it("carries a filmed row's still as a small lazy thumbnail, and a quiet box where there is none", () => {
    expect(count(h, /<img class="ch-row__thumb"[^>]*alt=""[^>]*loading="lazy"[^>]*decoding="async"/g)).toBe(2);
    expect(count(h, /<span class="ch-row__thumb" aria-hidden="true">/g)).toBe(1);
  });

  it("previews the first row: its area and job, its name, its promise and its value as the author's estimate", () => {
    expect(l).toContain('aria-label="Preview: Late-parcel refunds"');
    expect(l).toContain("Freight &amp; trade · Recover money");
    expect(l).toContain("Every late parcel&#x27;s refund found");
    expect(l).toContain("author&#x27;s estimate");
  });

  it("draws the blueprint from the playbook: its portals, its numbered steps, its gates, what she filed", () => {
    const refunds = fixtures.typical!.items[0]!.playbook;
    expect(l).toContain('<figure class="ch-plan">');
    for (const a of refunds.apps) expect(l).toContain(`class="ch-plan__name">${a.name}<`);
    expect(count(l, /class="ch-plan__step"/g)).toBe(Math.min(refunds.steps.length, SPINE_STEPS));
    expect(count(l, /class="ch-plan__step ch-plan__gate"/g)).toBe(refunds.gates.length);
    expect(l).toContain("You sign");
    expect(l).toContain("Filed on the bench");
    expect(l).toContain("2 of 2 traps walked past");
    expect(l).toContain("<figcaption");
  });

  it("shows the run's real screens with a strip to pick from, or the thumbnail and a line saying none were captured", () => {
    expect(l).toContain("1 of 3 · Abstract");
    expect(count(l, /class="ch-story__pick focus-ring"/g)).toBe(3);
    expect(count(l, /class="ch-story__pick focus-ring" aria-pressed="true"/g)).toBe(1);
    expect(h).toContain("No step screens captured for this run yet.");
    expect(h).toContain("What she filed</figcaption>");
  });

  it("sets the chore by hand against her measured run, with the ratio between them", () => {
    expect(l).toContain(">By hand<");
    expect(l).toContain(">With Athena<");
    expect(l).toContain("29× faster");
    expect(l).toContain("of model time");
  });

  it("offers the fit, the command and the full playbook at the pane's foot", () => {
    expect(l).toContain(">Fit it to me</button>");
    expect(l).toContain(">Copy the command</button>");
    expect(l).toContain(">Open the full playbook</button>");
  });

  it("is an empty state of its own when the build ships nothing, with no totals and no simulated line", () => {
    const e = html("empty", { root: "chores" });
    expect(e).toContain("No playbooks in this build");
    expect(e).not.toContain(SIMULATED_LINE);
    expect(e).not.toContain("ch-led");
  });

  it("says a load that failed as a problem, the reason verbatim, never as an empty ledger", () => {
    const model = { ...fixtures.typical!, items: [], loading: false, problem: "ENOENT playbooks/x/bench.json" };
    const p = renderToStaticMarkup(<ChoresView model={model} path={{ root: "chores" }} go={noop} />);
    expect(p).toContain('role="alert"');
    expect(p).toContain("The playbooks could not be read.");
    expect(p).toContain("ENOENT playbooks/x/bench.json");
    expect(p).not.toContain("No playbooks in this build");
  });

  it("says it is loading while the set is on its way", () => {
    const model = { ...fixtures.typical!, items: [], loading: true };
    const p = renderToStaticMarkup(<ChoresView model={model} path={{ root: "chores" }} go={noop} />);
    expect(p).toContain("Loading the playbooks");
  });

  it("copes with a half-written playbook: a row, a word for it, nothing invented", () => {
    const d = html("degraded", { root: "chores" });
    expect(d).toContain("A half-written playbook");
    expect(d).toContain("Not benched");
    expect(d).toContain("1 playbook · none benched yet");
    expect(d).toContain("Not benched, so nothing is measured.");
  });

  it("shows the whole shipped set as rows", () => {
    const many = html("shipped", { root: "chores" });
    expect(count(many, /<tr aria-selected=/g)).toBe(fixtures.shipped!.items.length);
  });
});

describe("a chore", () => {
  const open = html("open");

  it("is its own scene: the drawing labelled stylised, the name in display type, the promise, the caveat", () => {
    expect(open).toContain("ch-marquee ch-marquee--chore");
    expect(open).toContain("Late-parcel refunds</h1>");
    expect(open).toContain("Stylised drawing of this chore");
    expect(open).toContain("Not a screenshot");
    expect(open).toContain("Every late parcel&#x27;s refund found");
    expect(open).toContain('role="note"');
    expect(open).toContain("$4,940");
    expect(open).toContain("a year, author&#x27;s estimate");
  });

  it("offers the command two ways: copy it, or hand it to Athena", () => {
    expect(open).toContain("Copy the command");
    expect(open).toContain("Hand it to Athena");
  });

  it("states the bench at a glance with the standing line, and opens the result from it", () => {
    // The name starts with the visible label and carries the figures: it replaces the button's text.
    expect(open).toMatch(/aria-label="Bench, \d{4}-\d{2}-\d{2}: \$[\d,.]+ of \$[\d,.]+ planted in its world\. Open what she filed"/);
    expect(open).toContain(SIMULATED_LINE);
    expect(open).toContain("planted in its world");
    expect(open).not.toContain("there to find");
  });

  it("lists every part of the chore and of the proof, one row each, with its one line", () => {
    expect(open).toContain('aria-label="Parts of this playbook"');
    for (const part of [
      "The chore today",
      "Where it happens",
      "How she works it",
      "Where she stops for you",
      "What she filed",
      "Traps",
      "Watch the run",
      "The run, filmed",
      "Why it is worth it",
    ])
      expect(open, part).toContain(part);
    expect(open).toContain('aria-current="page"');
    expect(open).toContain("The chore</h2>");
    expect(open).toContain("The proof</h2>");
  });

  it("opens on the chore and tells Athena in the person's words", () => {
    expect(open).toContain("Tell Athena");
    expect(open).toContain("Go through this week&#x27;s carrier invoice");
    expect(open).toContain("waits in her composer until you send it");
  });

  it("opens on the part a fixture names", () => {
    const proof = html("open-short-proof");
    expect(proof).toContain('aria-label="The cards the gate filed"');
    expect(proof).toContain("Claims right");
    expect(proof).toContain("Falls short");
    expect(proof).toContain("Missed");
  });

  it("lists the portals each with its Open where it has an address, and the method and the gates", () => {
    const shipped = fixtures.shipped!;
    const withUrl = shipped.items.find((v) => v.playbook.apps.some((a) => a.url))!;
    const h = renderToStaticMarkup(
      <ChoresView model={shipped} path={chorePath(withUrl.id)} go={noop} initialFacet="portals" />,
    );
    const urls = withUrl.playbook.apps.filter((a) => a.url).length;
    expect(count(h, /class="btn btn--ghost focus-ring btn--sm"/g)).toBe(urls);
    expect(h).toContain(">Open</button>");
    const method = renderToStaticMarkup(
      <ChoresView model={shipped} path={chorePath(withUrl.id)} go={noop} initialFacet="method" />,
    );
    expect(method).toContain("ch-steps");
    const gates = renderToStaticMarkup(
      <ChoresView model={shipped} path={chorePath(withUrl.id)} go={noop} initialFacet="gates" />,
    );
    expect(gates).toContain("GATED");
  });

  it("lists the traps by id, a filed one first, folded past five and saying how many it shows", () => {
    const clean = html("open-traps");
    expect(clean).toContain("2 of 2 traps walked past");
    expect(clean).toContain("1Z88B7");
    const short = html("open-short-traps");
    expect(short).toContain("6 of 7 traps walked past");
    const first = short.indexOf('class="ch-trap"');
    expect(short.slice(first - 60, first + 400)).toContain("DP-124");
    expect(short).toContain("Filed anyway.");
    expect(short).toContain("Show all 7 (showing 5 of 7)");
    expect(short).not.toContain("DP-129");
  });

  it("points the run at the replay, never draws it here, and keeps her closing words and the run history", () => {
    const run = html("open", chorePath("carrier-refunds"), "run");
    expect(run).toContain(">Watch the run</button>");
    expect(run).toContain("4 turns across 3 tab visits");
    expect(run).toContain('aria-label="Tab visits, in order"');
    expect(run).toContain("Athena, at the end of the run");
    expect(run).not.toContain("ch-rail");
  });

  it("plays the film where it is served and shows its still where it is not, each with its currency", () => {
    const served = html("open-evidence");
    expect(served).toContain('<video class="ch-film__media"');
    expect(served).toContain('src="/evidence/carrier-refunds/evidence.mp4"');
    expect(served).toContain("Current");
    expect(served).toContain("narrated for the preview");
    expect(served).toContain("kokoro af_heart");
    const still = html("open-short-evidence");
    expect(still).not.toContain("<video");
    expect(still).toContain('<img class="ch-film__media"');
    expect(still).toContain("Stale");
    expect(still).toContain("the dev server plays it there");
    expect(still).toContain("so the figures may differ");
  });

  it("shows no film part and no replay for a chore that has none", () => {
    const h = html("open-unbenched");
    expect(h).not.toContain("The run, filmed");
    expect(h).not.toContain("Watch the run");
  });

  it("says a chore that was never benched claims nothing measured, and holds it to its bar", () => {
    const proof = html("open-unbenched", chorePath("flight-compensation"), "result");
    expect(proof).toContain("No run on the bench yet, so nothing here is measured.");
    expect(proof).toContain("The bar it will be held to");
    expect(proof).not.toContain('aria-label="The cards the gate filed"');
    const open = html("open-unbenched");
    expect(open).toContain("Not benched");
    expect(open).not.toContain("Open what she filed");
  });

  it("reads the money, why it is on the edge, the lessons and the sources", () => {
    const money = html("open", chorePath("carrier-refunds"), "money");
    expect(money).toContain("Why it is on the edge");
    expect(money).toContain("Difficulty for anyone else");
    expect(money).toContain('aria-label="4 of 5"');
    expect(money).toContain("Carrier service guarantee terms");
    expect(money).toContain("by hand.");
    const shipped = fixtures.shipped!;
    const taught = shipped.items.find((v) => v.playbook.lessons.length > 0)!;
    const lessons = renderToStaticMarkup(
      <ChoresView model={shipped} path={chorePath(taught.id)} go={noop} initialFacet="lessons" />,
    );
    expect(lessons).toContain("Fixes its runs uncovered");
    expect(lessons).toContain(taught.playbook.lessons[0]!.title.replace(/'/g, "&#x27;"));
  });

  it("scores every card with the scorer's word and says nothing was sent", () => {
    const result = html("open", chorePath("carrier-refunds"), "result");
    expect(result).toContain("Right claim");
    expect(result).toContain("Nothing was sent");
    expect(result).toContain("every card waited for a signature");
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
    expect(second).toContain('aria-label="Cards filed this turn"');
    expect(second).toContain("Right claim");
  });

  it("announces a cut turn and keeps the money found so far", () => {
    expect(second).toContain("(showing");
    expect(second).toContain("found so far, on the bench");
    expect(second).toContain("$64.15");
    expect(first).toContain("$0");
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
    if (long) {
      const h = renderToStaticMarkup(
        <ChoresView model={shipped} path={runPath(long.id, 0)} go={noop} />,
      );
      expect(h).toMatch(/Show all \d+ \(showing 6 of \d+\)/);
    }
  });
});

describe("a place that is not there is said, with the way back", () => {
  it("an unknown chore", () => {
    const h = html("typical", chorePath("nope"));
    expect(h).toContain("That chore is not in this build");
    expect(h).toContain("All chores");
  });
  it("a replay of a chore that was never benched", () => {
    const h = html("open-unbenched", runPath("flight-compensation", 0));
    expect(h).toContain("There is no run to watch");
    expect(h).toContain("not benched, so there is no recorded run");
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
