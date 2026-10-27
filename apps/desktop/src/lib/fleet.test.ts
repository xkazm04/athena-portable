/** The fleet's two streams, decoded — ADR 0140 (`src/athena/peer/events.py`, `remote.py`). */
import { describe, expect, it, vi } from "vitest";

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

  it("logs a handler that throws and keeps reading the same stream", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let connects = 0;
    const seen: string[] = [];
    let stop = () => {};
    await new Promise<void>((done) => {
      stop = followBus(
        () => ({
          async *events() {
            yield { kind: "peer.changed", peer_id: "dev_bad" } as BusEvent;
            yield { kind: "peer.changed", peer_id: "dev_good" } as BusEvent;
          },
        }),
        (event) => {
          const id = event.kind === "peer.changed" ? event.peer_id : null;
          if (id === "dev_bad") throw new Error("handler broke");
          seen.push(String(id));
        },
        () => {
          connects += 1;
        },
        async () => done(),
      );
    });
    stop();
    const logged = errors.mock.calls.map((c) => c.map(String).join(" "));
    errors.mockRestore();
    // One connect, and the frame after the throw was still delivered on it.
    expect(connects).toBe(1);
    expect(seen).toEqual(["dev_good"]);
    expect(logged).toEqual([expect.stringContaining("handler broke")]);
  });
});

describe("one /events stream per window", () => {
  it("opens one stream for every follower alive, and closes it with the last", async () => {
    let open = 0;
    let peak = 0;
    let opened = 0;
    let aborted = 0;
    const source = () => ({
      async *events(signal?: AbortSignal) {
        open += 1;
        opened += 1;
        peak = Math.max(peak, open);
        try {
          yield { kind: "sleep.changed" } as BusEvent;
          await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
        } finally {
          open -= 1;
          if (signal?.aborted) aborted += 1;
        }
      },
    });
    const seen: string[][] = [[], [], [], []];
    const connected = [0, 0, 0, 0];
    const stops = seen.map((log, i) =>
      followBus(source, (e) => log.push(e.kind), () => (connected[i] += 1), async () => {}),
    );
    await vi.waitFor(() => expect(seen.every((log) => log.length === 1)).toBe(true), { timeout: 5000 });
    // Four stores, one connection: the pool of six per host is for requests, not for nudges.
    expect(peak).toBe(1);
    expect(opened).toBe(1);
    // The first opened it and was told; the rest read for themselves on starting.
    expect(connected).toEqual([1, 0, 0, 0]);
    stops[0]();
    stops[1]();
    stops[2]();
    expect(open).toBe(1);
    stops[3]();
    await vi.waitFor(() => expect(open).toBe(0), { timeout: 5000 });
    expect(aborted).toBe(1);
  });

  it("lets a follower join a live stream without a second one, and starts anew once all have gone", async () => {
    const source = () => ({
      async *events(signal?: AbortSignal) {
        yield { kind: "sleep.changed" } as BusEvent;
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
      },
    });
    const first: string[] = [];
    const stopFirst = followBus(source, (e) => first.push(e.kind), undefined, async () => {});
    let joined = 0;
    const stopSecond = followBus(source, () => {}, () => (joined += 1), async () => {});
    expect(joined).toBe(0);
    stopFirst();
    stopSecond();
    const again: string[] = [];
    const stopAgain = followBus(source, (e) => again.push(e.kind), undefined, async () => {});
    await vi.waitFor(() => expect(again).toEqual(["sleep.changed"]), { timeout: 5000 });
    stopAgain();
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
