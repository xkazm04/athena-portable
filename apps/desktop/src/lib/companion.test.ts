/**
 * The size table mirror and the drag rule — ADR 0026 ("Named states, and Rust owns the sizes").
 *
 * The table is pinned by literal: Rust owns the real one (`companion.rs`), and this mirror exists
 * for layout arithmetic. If the ADR's table changes, this test is the second place to change.
 */
import { expect, test, vi } from "vitest";

import {
  athenaPin,
  athenaSetSize,
  ATHENA_STATES,
  beginDrag,
  dragged,
  HOUSE,
  MARGIN,
  pttHandler,
  SIZES,
  type PttDeps,
} from "./companion";

test("the named states and their sizes are the ADR's table", () => {
  expect(ATHENA_STATES).toEqual(["seal", "tape", "hear", "slip", "welcome", "ledger", "tab"]);
  expect(SIZES).toEqual({
    seal: { w: 92, h: 92 },
    tape: { w: 440, h: 92 },
    hear: { w: 440, h: 92 },
    slip: { w: 488, h: 316 },
    welcome: { w: 488, h: 432 },
    ledger: { w: 488, h: 656 },
    tab: { w: 28, h: 96 },
  });
  // The seal is the 76px housing inside an 8px shadow margin on every side.
  expect(SIZES.seal.w).toBe(HOUSE + 2 * MARGIN);
});

test("a command called without a shell rejects with a sentence, never an undefined property", async () => {
  await expect(athenaSetSize("seal", "left", "down")).rejects.toThrow(/athena_set_size needs the Tauri window/);
  await expect(athenaPin(true)).rejects.toThrow(/athena_pin/);
});

test("a press is a drag only after four pixels", () => {
  expect(dragged({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
  expect(dragged({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
  expect(dragged({ x: 10, y: 10 }, { x: 10, y: 14 })).toBe(true);
});

type Handler = (e: unknown) => void;

function fakeDoc() {
  const handlers = new Map<string, Set<Handler>>();
  return {
    handlers,
    addEventListener: (type: string, h: Handler) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(h);
    },
    removeEventListener: (type: string, h: Handler) => void handlers.get(type)?.delete(h),
    fire: (type: string, e: unknown) => [...(handlers.get(type) ?? [])].forEach((h) => h(e)),
    count: (type: string) => handlers.get(type)?.size ?? 0,
  };
}

function harness() {
  const doc = fakeDoc();
  const timers: Array<() => void> = [];
  const start = vi.fn(async () => {});
  const win = {
    setTimeout: ((f: () => void) => timers.push(f)) as unknown as Window["setTimeout"],
    clearTimeout: (() => {}) as unknown as Window["clearTimeout"],
  };
  return { doc, timers, start, deps: { start, doc: doc as never, win } };
}

test("under four pixels nothing starts and the click is left alone", () => {
  const h = harness();
  beginDrag({ clientX: 0, clientY: 0, button: 0 }, h.deps);
  h.doc.fire("pointermove", { clientX: 2, clientY: 1 });
  h.doc.fire("pointerup", {});
  expect(h.start).not.toHaveBeenCalled();
  expect(h.doc.count("click")).toBe(0);
  expect(h.doc.count("pointermove")).toBe(0);
});

test("after four pixels the drag starts once and the trailing click is swallowed once", () => {
  const h = harness();
  beginDrag({ clientX: 0, clientY: 0, button: 0 }, h.deps);
  h.doc.fire("pointermove", { clientX: 5, clientY: 0 });
  h.doc.fire("pointermove", { clientX: 9, clientY: 0 });
  expect(h.start).toHaveBeenCalledTimes(1);
  expect(h.doc.count("click")).toBe(1);
  const click = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
  h.doc.fire("click", click);
  expect(click.stopPropagation).toHaveBeenCalled();
  expect(click.preventDefault).toHaveBeenCalled();
  // One click only: the next one is a real click.
  expect(h.doc.count("click")).toBe(0);
});

test("a swallowed click that never comes is forgotten, so a later click is real", () => {
  const h = harness();
  beginDrag({ clientX: 0, clientY: 0, button: 0 }, h.deps);
  h.doc.fire("pointermove", { clientX: 8, clientY: 0 });
  expect(h.doc.count("click")).toBe(1);
  h.timers[0]();
  expect(h.doc.count("click")).toBe(0);
});

test("only the primary button drags", () => {
  const h = harness();
  beginDrag({ clientX: 0, clientY: 0, button: 2 }, h.deps);
  expect(h.doc.count("pointermove")).toBe(0);
});

// -- the global push-to-talk (ADR 0027) ---------------------------------------------------------

function ptt(over: Partial<PttDeps> = {}) {
  const log: string[] = [];
  const deps: PttDeps = {
    available: () => true,
    press: async () => void log.push("press"),
    release: () => void log.push("release"),
    visible: async () => false,
    ambient: (on) => void log.push(`ambient:${on}`),
    summon: () => void log.push("summon"),
    rehearsal: null,
    ...over,
  };
  return { handle: pttHandler(deps), log };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test("the held chord is press and its release is release, and a hidden window stays hidden", async () => {
  const { handle, log } = ptt();
  handle({ down: true });
  handle({ down: false });
  await settle();
  // The window was hidden: the turn is ambient, and nothing asks for a show or a summon.
  expect(log).toEqual(["ambient:true", "press", "release"]);
});

test("a visible window takes the turn as before", async () => {
  const { handle, log } = ptt({ visible: async () => true });
  handle({ down: true });
  await settle();
  handle({ down: false });
  await settle();
  expect(log).toEqual(["ambient:false", "press", "release"]);
});

test("a release never overtakes its own press", async () => {
  const log: string[] = [];
  let finish: () => void = () => {};
  const { handle } = ptt({
    press: () =>
      new Promise<void>((resolve) => {
        log.push("press");
        finish = () => {
          log.push("listening");
          resolve();
        };
      }),
    release: () => void log.push("release"),
    ambient: () => {},
  });
  handle({ down: true });
  handle({ down: false });
  await settle();
  expect(log).toEqual(["press"]);
  finish();
  await settle();
  expect(log).toEqual(["press", "listening", "release"]);
});

test("with no voice backend, production summons her window and development rehearses", async () => {
  const prod = ptt({ available: () => false });
  prod.handle({ down: true });
  prod.handle({ down: false });
  await settle();
  expect(prod.log).toEqual(["summon"]);

  const rehearsal = { down: vi.fn(), up: vi.fn() };
  const dev = ptt({ available: () => false, rehearsal });
  dev.handle({ down: true });
  dev.handle({ down: false });
  await settle();
  expect(rehearsal.down).toHaveBeenCalledTimes(1);
  expect(rehearsal.up).toHaveBeenCalledTimes(1);
  expect(dev.log).toEqual([]);
});
