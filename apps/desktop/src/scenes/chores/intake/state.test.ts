/** Tests for the Chores front door's reducer — ADR 0098. Pure; no DOM. */
import { describe, expect, it } from "vitest";

import type { AdoptEvent } from "@/lib/adopt";

import {
  INITIAL,
  SESSION_CLOSED,
  needOf,
  reduce,
  type IntakeState,
} from "./state";

const verdict = (
  seq: number,
  over: Partial<Extract<AdoptEvent, { kind: "adopt.verdict" }>> = {},
): AdoptEvent => ({
  kind: "adopt.verdict",
  seq,
  fit: "template",
  playbook_id: "travel-credit-refunds",
  why: "It fits.",
  differs: "Your airline.",
  alternates: [],
  need: "I want my credits back.",
  command: "",
  ...over,
});

const say = (seq: number, text = "Hi"): AdoptEvent => ({
  kind: "adopt.say",
  seq,
  text,
});
const apply = (s: IntakeState, ...events: AdoptEvent[]) =>
  events.reduce((x, e) => reduce(x, { t: "event", e }), s);

describe("the front door's reducer", () => {
  it("draws her lines and keeps the verdict as the conversation's end", () => {
    const s = apply(
      INITIAL,
      say(1),
      { kind: "adopt.progress", seq: 2, text: "Deciding…" },
      verdict(3),
    );
    expect(s.feed.map((f) => f.kind)).toEqual(["say"]);
    expect(s.verdict).toEqual({
      fit: "template",
      playbook_id: "travel-credit-refunds",
      why: "It fits.",
      differs: "Your airline.",
      alternates: [],
      need: "I want my credits back.",
      command: "",
    });
    expect(s.progress).toBe("");
    expect(s.lastSeq).toBe(3);
  });

  it("ignores a seq at or below the last one drawn, a verdict included", () => {
    const first = apply(INITIAL, say(1), say(2), verdict(3));
    const again = apply(
      first,
      say(2, "stale"),
      verdict(3, { fit: "custom", playbook_id: "", command: "x" }),
      say(1, "older"),
    );
    expect(again).toBe(first);
    expect(again.verdict?.fit).toBe("template");
    expect(apply(INITIAL, say(5), say(4, "late")).feed).toHaveLength(1);
  });

  it("holds an engine fault until she goes on, and does not feed it as a line", () => {
    const faulted = apply(INITIAL, say(1), {
      kind: "adopt.error",
      seq: 2,
      reason: "engine_error",
      detail: "boom",
    });
    expect(faulted.fault).toEqual({ reason: "engine_error", detail: "boom" });
    expect(faulted.feed.map((f) => f.kind)).toEqual(["say"]);
    expect(
      apply(faulted, {
        kind: "adopt.usage",
        seq: 3,
        leg: "intake",
        model: "m",
        effort: "low",
        ms: 5,
        first_text_ms: null,
      }).fault,
    ).not.toBeNull();
    expect(apply(faulted, say(3)).fault).toBeNull();
  });

  it("takes session_closed as the stream's end, never as a fault", () => {
    const s = apply(INITIAL, say(1), {
      kind: "adopt.error",
      seq: 2,
      reason: SESSION_CLOSED,
      detail: "idle",
    });
    expect(s.fault).toBeNull();
    expect(s.lastSeq).toBe(2);
    const closed = reduce(s, {
      t: "conn",
      conn: "closed",
      tries: 0,
      reason: SESSION_CLOSED,
      detail: "idle",
    });
    expect(closed.conn).toBe("closed");
    expect(closed.verdict).toBeNull();
  });

  it("keeps the verdict and the fault through the person's own acts, and drops them on restart", () => {
    let s = apply(INITIAL, verdict(1));
    s = reduce(s, { t: "said", key: "l1", text: "ok", via: "text" });
    expect(s.verdict).not.toBeNull();
    s = reduce(s, { t: "enough" });
    expect(s.enough).toBe(true);
    expect(s.verdict).not.toBeNull();
    expect(reduce(s, { t: "restart" })).toBe(INITIAL);
  });

  it("carries the first thing the person said as the need a retry starts with", () => {
    expect(needOf(INITIAL)).toBe("");
    const said = reduce(INITIAL, {
      t: "said",
      key: "l1",
      text: "refund my credits",
      via: "text",
    });
    expect(needOf(said)).toBe("refund my credits");
    const card = apply(INITIAL, {
      kind: "adopt.questions",
      seq: 1,
      round: 1,
      questions: [
        {
          id: "q",
          slot_ids: [],
          text: "?",
          options: [],
          multi: false,
          allow_text: true,
        },
      ],
    });
    const answered = reduce(card, {
      t: "answered",
      key: "e1",
      answers: [{ question_id: "q", choice_ids: [], text: "my credits" }],
    });
    expect(needOf(answered)).toBe("my credits");
  });
});
