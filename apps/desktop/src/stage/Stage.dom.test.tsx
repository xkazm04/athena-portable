// @vitest-environment jsdom
/**
 * The stage wired to the depth store, in a DOM — README section 3.1 and 3.5, ADR 0087.
 *
 * `Stage.test.tsx` renders the view from a state it is handed; this file mounts it the way the
 * console does (the stage first, then the app root's effect starts the store), so the order the
 * real window runs in is the order under test.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { INITIAL, formatHash } from "@/depth/model";
import { startDepth, useDepth } from "@/depth/store";

import Stage from "./Stage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
let stopDepth: () => void = () => {};

beforeEach(() => {
  // jsdom draws no canvas; the water's snow is not this file's subject.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  useDepth.setState({ ...INITIAL });
});

afterEach(() => {
  stopDepth();
  stopDepth = () => {};
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.history.replaceState(null, "", "#/");
  vi.restoreAllMocks();
});

/** The console's wiring, without the scenes: each layer says which place it was drawn for. */
function Wired() {
  const s = useDepth();
  return (
    <Stage
      state={{ path: s.path, from: s.from, move: s.move, seq: s.seq }}
      calm={false}
      renderScene={(p) => <p data-scene={formatHash(p)}>scene</p>}
      presence={{ pose: "resting", text: "resting", waiting: 0 }}
      onGo={s.go}
      onRise={s.rise}
      onSurface={s.surface}
      onSettle={s.settle}
    />
  );
}

function mount(): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Wired />));
  return host;
}

const scenes = (h: HTMLElement) =>
  [...h.querySelectorAll(".stage__layer [data-scene]")].map((e) => e.getAttribute("data-scene"));

it("a reload at a depth draws that depth's scene, not the surface the stage was mounted on", () => {
  window.history.replaceState(null, "", "#/mind/engine");
  const h = mount(); // the stage renders before the root's effect starts the store, as in the window
  act(() => {
    stopDepth = startDepth();
  });
  expect(h.querySelector(".stage")!.getAttribute("data-depth")).toBe("2");
  expect(scenes(h)).toEqual(["#/mind/engine"]);
});

it("a reload at the surface leaves the one surface layer as it was", () => {
  window.history.replaceState(null, "", "#/");
  const h = mount();
  act(() => {
    stopDepth = startDepth();
  });
  expect(scenes(h)).toEqual(["#/"]);
  expect(useDepth.getState().seq).toBe(0);
});
