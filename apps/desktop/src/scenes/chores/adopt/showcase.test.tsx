// @vitest-environment jsdom
/**
 * The practice run says what was really done — ADR 0125, chores UAT 2026-10-23 theme 5.
 *
 * A practice run on a world changed by app names alone is the example's data: its figure is the
 * example's money back, labelled so, with money protected and penalties avoided in their own words
 * and a count never as dollars. One whose rows or date the shape changed says how many things it
 * adjusted, shows no dollar figure, and marks no card right or wrong. Every card is one she would
 * propose; nothing is called filed.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseTrace } from "@/lib/playbooks";

import Showcase, { adjustedIn, kindsIn, otherKindsIn, shownRun } from "./showcase";
import type { ShowcaseEvent } from "./state";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const card = (key: string, value: number | null, over: Record<string, unknown> = {}) => ({
  action: "request_refund",
  key,
  outcome: "correct",
  value_usd: value,
  ...over,
});

const RAW = [
  { portal: "Gmail", user: "Start.", said: "Reading.", reads: [], cards: [] },
  {
    portal: "Delta",
    user: "",
    said: "Proposed two.",
    reads: [],
    cards: [card("DL1", 212), card("DL2", 40)],
  },
];

/** One turn with a card of each kind. */
const KINDED = [
  {
    portal: "Procore Pay",
    user: "Run the chore we agreed: chase the liens.",
    said: "Proposed four.",
    reads: [],
    cards: [
      card("PAY1", 1200, { action: "request_payment", kind: "money_back" }),
      card("LN1", 380000, { action: "release_lien", kind: "money_protected" }),
      card("Q1", 10, { action: "keep_bid", kind: "count" }),
      card("PEN", 5000, { action: "file_on_time", kind: "penalty_avoided" }),
    ],
  },
];

const RECORDED = parseTrace([
  { portal: "Postwren", user: "Start.", said: "Reading.", reads: [], cards: [card("A", 1)] },
]);

const done = (over: Partial<ShowcaseEvent>): ShowcaseEvent => ({
  kind: "adopt.showcase",
  seq: 1,
  status: "done",
  turn: 2,
  total: 2,
  trace: RAW,
  found_usd: null,
  found_reason: "",
  detail: "",
  ...over,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(showcase: ShowcaseEvent | null) {
  act(() =>
    root.render(
      <Showcase
        recorded={RECORDED}
        portals={{}}
        rehearsal={showcase && { rev: 1, event: showcase }}
        rev={1}
        onStart={() => {}}
      />,
    ),
  );
}

const text = (sel: string) => host.querySelector(sel)?.textContent ?? "";
const all = (sel: string) => [...host.querySelectorAll(sel)].map((n) => n.textContent ?? "");

function goToTurn(i: number) {
  act(() => {
    (host.querySelectorAll(".ad-route__dot")[i] as HTMLButtonElement).click();
  });
}

describe("a practice run on the example's data (app names only)", () => {
  it("says it is the example's data and its figure the example's money back", () => {
    render(done({ found_usd: 252 }));
    expect(text(".ad-show__label")).toContain(
      "Practice run on the example's data, with your app names — nothing was sent",
    );
    expect(text(".ad-show__n")).toBe("$252");
    expect(text(".ad-show__found")).toContain(
      "back in the example — the example's invented case, not yours",
    );
    expect(host.textContent).not.toMatch(/shaped like your case/);
  });

  it("keeps the example's grades: its answer key still holds", () => {
    render(done({ found_usd: 252 }));
    goToTurn(1);
    expect(text(".ch-card")).toContain("Right claim");
    expect(text(".ch-card__v")).toBe("$212");
  });

  it("names money protected and penalties avoided in their own words, never a count as dollars", () => {
    render(done({ trace: KINDED, found_usd: 1200 }));
    expect(text(".ad-show__n")).toBe("$1,200");
    expect(all(".ad-show__kind")).toEqual([
      "$380,000 protected in the example",
      "$5,000 in penalties avoided in the example",
    ]);
    expect(text(".ad-show__found")).not.toContain("$10");
    expect(all(".ch-card__v")).toEqual([
      "$1,200",
      "$380,000 protected",
      "",
      "$5,000 in penalties avoided",
    ]);
  });

  it("claims no dollars when no card was money back, and still counts what she would propose", () => {
    const trace = [{ ...KINDED[0], cards: [KINDED[0].cards[2]] }];
    render(done({ trace, found_usd: null }));
    expect(text(".ad-show__n")).toBe("1 card");
    expect(text(".ad-show__found")).toContain("she would propose in the practice run");
    expect(text(".ad-show__found")).not.toMatch(/\$\d/);
  });
});

describe("a practice run adjusted to the person's case", () => {
  const shapedRaw = [
    { ...RAW[0], adjusted: 3 },
    {
      ...RAW[1],
      cards: [
        card("DL1", null, { outcome: "proposed" }),
        card("DL2", 40, { outcome: "trap" }),
      ],
    },
  ];

  it("says how many things it adjusted, claims no dollar figure, and counts cards", () => {
    render(done({ trace: shapedRaw, found_usd: null, found_reason: "shaped" }));
    expect(text(".ad-show__label")).toContain(
      "Practice run adjusted to 3 things you told her — nothing was sent",
    );
    const found = text(".ad-show__found");
    expect(text(".ad-show__n")).toBe("2 cards");
    expect(found).toContain(
      "she would propose in the practice run, against 1 card in the example's recorded run",
    );
    expect(found).toContain("no dollar figure is claimed and no card is marked right or wrong");
    expect(host.textContent).not.toMatch(/\$\d/);
    expect(host.textContent).not.toMatch(/shaped like your case/);
  });

  it("marks no card right, wrong or a trap from the old answer key", () => {
    render(done({ trace: shapedRaw, found_usd: null, found_reason: "shaped" }));
    goToTurn(1);
    expect(all(".ch-card").join(" ")).not.toMatch(
      /Right claim|Fell for a trap|Unfounded|Fair either way/,
    );
    expect(all(".ch-card__v")).toEqual(["", ""]);
  });

  it("claims no dollar figure even if a shaped event carried one", () => {
    render(done({ found_usd: 252, found_reason: "shaped" }));
    expect(host.textContent).not.toContain("$252");
  });

  it("says 'what you told her' when the daemon did not count the changes", () => {
    render(done({ found_usd: null, found_reason: "shaped" }));
    expect(text(".ad-show__label")).toContain(
      "Practice run adjusted to what you told her — nothing was sent",
    );
  });
});

describe("what the cards are", () => {
  it("calls every practice-run card one she would propose, never filed", () => {
    render(done({ found_usd: 252 }));
    expect(text(".ad-show__scope")).toBe(
      "Every card here is one she would propose for your OK. In a practice run nobody gives it, so nothing was sent and nothing was filed.",
    );
  });

  it("while it runs, the recorded run plays and nothing says 'shaped like yours'", () => {
    render(done({ status: "running", turn: 4, total: 11, trace: [] }));
    expect(text(".ad-show__label")).toContain("The benched run, shown with your portals");
    expect(text(".ad-show__line")).toContain("Practice run on invented data… turn 4 of 11");
    expect(host.querySelector(".ad-show__scope")).toBeNull();
    expect(host.textContent).not.toMatch(/shaped like your/);
  });
});

describe("the pure readers", () => {
  it("read the kinds and the adjusted count the daemon put on the trace", () => {
    expect(kindsIn(KINDED)).toEqual({
      request_payment: "money_back",
      release_lien: "money_protected",
      keep_bid: "count",
      file_on_time: "penalty_avoided",
    });
    expect(kindsIn(RAW)).toEqual({});
    expect(adjustedIn([{ adjusted: 2 }])).toBe(2);
    expect(adjustedIn([{ adjusted: 0 }])).toBeNull();
    expect(adjustedIn([])).toBeNull();
  });

  it("sum only right cards of a money kind other than money back", () => {
    const trace = parseTrace([
      {
        ...KINDED[0],
        cards: [
          ...KINDED[0].cards,
          card("LN2", 20000, { action: "release_lien", outcome: "trap" }),
        ],
      },
    ]);
    const kinds = kindsIn(KINDED);
    expect(otherKindsIn(trace, (t) => kinds[t] ?? "money_back")).toEqual([
      { kind: "money_protected", usd: 380000 },
      { kind: "penalty_avoided", usd: 5000 },
    ]);
  });

  it("plays a shaped run as plain cards with no value", () => {
    const shown = shownRun(RECORDED, {}, { rev: 1, event: done({ found_reason: "shaped" }) }, 1);
    expect(shown.shaped).toBe(true);
    expect(shown.trace[1].cards.map((c) => [c.outcome, c.valueUsd])).toEqual([
      ["other", null],
      ["other", null],
    ]);
  });
});

describe("a rehearsal belongs to the draft it followed", () => {
  it("case 4: draft 3 approved after draft 2 was rehearsed plays the recorded run and says it was draft 2's", () => {
    const shown = shownRun(RECORDED, {}, { rev: 2, event: done({ found_usd: 252 }) }, 3);
    expect(shown.tailored).toBe(false);
    expect(shown.rehearsedOn).toBe(2);
    act(() =>
      root.render(
        <Showcase
          recorded={RECORDED}
          portals={{}}
          rehearsal={{ rev: 2, event: done({ found_usd: 252 }) }}
          rev={3}
          onStart={() => {}}
        />,
      ),
    );
    expect(text(".ad-show__tag")).toBe("Recorded run");
    expect(host.textContent).not.toContain("Your practice run");
    expect(host.textContent).not.toContain("$252");
    expect(text(".ad-show__line")).toContain("rehearsed on draft 2");
    expect(text(".ad-show__line")).toContain("one rehearsal per conversation");
  });
});
