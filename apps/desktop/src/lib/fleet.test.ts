/** The fleet's two streams, decoded — ADR 0140 (`src/athena/peer/events.py`, `remote.py`). */
import { describe, expect, it } from "vitest";

import { busEventFromJson, followBus, overlayWords, turnFrameFromJson, type BusEvent } from "./fleet";

describe("the event bus", () => {
  it("decodes the kinds the window acts on", () => {
    expect(busEventFromJson(JSON.stringify({ kind: "peer.changed", peer_id: null }))).toEqual({ kind: "peer.changed", peer_id: null });
  });

  it("skips a kind it does not know, and junk, rather than throwing: the bus is a nudge", () => {
    expect(busEventFromJson(JSON.stringify({ kind: "setup.phase" }))).toBeNull();
    expect(busEventFromJson("not json")).toBeNull();
  });

  it("is followed again after each end, re-reading on every connect", async () => {
    let connects = 0;
    const seen: BusEvent[] = [];
    const waits: number[] = [];
    let stop = () => {};
    await new Promise<void>((done) => {
      stop = followBus(
        () => ({
          async *events() {
            yield { kind: "peer.changed", peer_id: "dev_0000000000a2" } as BusEvent;
          },
        }),
        (event) => seen.push(event),
        () => {
          connects += 1;
        },
        async (ms) => {
          waits.push(ms);
          if (waits.length === 2) done();
        },
      );
    });
    stop();
    expect(connects).toBe(2);
    expect(seen).toHaveLength(2);
    expect(waits).toEqual([1000, 1000]);
  });
});

describe("a relayed turn", () => {
  it("reads the close frame, and every other frame strictly as a channel event", () => {
    const closed = turnFrameFromJson(JSON.stringify({ kind: "remote.closed", request_id: "job_1", reason: "finished", showing: 1, total: 1, footer: "" }));
    expect(closed.kind).toBe("remote.closed");
    expect(turnFrameFromJson(JSON.stringify({ kind: "text.delta", text: "hi" })).kind).toBe("text.delta");
    expect(() => turnFrameFromJson(JSON.stringify({ kind: "made.up" }))).toThrow();
  });
});

it("says the overlay in plain words", () => {
  expect([overlayWords("absent"), overlayWords("logged_out"), overlayWords("up")]).toEqual(["Not set up", "Signed out", "Ready"]);
});
