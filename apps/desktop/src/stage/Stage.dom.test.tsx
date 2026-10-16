// @vitest-environment jsdom
/**
 * The stage wired to the depth store, in a DOM — README section 3.1 and 3.5, ADR 0087.
 *
 * `Stage.test.tsx` renders the view from a state it is handed; this file mounts it the way the
 * console does (the stage first, then the app root's effect starts the store), so the order the
 * real window runs in is the order under test.
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { INITIAL, formatHash, type Path } from "@/depth/model";
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

it("redraws no scene when only the chrome changes (her presence, the bar's controls)", () => {
  const draw = vi.fn();
  function Scene() {
    draw();
    return <p>scene</p>;
  }
  const renderScene = () => <Scene />;
  const props = (text: string) => ({
    state: { ...INITIAL, path: { root: "mind" as const } },
    calm: false,
    renderScene,
    presence: { pose: "resting" as const, text, waiting: 0 },
    onGo: () => {},
    onRise: () => {},
    onSurface: () => {},
    onSettle: () => {},
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Stage {...props("resting")} />));
  expect(draw).toHaveBeenCalledTimes(1);
  act(() => root!.render(<Stage {...props("reading the page")} />));
  act(() => root!.render(<Stage {...props("resting")} />));
  expect(draw).toHaveBeenCalledTimes(1);
});

it("redraws the scene when the way it is drawn changes", () => {
  const seen: string[] = [];
  const props = (tag: string) => ({
    state: { ...INITIAL, path: { root: "mind" as const } },
    calm: false,
    renderScene: () => {
      seen.push(tag);
      return <p>{tag}</p>;
    },
    presence: { pose: "resting" as const, text: "resting", waiting: 0 },
    onGo: () => {},
    onRise: () => {},
    onSurface: () => {},
    onSettle: () => {},
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Stage {...props("before")} />));
  act(() => root!.render(<Stage {...props("hydrated")} />));
  expect(seen).toEqual(["before", "hydrated"]);
  expect(host.querySelector(".stage__layer")!.textContent).toBe("hydrated");
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

/**
 * A scene that claims Escape for itself (a chore's topic closes its lightbox, the studio asks before
 * dropping a draft) listens on the document, as `scenes/chores/topic.tsx` does, and marks the key
 * taken. It is mounted by a dive, so after the stage has started listening.
 */
function ClaimsEscape({ onClaim }: { onClaim: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClaim();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClaim]);
  return <p>topic</p>;
}

it("leaves Escape to a scene that claims it, though the scene started listening after the stage", () => {
  const onRise = vi.fn();
  const onClaim = vi.fn();
  const props = (path: Path, seq: number) => ({
    state: { ...INITIAL, path, seq, move: seq === 0 ? ("none" as const) : ("down" as const) },
    calm: true,
    renderScene: (p: Path) => (p.root === "chores" ? <ClaimsEscape onClaim={onClaim} /> : <p>surface</p>),
    presence: { pose: "resting" as const, text: "resting", waiting: 0 },
    onGo: () => {},
    onRise,
    onSurface: () => {},
    onSettle: () => {},
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Stage {...props({ root: null }, 0)} />)); // the stage, listening
  act(() => root!.render(<Stage {...props({ root: "chores", item: "carrier-refunds" }, 1)} />)); // the dive
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  expect(onClaim).toHaveBeenCalledTimes(1);
  expect(onRise).not.toHaveBeenCalled();
});

it("still rises on an Escape no scene claimed", () => {
  const onRise = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Stage
        state={{ ...INITIAL, path: { root: "mind" } }}
        calm
        renderScene={() => <p>mind</p>}
        presence={{ pose: "resting", text: "resting", waiting: 0 }}
        onGo={() => {}}
        onRise={onRise}
        onSurface={() => {}}
        onSettle={() => {}}
      />,
    ),
  );
  const press = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    document.body.dispatchEvent(press);
  });
  expect(onRise).toHaveBeenCalledTimes(1);
  expect(press.defaultPrevented).toBe(true);
});
