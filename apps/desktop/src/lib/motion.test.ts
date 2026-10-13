/** Tests for the shared clock and the Calm resolution — README section 3.1, ADR 0089. */
import { describe, expect, it } from "vitest";

import { createClock, isMotionChoice, resolveMotion, type ClockEnv } from "./motion";

/** A browser that only moves when told to: one pending callback, a hidden flag. */
function fakeEnv() {
  let pending: ((t: number) => void) | null = null;
  let hidden = false;
  let visible: () => void = () => {};
  let rafCalls = 0;
  const env: ClockEnv = {
    raf: (cb) => {
      rafCalls += 1;
      pending = cb;
      return rafCalls;
    },
    caf: () => {
      pending = null;
    },
    hidden: () => hidden,
    onVisible: (cb) => {
      visible = cb;
    },
  };
  return {
    env,
    pending: () => pending !== null,
    rafCalls: () => rafCalls,
    tick(t: number) {
      const cb = pending;
      pending = null;
      cb?.(t);
    },
    hide: () => (hidden = true),
    show() {
      hidden = false;
      visible();
    },
  };
}

describe("resolveMotion", () => {
  it("follows the OS only on system", () => {
    expect(resolveMotion("system", true)).toBe("calm");
    expect(resolveMotion("system", false)).toBe("full");
  });
  it("lets a choice override the OS in both directions", () => {
    expect(resolveMotion("full", true)).toBe("full");
    expect(resolveMotion("calm", false)).toBe("calm");
  });
  it("knows its choices", () => {
    expect(isMotionChoice("calm")).toBe(true);
    expect(isMotionChoice("fast")).toBe(false);
  });
});

describe("the clock", () => {
  it("asks the browser for nothing until someone subscribes", () => {
    const f = fakeEnv();
    createClock(f.env);
    expect(f.rafCalls()).toBe(0);
  });

  it("runs one loop however many subscribe", () => {
    const f = fakeEnv();
    const clock = createClock(f.env);
    clock.subscribe(() => {});
    clock.subscribe(() => {});
    clock.subscribe(() => {});
    expect(f.rafCalls()).toBe(1);
    f.tick(16);
    expect(f.rafCalls()).toBe(2);
  });

  it("drops a subscriber that says it settled, and goes idle when none are left", () => {
    const f = fakeEnv();
    const clock = createClock(f.env);
    let n = 0;
    clock.subscribe(() => (++n < 3 ? true : false));
    f.tick(16);
    f.tick(32);
    expect(clock.size).toBe(1);
    f.tick(48);
    expect(clock.size).toBe(0);
    expect(f.pending()).toBe(false);
    expect(clock.running).toBe(false);
  });

  it("cancels the pending frame when the last subscriber leaves", () => {
    const f = fakeEnv();
    const clock = createClock(f.env);
    const off = clock.subscribe(() => {});
    off();
    expect(f.pending()).toBe(false);
  });

  it("hands each subscriber its own delta, zero on the first frame", () => {
    const f = fakeEnv();
    const clock = createClock(f.env);
    const seen: number[] = [];
    clock.subscribe((_t, dt) => void seen.push(dt));
    f.tick(100);
    f.tick(116);
    expect(seen).toEqual([0, 16]);
  });

  it("does no work while hidden and restarts every delta when shown again", () => {
    const f = fakeEnv();
    const clock = createClock(f.env);
    const seen: number[] = [];
    clock.subscribe((_t, dt) => void seen.push(dt));
    f.tick(10);
    f.hide();
    f.tick(26);
    expect(seen).toEqual([0]);
    expect(f.pending()).toBe(false);
    f.show();
    f.tick(5000);
    expect(seen).toEqual([0, 0]);
  });

  it("lets a subscriber unsubscribe another during a frame without calling it", () => {
    const f = fakeEnv();
    const clock = createClock(f.env);
    let second = 0;
    let off2: () => void = () => {};
    clock.subscribe(() => off2());
    off2 = clock.subscribe(() => void second++);
    f.tick(16);
    expect(second).toBe(0);
  });
});
