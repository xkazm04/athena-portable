/** The shared mirror reader: one flight, a generation minted at issue, a throttled reconnect. */
import { describe, expect, it } from "vitest";

import { createMirror } from "./mirror";

/** A read the test answers by hand, in any order. */
interface Pending {
  n: number;
  resolve: (answer: string) => void;
  reject: (error: unknown) => void;
}

function harness(over: { rereadMinMs?: number } = {}) {
  const issued: Pending[] = [];
  const state = { shown: null as string | null, problem: null as string | null, applied: [] as string[] };
  let clock = 1_000;
  const mirror = createMirror<string>({
    read: () =>
      new Promise<string>((resolve, reject) => {
        issued.push({ n: issued.length + 1, resolve, reject });
      }),
    apply: (answer) => {
      state.shown = answer;
      state.problem = null;
      state.applied.push(answer);
    },
    onFail: (error) => {
      state.problem = String(error);
    },
    now: () => clock,
    rereadMinMs: over.rereadMinMs ?? 5000,
  });
  return {
    mirror,
    issued,
    state,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the mirror reader", () => {
  it("applies the newest issued read's answer, and drops an older one that lands after it", async () => {
    const { mirror, issued, state } = harness();
    const a = mirror.load();
    const b = mirror.refresh();
    expect(issued).toHaveLength(2);
    issued[1]!.resolve("B");
    await settle();
    issued[0]!.resolve("A");
    await Promise.all([a, b]);
    expect(state.shown).toBe("B");
    expect(state.applied).toEqual(["B"]);
  });

  it("leaves no joinable flight after a read that rejects: the next load reads afresh, and its success clears the problem", async () => {
    const { mirror, issued, state } = harness();
    const first = mirror.load();
    issued[0]!.reject(new Error("boom"));
    await first;
    expect(state.problem).toBe("Error: boom");
    const second = mirror.load();
    expect(issued).toHaveLength(2);
    issued[1]!.resolve("ok");
    await second;
    expect(state.problem).toBeNull();
    expect(state.shown).toBe("ok");
  });

  it("joins the read that is out, and reads once more after it for any number of nudges", async () => {
    const { mirror, issued } = harness();
    const a = mirror.load();
    const joined = mirror.load();
    mirror.nudge();
    mirror.nudge();
    mirror.nudge();
    expect(issued).toHaveLength(1);
    issued[0]!.resolve("A");
    await settle();
    expect(issued).toHaveLength(2);
    issued[1]!.resolve("B");
    await Promise.all([a, joined]);
    expect(issued).toHaveLength(2);
  });

  it("reads on a reconnect only once rereadMinMs has passed since the last read was issued", async () => {
    const { mirror, issued, tick } = harness({ rereadMinMs: 5000 });
    const a = mirror.load();
    issued[0]!.resolve("A");
    await a;
    tick(4999);
    mirror.reconnected();
    expect(issued).toHaveLength(1);
    tick(1);
    mirror.reconnected();
    expect(issued).toHaveLength(2);
  });

  it("counts its holders: follows once, and lets go with the last", () => {
    const bus = { follows: 0, stops: 0 };
    const mirror = createMirror<string>({
      read: () => null,
      apply: () => {},
      onFail: () => {},
      now: () => 0,
      rereadMinMs: 5000,
      follow: () => () => {
        bus.follows += 1;
        return () => {
          bus.stops += 1;
        };
      },
    });
    const a = mirror.hold();
    const b = mirror.hold();
    a();
    a();
    expect(bus).toEqual({ follows: 1, stops: 0 });
    expect(mirror.holders()).toBe(1);
    b();
    expect(bus).toEqual({ follows: 1, stops: 1 });
  });
});
