/**
 * The parked studio — what outlives a move away from the Adopt studio (ADR 0179).
 *
 * The store holds at most one parked conversation; parking a second hands back the one it
 * displaced (so the caller closes it on the daemon); a parked entry expires locally before the
 * daemon's two-hour idle TTL; only a conversation the person said something in is worth parking.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  PARK_LIMIT_MS,
  expired,
  forgetParked,
  park,
  parkKey,
  parked,
  resumeLine,
  unpark,
  worthParking,
  type Parked,
} from "./park";
import { INITIAL, type FeedItem, type StudioState } from "./state";

const card = (answered: boolean): FeedItem => ({
  kind: "card",
  key: "e1",
  round: 1,
  questions: [],
  answers: answered ? [{ question_id: "q", choice_ids: ["a"], text: "" }] : null,
});

const with_ = (feed: FeedItem[], patch: Partial<StudioState> = {}): StudioState => ({
  ...INITIAL,
  sid: "s1",
  conn: "live",
  feed,
  ...patch,
});

const entry = (key: string, sid: string, parkedAt = 0): Parked => ({
  key,
  sid,
  lastSeq: 7,
  state: with_([card(true)]),
  keys: 0,
  parkedAt,
});

afterEach(forgetParked);

describe("the parked studio", () => {
  it("is keyed by playbook and case", () => {
    expect(parkKey("pb")).toBe("pb/");
    expect(parkKey("pb", "proj_1")).toBe("pb/proj_1");
  });

  it("holds one conversation, and parking another hands back the one it displaced", () => {
    expect(park(entry("a/", "sA"))).toBeNull();
    expect(parked("a/")?.sid).toBe("sA");
    expect(parked("b/")).toBeNull();
    expect(park(entry("b/", "sB"))?.sid).toBe("sA");
    expect(parked()?.sid).toBe("sB");
    unpark();
    expect(parked()).toBeNull();
  });

  it("expires under the daemon's two-hour idle TTL", () => {
    expect(PARK_LIMIT_MS).toBeLessThan(2 * 60 * 60 * 1000);
    expect(expired(entry("a/", "sA", 1000), 1000 + PARK_LIMIT_MS)).toBe(false);
    expect(expired(entry("a/", "sA", 1000), 1001 + PARK_LIMIT_MS)).toBe(true);
  });

  it("is worth it only once the person said something, and not after a hand-off or a close", () => {
    expect(worthParking(with_([]))).toBe(false);
    expect(worthParking(with_([card(false)]))).toBe(false);
    expect(worthParking(with_([card(true)]))).toBe(true);
    expect(worthParking(with_([{ kind: "you", key: "l1", text: "hi", via: "text" }]))).toBe(true);
    expect(
      worthParking(with_([{ kind: "doc", key: "l1", name: "a.pdf", status: "sent", detail: "" }])),
    ).toBe(true);
    expect(
      worthParking(with_([{ kind: "doc", key: "l1", name: "a.pdf", status: "failed", detail: "x" }])),
    ).toBe(false);
    expect(worthParking(with_([card(true)], { handedRev: 2 }))).toBe(false);
    expect(worthParking(with_([card(true)], { conn: "closed" }))).toBe(false);
  });

  it("says how far the conversation got", () => {
    const you: FeedItem = { kind: "you", key: "l1", text: "hi", via: "text" };
    expect(resumeLine(with_([card(true), you]))).toBe(
      "You were part-way through (2 answers). Continue where you left off, or start over.",
    );
    expect(
      resumeLine(
        with_([card(true)], {
          brief: {
            kind: "adopt.brief",
            seq: 3,
            rev: 2,
            md: "",
            command: "",
            portals: {},
            open_slot_ids: [],
          },
        }),
      ),
    ).toBe(
      "You were part-way through (1 answer, draft 2). Continue where you left off, or start over.",
    );
  });
});
