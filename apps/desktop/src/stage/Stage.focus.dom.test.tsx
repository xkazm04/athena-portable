// @vitest-environment jsdom
/**
 * Focus follows a move made before the stage's lazy memory of places (`places.ts`) has landed.
 *
 * The stage fetches `places.ts` after its first frame (ADR 0193). A move in that window - a dive
 * pressed at once, or the reload at a depth that the app root's first effect turns into a move - is
 * queued, and the arriving layer takes focus the moment the module resolves, as it did before the
 * module was lazy. Each case loads a fresh Stage, so the module is not already there from a case
 * before it; nothing a case does before `land()` awaits, so until then the fetch has not resolved.
 */
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Path } from "@/depth/model";
import type { StageProps } from "./Stage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Store = typeof import("@/depth/store");
type Model = typeof import("@/depth/model");

let root: Root | null = null;
let host: HTMLElement | null = null;
let stopDepth: () => void = () => {};
let Stage: ComponentType<StageProps>;
let store: Store;
let model: Model;

beforeEach(async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.resetModules();
  store = await import("@/depth/store");
  model = await import("@/depth/model");
  Stage = (await import("./Stage")).default;
  store.useDepth.setState({ ...model.INITIAL });
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

function Wired() {
  const s = store.useDepth();
  return (
    <Stage
      state={{ path: s.path, from: s.from, move: s.move, seq: s.seq }}
      calm={false}
      renderScene={(p) => <p data-scene={model.formatHash(p)}>scene</p>}
      presence={{ pose: "resting", text: "resting", waiting: 0 }}
      onGo={s.go}
      onRise={s.rise}
      onSurface={s.surface}
      onSettle={s.settle}
    />
  );
}

/** Mount the way the console does: the stage first, then the app root's effect starts the store. */
function mountAt(hash: string): HTMLElement {
  window.history.replaceState(null, "", hash);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Wired />));
  act(() => {
    stopDepth = store.startDepth();
  });
  return host;
}

const topLayer = (h: HTMLElement) => [...h.querySelectorAll<HTMLElement>(".stage__scenes > section")].at(-1)!;
const go = (to: Path) => act(() => store.useDepth.getState().go(to));
/** Let the stage's own fetch of `places.ts` resolve: nothing above awaits, so until here it has not. */
const land = () =>
  act(async () => {
    await import("./places");
  });

it("a dive issued before places.ts resolves ends with focus on the new layer", async () => {
  const h = mountAt("#/");
  go({ root: "apps" });
  expect(topLayer(h).getAttribute("data-depth")).toBe("1");
  await land();
  expect(document.activeElement).toBe(topLayer(h));
  expect(topLayer(h).querySelector("[data-scene]")!.getAttribute("data-scene")).toBe("#/apps");
});

it("a reload at a depth focuses the restored layer once places.ts resolves", async () => {
  const h = mountAt("#/mind/engine");
  expect(h.querySelector(".stage")!.getAttribute("data-depth")).toBe("2");
  await land();
  expect(document.activeElement).toBe(topLayer(h));
});

it("of two moves made before places.ts resolves, only the last one's layer takes focus, once", async () => {
  const h = mountAt("#/");
  go({ root: "apps" });
  go({ root: "mind" });
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  await land();
  expect(focus).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(topLayer(h));
  expect(topLayer(h).querySelector("[data-scene]")!.getAttribute("data-scene")).toBe("#/mind");
});

it("guard: once places.ts has landed, a dive focuses the new layer in the move's own commit", async () => {
  const h = mountAt("#/");
  await land();
  go({ root: "apps" });
  expect(document.activeElement).toBe(topLayer(h));
});

it("guard: the stage at the surface, with no move made, takes no focus when places.ts resolves", async () => {
  mountAt("#/");
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  await land();
  expect(focus).not.toHaveBeenCalled();
});
