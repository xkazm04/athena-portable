// @vitest-environment jsdom
/**
 * The loop current in the water, in a DOM — README section 3.1, ADR 0142 and 0089.
 *
 * The current is Loop Tide's alone, and it keeps the water's rule: it asks the window's one clock
 * for frames only while there is a reason (she is busy, or the water was just pushed), and a
 * settled stage asks for none.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Pose } from "@/bell/pose";
import { frames } from "@/lib/motion";
import { useShell } from "@/stores/shell";

import Backdrop from "./Backdrop";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
/** Pending frame callbacks, run by `tick`. */
let pending: ((t: number) => void)[] = [];
let now = 0;

beforeEach(() => {
  const ctx = new Proxy(
    {},
    { get: (_t, key) => (key === "globalAlpha" || key === "fillStyle" || key === "globalCompositeOperation" ? undefined : () => {}), set: () => true },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => pending.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  pending = [];
  now = 0;
  document.documentElement.setAttribute("data-theme", "dark");
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useShell.setState({ skin: "athena" });
});

/** Render, and let the lazily fetched current arrive (it is not in the first frame's bytes). */
async function render(props: { pose?: Pose; seq?: number; move?: "none" | "down"; calm?: boolean }) {
  host ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(host);
  await act(async () => {
    root!.render(
      <Backdrop depth={0} move={props.move ?? "none"} seq={props.seq ?? 0} calm={props.calm ?? false} pose={props.pose ?? "resting"} />,
    );
    await import("./SkinWater");
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** Run the browser's pending frames for `ms` of time, 16 ms apart. */
function tick(ms: number) {
  for (let t = 0; t < ms; t += 16) {
    now += 16;
    const due = pending;
    pending = [];
    for (const cb of due) cb(now);
  }
}

it("is Loop Tide's alone: her own teal water has no current", async () => {
  await render({});
  expect(host!.querySelector(".backdrop__current")).toBeNull();
  await act(async () => {
    useShell.setState({ skin: "loop-tide" });
    await import("./SkinWater");
  });
  await act(async () => {
    await Promise.resolve();
  });
  const current = host!.querySelector(".backdrop__current");
  expect(current).not.toBeNull();
  // Under the vignette, so the frame's edges stay dark over it.
  expect(current!.nextElementSibling?.className).toBe("backdrop__vignette");
});

it("a resting stage asks the clock for nothing", async () => {
  useShell.setState({ skin: "loop-tide" });
  await render({ pose: "resting" });
  expect(frames().size).toBe(0);
});

it("flows while she works, and settles and lets the clock go when she rests", async () => {
  useShell.setState({ skin: "loop-tide" });
  await render({ pose: "working" });
  expect(frames().size).toBe(1);
  tick(1000);
  expect(frames().size).toBe(1);
  await render({ pose: "resting" });
  tick(6000);
  expect(frames().size).toBe(0);
});

it("a move pushes the water: it coasts, then stops asking", async () => {
  useShell.setState({ skin: "loop-tide" });
  await render({ pose: "resting" });
  await render({ pose: "resting", seq: 1, move: "down" });
  // The current and the snow both coast on the push.
  expect(frames().size).toBe(2);
  tick(8000);
  expect(frames().size).toBe(0);
});

it("under Calm it is drawn once and never asks, even while she works", async () => {
  useShell.setState({ skin: "loop-tide" });
  await render({ pose: "working", calm: true });
  await render({ pose: "working", calm: true, seq: 1, move: "down" });
  expect(frames().size).toBe(0);
});
