// @vitest-environment jsdom
/**
 * The water's snow, in a DOM — README section 3.1, ADR 0087 and 0089.
 *
 * A canvas cannot read a CSS variable, so the snow asks for the accent token itself. The theme can
 * change under a mounted stage (the settings resolve after the first paint; the bar's theme button),
 * and the snow is then repainted in the new accent.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import Backdrop from "./Backdrop";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The two themes' `--accent` (`styles/app.css`). */
const ACCENT: Record<string, string> = { dark: "#22d3ee", light: "#0891b2" };

let root: Root | null = null;
let host: HTMLElement | null = null;
/** Every colour a flake was filled with, in order. */
let fills: string[] = [];

beforeEach(() => {
  fills = [];
  const ctx = {
    setTransform: () => {},
    clearRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    globalAlpha: 1,
    set fillStyle(v: string) {
      fills.push(v);
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () =>
      ({
        getPropertyValue: (name: string) =>
          name === "--accent" ? (ACCENT[document.documentElement.getAttribute("data-theme") ?? "dark"] ?? "") : "",
      }) as CSSStyleDeclaration,
  );
  document.documentElement.setAttribute("data-theme", "dark");
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.setAttribute("data-theme", "dark");
});

function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Backdrop depth={0} move="none" seq={0} calm={false} />));
}

it("paints the snow in the theme's accent, and again in the new one when the theme changes", async () => {
  mount();
  expect(fills.at(-1)).toBe(ACCENT.dark);
  await act(async () => {
    document.documentElement.setAttribute("data-theme", "light");
    await Promise.resolve(); // a MutationObserver reports on a microtask
  });
  expect(fills.at(-1)).toBe(ACCENT.light);
});

it("stops listening for the theme once the water is gone", async () => {
  mount();
  act(() => root!.unmount());
  root = null;
  const before = fills.length;
  await act(async () => {
    document.documentElement.setAttribute("data-theme", "light");
    await Promise.resolve();
  });
  expect(fills).toHaveLength(before);
});
