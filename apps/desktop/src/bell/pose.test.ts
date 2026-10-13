/** Tests for Athena's pose — README section 3.1, ADR 0026 and 0087. */
import { describe, expect, it } from "vitest";

import { POSES, POSE_WORDS, poseOf } from "./pose";

describe("poseOf", () => {
  it("rests when nothing runs, in any form that is not work", () => {
    for (const state of ["seal", "tab", "welcome", "ledger", "rest"]) {
      expect(poseOf({ state, cards: 0, line: "" }), state).toBe("resting");
    }
  });

  it("works on the tape, and on any form while a turn has a line", () => {
    expect(poseOf({ state: "tape", cards: 0, line: "" })).toBe("working");
    expect(poseOf({ state: "ledger", cards: 0, line: "Reading Invoices" })).toBe("working");
  });

  it("hears while a key is held", () => {
    expect(poseOf({ state: "hear", cards: 0, line: "" })).toBe("hearing");
  });

  it("asks when a card waits, whatever else she is doing", () => {
    expect(poseOf({ state: "seal", cards: 1, line: "" })).toBe("asking");
    expect(poseOf({ state: "tape", cards: 2, line: "Filing" })).toBe("asking");
    expect(poseOf({ state: "hear", cards: 1, line: "" })).toBe("asking");
  });

  it("has a word for every pose, and one pose each for the four things the mirror can say", () => {
    expect(POSES).toHaveLength(4);
    for (const p of POSES) expect(POSE_WORDS[p].length).toBeGreaterThan(0);
  });
});
