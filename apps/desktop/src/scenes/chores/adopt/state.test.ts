/** Tests for the Adopt studio's reducer and words — ADR 0097. No DOM. */
import { describe, expect, it } from "vitest";

import type { AdoptEvent, Lane, Question } from "@/lib/adopt";
import type { TraceTurn } from "@/lib/playbooks";

import { shownRun } from "./showcase";
import {
  INITIAL,
  approval,
  harvestLine,
  receipt,
  reduce,
  slotGroups,
  withPortals,
  type StudioState,
} from "./state";

const play = (events: AdoptEvent[], from: StudioState = INITIAL) =>
  events.reduce((s, e) => reduce(s, { t: "event", e }), from);

const lane = (
  id: string,
  kind: Lane["kind"],
  status: Lane["status"],
  summary = "",
): Lane => ({
  id,
  kind,
  title: id,
  status,
  summary,
  findings: [],
});

const brief = (seq: number, rev: number): AdoptEvent => ({
  kind: "adopt.brief",
  seq,
  rev,
  md: "m",
  command: "c",
  portals: {},
  open_slot_ids: [],
});

describe("the fold over the events", () => {
  it("drops an event at or below the last seq, so a resend after a reconnect is harmless", () => {
    const s = play([
      { kind: "adopt.say", seq: 1, text: "a" },
      { kind: "adopt.say", seq: 2, text: "b" },
      { kind: "adopt.say", seq: 2, text: "b again" },
      { kind: "adopt.say", seq: 1, text: "a again" },
    ]);
    expect(s.feed.map((f) => (f.kind === "say" ? f.text : ""))).toEqual([
      "a",
      "b",
    ]);
    expect(s.lastSeq).toBe(2);
  });

  it("replaces the progress beat, and hides it when a card or the brief arrives", () => {
    let s = play([
      { kind: "adopt.progress", seq: 1, text: "one" },
      { kind: "adopt.progress", seq: 2, text: "two" },
    ]);
    expect(s.progress).toBe("two");
    s = play([{ kind: "adopt.questions", seq: 3, round: 1, questions: [] }], s);
    expect(s.progress).toBe("");
    s = play(
      [{ kind: "adopt.progress", seq: 4, text: "three" }, brief(5, 1)],
      s,
    );
    expect(s.progress).toBe("");
  });

  it("keeps one row a lane, updated in place, in the order lanes first appeared", () => {
    const s = play([
      { kind: "adopt.lane", seq: 1, lane: lane("rules", "rules", "running") },
      { kind: "adopt.lane", seq: 2, lane: lane("memory", "memory", "running") },
      { kind: "adopt.lane", seq: 3, lane: lane("rules", "rules", "done") },
    ]);
    expect(s.lanes.map((l) => `${l.id}:${l.status}`)).toEqual([
      "rules:done",
      "memory:running",
    ]);
  });

  it("counts usage, records clear and showcase, and puts an error in the conversation", () => {
    const s = play([
      {
        kind: "adopt.usage",
        seq: 1,
        leg: "audit",
        model: "m",
        effort: "low",
        ms: 1500,
        first_text_ms: null,
      },
      {
        kind: "adopt.usage",
        seq: 2,
        leg: "audit",
        model: "m",
        effort: "low",
        ms: 500,
        first_text_ms: null,
      },
      { kind: "adopt.clear", seq: 3, rev: 4 },
      {
        kind: "adopt.showcase",
        seq: 4,
        status: "running",
        turn: 1,
        total: 3,
        trace: [],
        found_usd: null,
        detail: "",
      },
      { kind: "adopt.error", seq: 5, reason: "engine_error", detail: "x" },
    ]);
    expect(s.usage).toEqual({ calls: 2, ms: 2000 });
    expect(s.clearRev).toBe(4);
    expect(s.showcase?.status).toBe("running");
    expect(s.feed.at(-1)).toMatchObject({
      kind: "error",
      reason: "engine_error",
    });
  });
});

describe("approval", () => {
  it("opens only for the revision the auditor cleared, or for any once the person said enough", () => {
    let s = play([brief(1, 1)]);
    expect(approval(s).can).toBe(false);
    s = play([{ kind: "adopt.clear", seq: 2, rev: 1 }, brief(3, 2)], s);
    expect(approval(s).can).toBe(false); // rev 1 was cleared, rev 2 is on show
    s = play([{ kind: "adopt.clear", seq: 4, rev: 2 }], s);
    expect(approval(s).can).toBe(true);
    s = reduce(s, { t: "approved", rev: 2 });
    expect(approval(s).can).toBe(false);

    const early = reduce(play([brief(1, 1)]), { t: "enough" });
    expect(approval(early).can).toBe(true);
    expect(approval(INITIAL)).toEqual({
      can: false,
      why: "There is no brief yet.",
    });
  });
});

describe("the words", () => {
  const qs: Question[] = [
    {
      id: "m",
      slot_ids: [],
      text: "Mail?",
      options: [{ id: "g", label: "Postwren" }],
      multi: false,
      allow_text: true,
    },
    {
      id: "a",
      slot_ids: [],
      text: "Airlines?",
      options: [
        { id: "y", label: "yes" },
        { id: "n", label: "no" },
      ],
      multi: true,
      allow_text: true,
    },
  ];

  it("reads a card back in a line, labels first then the words, and cuts a long one", () => {
    const line = receipt(qs, [
      { question_id: "m", choice_ids: ["g"], text: "" },
      { question_id: "a", choice_ids: ["y"], text: "3 airlines" },
    ]);
    expect(line).toBe("Postwren · yes, 3 airlines");
    expect(
      receipt(
        qs,
        [{ question_id: "m", choice_ids: [], text: "x".repeat(200) }],
        20,
      ),
    ).toHaveLength(20);
    expect(receipt(qs, [])).toBe("skipped");
  });

  it("says the harvest with the failed lanes' reasons", () => {
    expect(harvestLine([])).toBe("");
    expect(
      harvestLine([
        lane("a", "memory", "done"),
        lane("b", "accounts", "done"),
        lane("c", "document", "done"),
        lane("d", "rules", "failed", "timeout"),
      ]),
    ).toBe("3 of 4 lanes done · 1 failed (rules: timeout)");
    expect(harvestLine([lane("a", "memory", "skipped")])).toBe(
      "0 of 1 lane done · 1 skipped",
    );
  });

  it("groups the slots by kind in a fixed order and leaves out an empty group", () => {
    const g = slotGroups([
      {
        id: "t",
        kind: "trap",
        label: "",
        status: "open",
        value: "",
        source: "default",
      },
      {
        id: "p",
        kind: "portal",
        label: "",
        status: "open",
        value: "",
        source: "default",
      },
    ]);
    expect(g.map((x) => x.label)).toEqual(["Portals", "Traps"]);
  });
});

const turn = (over: Partial<TraceTurn>): TraceTurn => ({
  portal: "",
  user: "",
  continued: false,
  said: "",
  saidChars: 0,
  reads: [],
  cards: [],
  ...over,
});

describe("the recorded run with the person's portals", () => {
  const trace = [
    turn({
      portal: "Postwren",
      user: "Open Postwren.",
      said: "In Postwren and Postwren2 and Cardhollow.",
      saidChars: 60,
      reads: ["postwren_list"],
    }),
    turn({ portal: "Aerolark", said: "Aerolark Plus is not Aerolark." }),
  ];

  it("swaps each name, whole words only, longest first, and leaves tool names and the same-name portals", () => {
    const out = withPortals(trace, {
      Postwren: "Gmail",
      Cardhollow: "Chase",
      Aerolark: "",
      "Aerolark Plus": "Delta",
    });
    expect(out[0]).toMatchObject({
      portal: "Gmail",
      user: "Open Gmail.",
      said: "In Gmail and Postwren2 and Chase.",
      reads: ["postwren_list"],
    });
    expect(out[0]!.saidChars).toBe(
      60 + (out[0]!.said.length - trace[0]!.said.length),
    );
    expect(out[1]).toMatchObject({
      portal: "Aerolark",
      said: "Delta is not Aerolark.",
    });
    expect(withPortals(trace, {})).toEqual(trace);
  });

  it("plays the recorded run until the rehearsal is done with turns, then the rehearsal", () => {
    const showcase = (
      status: "running" | "done" | "failed",
      raw: Record<string, unknown>[] = [],
    ) => ({
      kind: "adopt.showcase" as const,
      seq: 1,
      status,
      turn: null,
      total: null,
      trace: raw,
      found_usd: 12,
      detail: "",
    });
    expect(shownRun(trace, { Postwren: "Gmail" }, null)).toMatchObject({
      tailored: false,
      label: "The benched run, shown with your portals",
    });
    expect(shownRun(trace, {}, showcase("running")).tailored).toBe(false);
    expect(shownRun(trace, {}, showcase("failed")).tailored).toBe(false);
    expect(shownRun(trace, {}, showcase("done", [])).tailored).toBe(false);
    const done = shownRun(
      trace,
      {},
      showcase("done", [{ portal: "Gmail", said: "Found it.", said_chars: 9 }]),
    );
    expect(done.tailored).toBe(true);
    expect(done.trace[0]).toMatchObject({ portal: "Gmail", said: "Found it." });
    expect(done.label).toMatch(/nothing was sent/);
  });
});
