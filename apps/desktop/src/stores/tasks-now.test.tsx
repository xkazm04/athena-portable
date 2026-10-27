// @vitest-environment jsdom
/**
 * The tasks clock (`useTasksNow`, ADR 0141): it moves every second while a task runs, so the row's
 * time moves - and not at all while the window is hidden, where nobody reads it; it catches up the
 * moment the window is shown.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetTasksForTests, setTasksDeps, useTasksNow } from "./tasks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let hidden = false;
let clock = 0;
let renders: number[] = [];
let host: HTMLDivElement;
let root: Root;

function Probe() {
  renders.push(useTasksNow(true));
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  clock = 1_000;
  renders = [];
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  setTasksDeps({ api: () => null, now: () => clock });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Reflect.deleteProperty(document, "hidden");
  resetTasksForTests();
  vi.useRealTimers();
});

/** Let `ms` pass a second at a time, each its own act, so each tick is its own render. */
const pass = (ms: number) => {
  for (let at = 0; at < ms; at += 1_000)
    act(() => {
      clock += 1_000;
      vi.advanceTimersByTime(1_000);
    });
};

describe("the tasks clock", () => {
  it("moves every second while a task runs and the window is shown", () => {
    act(() => root.render(<Probe />));
    pass(3_000);
    expect(renders.length).toBe(4);
    expect(renders.at(-1)).toBe(4_000);
  });

  it("does not move behind a hidden window, and catches up when it is shown", () => {
    act(() => root.render(<Probe />));
    hidden = true;
    pass(10_000);
    expect(renders.length).toBe(1);
    hidden = false;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(renders.length).toBe(2);
    expect(renders.at(-1)).toBe(11_000);
  });
});
