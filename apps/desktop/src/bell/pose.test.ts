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

  it("has a word for every pose, and one pose each for the five things the mirror can say", () => {
    expect(POSES).toHaveLength(5);
    for (const p of POSES) expect(POSE_WORDS[p].length).toBeGreaterThan(0);
  });
});

describe("poseOf with her mirrored voice phase", () => {
  it("case 1: speaks while her voice plays, in words too", () => {
    expect(poseOf({ state: "seal", cards: 0, line: "", voice: "speaking" })).toBe("speaking");
    expect(POSE_WORDS.speaking).toBe("speaking");
    expect(POSES).toHaveLength(5);
  });

  it("case 2: her voice outranks work in flight, as haloPhase orders it", () => {
    expect(poseOf({ state: "tape", cards: 0, line: "Filing", voice: "speaking" })).toBe("speaking");
  });

  it("case 3: the mirrored listening phase hears as the held key does", () => {
    expect(poseOf({ state: "seal", cards: 0, line: "", voice: "listening" })).toBe("hearing");
  });

  it("case 4 (guard): a waiting card still wins over her voice on the Bell", () => {
    expect(poseOf({ state: "seal", cards: 1, line: "", voice: "speaking" })).toBe("asking");
  });

  it("case 5 (guard): with no voice phase, every pose is what the status alone gives", () => {
    const cases: [string, number, string, string][] = [
      ["seal", 0, "", "resting"],
      ["tab", 0, "", "resting"],
      ["welcome", 0, "", "resting"],
      ["ledger", 0, "", "resting"],
      ["rest", 0, "", "resting"],
      ["tape", 0, "", "working"],
      ["ledger", 0, "Reading Invoices", "working"],
      ["hear", 0, "", "hearing"],
      ["seal", 1, "", "asking"],
      ["tape", 2, "Filing", "asking"],
      ["hear", 1, "", "asking"],
    ];
    for (const [state, cards, line, pose] of cases) {
      expect(poseOf({ state, cards, line }), state).toBe(pose);
      expect(poseOf({ state, cards, line, voice: null }), state).toBe(pose);
      for (const voice of ["idle", "thinking", "gate"] as const) {
        expect(poseOf({ state, cards, line, voice }), `${state} ${voice}`).toBe(pose);
      }
    }
  });
});
