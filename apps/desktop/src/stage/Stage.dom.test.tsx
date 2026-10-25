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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

it("settles a move that plays no animation (a hidden window) after the safety window, and says so", () => {
  vi.useFakeTimers();
  try {
    const onSettle = vi.fn();
    const at = (path: Path, seq: number) => (
      <Stage
        state={{ path, from: seq === 0 ? null : { root: null }, move: seq === 0 ? "none" : "down", seq }}
        calm={false}
        renderScene={(p) => <p data-scene={formatHash(p)}>scene</p>}
        presence={{ pose: "resting", text: "resting", waiting: 0 }}
        onGo={() => {}}
        onRise={() => {}}
        onSurface={() => {}}
        onSettle={onSettle}
      />
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(at({ root: null }, 0)));
    act(() => root!.render(at({ root: "apps" }, 1)));
    // jsdom fires no animationend: both layers are on screen, the old one leaving.
    expect(host.querySelectorAll(".stage__layer")).toHaveLength(2);
    expect(onSettle).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(899));
    expect(host.querySelectorAll(".stage__layer")).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    expect(scenes(host)).toEqual(["#/apps"]);
    expect(host.querySelector(".stage__layer")!.getAttribute("data-phase")).toBe("rest");
    expect(onSettle).toHaveBeenCalledWith(1);
  } finally {
    vi.useRealTimers();
  }
});

it("mounts a crumb afresh when the place it names changes, so it fades in on the move like a dived one", () => {
  const at = (path: Path, seq: number) => (
    <Stage
      state={{ ...INITIAL, path, seq, move: seq === 0 ? "none" : "across" }}
      calm={false}
      renderScene={() => <p>scene</p>}
      presence={{ pose: "resting", text: "resting", waiting: 0 }}
      onGo={() => {}}
      onRise={() => {}}
      onSurface={() => {}}
      onSettle={() => {}}
    />
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const crumbAt = (i: number) => host!.querySelectorAll(".stage__crumb")[i]!;
  act(() => root!.render(at({ root: "apps", item: "host-1" }, 0)));
  const apps = crumbAt(0);
  const host1 = crumbAt(1);
  // Across, one level down: the Apps crumb names the same place and stays; host-2 is a new place.
  act(() => root!.render(at({ root: "apps", item: "host-2" }, 1)));
  expect(crumbAt(0)).toBe(apps);
  expect(crumbAt(1)).not.toBe(host1);
  expect(crumbAt(1).textContent).toBe("/host-2");
  // Across at the first level: Apps to Chores is a new place too.
  act(() => root!.render(at({ root: "chores" }, 2)));
  expect(crumbAt(0)).not.toBe(apps);
  expect(crumbAt(0).textContent).toBe("/Chores");
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

/**
 * A leaving layer is a still, not a live scene (ADR 0193). Each scene here says when it is live (its
 * effect ran and has not been cleaned up), so the count of live scenes is read directly.
 */
describe("one live scene at any moment", () => {
  const live = new Set<string>();
  const cleaned: string[] = [];
  const heard: string[] = [];

  beforeEach(() => {
    live.clear();
    cleaned.length = 0;
    heard.length = 0;
  });

  function Counted({ name }: { name: string }) {
    useEffect(() => {
      live.add(name);
      // A document listener with no inert guard: a leaving copy that still ran would hear the key.
      const onKey = () => heard.push(name);
      document.addEventListener("keydown", onKey);
      return () => {
        live.delete(name);
        cleaned.push(name);
        document.removeEventListener("keydown", onKey);
      };
    }, [name]);
    return (
      <div data-scene={name}>
        <h2>scene {name}</h2>
        <canvas data-wave="" width={8} height={8} />
      </div>
    );
  }

  function Counting({ calm = false }: { calm?: boolean }) {
    const s = useDepth();
    return (
      <Stage
        state={{ path: s.path, from: s.from, move: s.move, seq: s.seq }}
        calm={calm}
        renderScene={(p) => <Counted name={formatHash(p)} />}
        presence={{ pose: "resting", text: "resting", waiting: 0 }}
        onGo={s.go}
        onRise={s.rise}
        onSurface={s.surface}
        onSettle={s.settle}
      />
    );
  }

  async function mountCounting(calm = false): Promise<HTMLElement> {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(<Counting calm={calm} />));
    act(() => {
      stopDepth = startDepth();
    });
    // The still is not first-frame code: the stage fetches it once drawn. Let that land.
    await act(async () => {
      await import("./places"); // the still comes with the stage's memory of places
    });
    return host;
  }

  const go = (to: Path) => act(() => useDepth.getState().go(to));
  const leavingOf = (h: HTMLElement) => [...h.querySelectorAll<HTMLElement>(".stage__scenes > section[data-phase^='leave-']")];

  it("a move unmounts the left scene at once: its cleanup has run and one scene is mounted, before any animationend", async () => {
    const h = await mountCounting();
    expect([...live]).toEqual(["#/"]);
    go({ root: "apps" });
    expect(h.querySelectorAll(".stage__layer")).toHaveLength(2);
    expect(cleaned).toEqual(["#/"]);
    expect([...live]).toEqual(["#/apps"]);
  });

  it("the leaving layer holds a static copy of the left scene until its animationend, then it is gone", async () => {
    const h = await mountCounting();
    go({ root: "apps" });
    const [leaving] = leavingOf(h);
    expect(leaving).toBeDefined();
    expect(leaving!.hasAttribute("data-still")).toBe(true);
    expect(leaving!.querySelector("h2")!.textContent).toBe("scene #/");
    expect(leaving!.querySelector("[data-scene='#/'] canvas")).not.toBeNull();
    expect([...live]).toEqual(["#/apps"]); // the copy is not a mounted scene
    act(() => {
      leaving!.dispatchEvent(new Event("animationend", { bubbles: true }));
    });
    expect(leavingOf(h)).toHaveLength(0);
    expect(h.querySelector("[data-still]")).toBeNull();
    expect(scenes(h)).toEqual(["#/apps"]);
  });

  it("a key pressed after a move reaches only the arriving scene's document listener, never the leaving one", async () => {
    await mountCounting();
    go({ root: "apps" });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    });
    expect(heard).toEqual(["#/apps"]);
  });

  it("moves during moves keep at most one live scene and at most two stills plus the arriving layer", async () => {
    const h = await mountCounting();
    for (const to of [{ root: "apps" }, { root: "mind" }, { root: "chores" }, { root: "voice" }] as Path[]) {
      go(to);
      expect(live.size).toBe(1);
      expect([...live]).toEqual([formatHash(to)]);
      expect(h.querySelectorAll(".stage__scenes > section[data-still]").length).toBeLessThanOrEqual(2);
      expect(h.querySelectorAll(".stage__scenes > section").length).toBeLessThanOrEqual(3);
    }
    // Every still is one of the places left, never a live copy.
    for (const s of h.querySelectorAll(".stage__scenes > section[data-still]")) expect(s.getAttribute("data-phase")).toMatch(/^leave-/);
  });

  it("a left scene's canvas is drawn into its still, so a waveform or a sky does not blank in the leave", async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      return this.hasAttribute("data-wave") ? ({ drawImage } as unknown as CanvasRenderingContext2D) : null;
    } as typeof HTMLCanvasElement.prototype.getContext);
    const h = await mountCounting();
    const source = h.querySelector("[data-scene='#/'] canvas")!;
    go({ root: "apps" });
    const copy = leavingOf(h)[0]!.querySelector("canvas")!;
    expect(copy).not.toBe(source);
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0);
  });

  it("guard: under calm a move is one layer at rest, the new scene live, and no still is taken", async () => {
    const h = await mountCounting(true);
    go({ root: "apps" });
    expect(h.querySelectorAll(".stage__layer")).toHaveLength(1);
    expect(h.querySelector(".stage__layer")!.getAttribute("data-phase")).toBe("rest");
    expect(h.querySelector("[data-still]")).toBeNull();
    expect([...live]).toEqual(["#/apps"]);
  });
});

/**
 * Rise lands where you left (`places.ts`): an up move restores the place's scroll and the element
 * you left it from; a dive and an across move start fresh, as they always did.
 */
describe("rise lands where you left", () => {
  /** How tall each scroller's content is: jsdom lays nothing out, so a scene says it with data-h. */
  let heights: Map<string, number>;
  let observed: (() => void)[] = [];
  let showItem5 = true;

  beforeEach(() => {
    heights = new Map();
    observed = [];
    showItem5 = true;
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        const at = this.getAttribute("data-scroller");
        return at === null ? 0 : (heights.get(at) ?? 2000);
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute("data-scroller") ? 300 : 0;
      },
    });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });

  /** A ResizeObserver that fires when the test says the content grew. */
  function stubResizeObserver() {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      constructor(private readonly cb: () => void) {
        observed.push(() => this.cb());
      }
      observe() {}
      disconnect() {
        observed = observed.filter(() => false);
      }
    };
  }

  function Scene({ path }: { path: Path }) {
    const at = formatHash(path);
    const items = [...Array(10).keys()].filter((i) => i !== 5 || showItem5);
    return (
      <div data-scroller={at} style={{ overflow: "auto" }}>
        <h2>{at}</h2>
        {path.item === undefined &&
          items.map((i) => (
            <button key={i} type="button" onClick={() => useDepth.getState().go({ root: path.root!, item: `item-${i}` })}>
              item-{i}
            </button>
          ))}
      </div>
    );
  }

  function Wiring({ calm = false }: { calm?: boolean }) {
    const s = useDepth();
    return (
      <Stage
        state={{ path: s.path, from: s.from, move: s.move, seq: s.seq }}
        calm={calm}
        renderScene={(p) => <Scene path={p} />}
        presence={{ pose: "resting", text: "resting", waiting: 0 }}
        onGo={s.go}
        onRise={s.rise}
        onSurface={s.surface}
        onSettle={s.settle}
      />
    );
  }

  async function mountAt(hash: string, calm = false): Promise<HTMLElement> {
    window.history.replaceState(null, "", hash);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(<Wiring calm={calm} />));
    act(() => {
      stopDepth = startDepth();
    });
    await act(async () => {
      await import("./places");
    });
    return host;
  }

  const topLayer = (h: HTMLElement) => [...h.querySelectorAll<HTMLElement>(".stage__scenes > section")].at(-1)!;
  const scrollerOf = (h: HTMLElement) => topLayer(h).querySelector<HTMLElement>("[data-scroller]")!;
  const button = (h: HTMLElement, text: string) =>
    [...topLayer(h).querySelectorAll("button")].find((b) => b.textContent === text)!;
  const go = (to: Path) => act(() => useDepth.getState().go(to));
  const escape = () =>
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
  /** Scroll the top layer's scroller to 400, focus item-5 and press it: the dive. */
  function diveFromItem5(h: HTMLElement) {
    scrollerOf(h).scrollTop = 400;
    const b = button(h, "item-5");
    b.focus();
    act(() => b.click());
    expect(formatHash(useDepth.getState().path)).toBe("#/apps/item-5");
  }

  it("a scroller scrolled to 400 is back at 400 once the arriving layer is drawn after a rise", async () => {
    const h = await mountAt("#/apps");
    scrollerOf(h).scrollTop = 400;
    go({ root: "apps", item: "item-2" });
    act(() => useDepth.getState().rise());
    expect(formatHash(useDepth.getState().path)).toBe("#/apps");
    expect(scrollerOf(h).getAttribute("data-scroller")).toBe("#/apps");
    expect(scrollerOf(h).scrollTop).toBe(400);
  });

  it("Escape after diving from item-5 puts focus back on the re-rendered item-5 button, not the layer", async () => {
    const h = await mountAt("#/apps");
    diveFromItem5(h);
    escape();
    expect(formatHash(useDepth.getState().path)).toBe("#/apps");
    const again = button(h, "item-5");
    expect(document.activeElement).toBe(again);
    expect(again.isConnected).toBe(true);
    expect(topLayer(h).contains(again)).toBe(true);
  });

  it("a returning scene that draws short is scrolled once it grows, and a wheel first abandons the restore", async () => {
    stubResizeObserver();
    const h = await mountAt("#/apps");
    diveFromItem5(h);
    heights.set("#/apps", 200); // the scene's data has not landed: nothing to scroll yet
    escape();
    expect(scrollerOf(h).scrollTop).toBe(0);
    heights.set("#/apps", 2000);
    act(() => observed.forEach((fire) => fire()));
    expect(scrollerOf(h).scrollTop).toBe(400);

    // Again, but the person scrolls before the content lands: the restore is theirs to lose.
    diveFromItem5(h);
    heights.set("#/apps", 200);
    escape();
    act(() => {
      window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    });
    heights.set("#/apps", 2000);
    act(() => observed.forEach((fire) => fire()));
    expect(scrollerOf(h).scrollTop).toBe(0);
  });

  it("when the remembered row is gone on return, focus falls back to the layer and nothing throws", async () => {
    const h = await mountAt("#/apps");
    diveFromItem5(h);
    showItem5 = false;
    expect(() => escape()).not.toThrow();
    expect(formatHash(useDepth.getState().path)).toBe("#/apps");
    expect(scrollerOf(h).scrollTop).toBe(400); // the place came back; only the row did not
    expect(document.activeElement).toBe(topLayer(h));
  });

  it("under calm, where a move replaces the layer and plays no still, a rise lands where you left too", async () => {
    const h = await mountAt("#/apps", true);
    diveFromItem5(h);
    escape();
    expect(scrollerOf(h).scrollTop).toBe(400);
    expect(document.activeElement).toBe(button(h, "item-5"));
  });

  it("guard: a dive to a place recorded earlier starts at the top with focus on the layer", async () => {
    const h = await mountAt("#/apps");
    diveFromItem5(h); // #/apps is recorded at 400 with item-5
    act(() => useDepth.getState().surface());
    go({ root: "apps" }); // down, from the surface
    expect(scrollerOf(h).scrollTop).toBe(0);
    expect(document.activeElement).toBe(topLayer(h));
  });

  it("guard: an across move through a dock root focuses the arriving layer", async () => {
    const h = await mountAt("#/apps");
    scrollerOf(h).scrollTop = 400;
    button(h, "item-5").focus();
    go({ root: "mind" });
    go({ root: "apps" });
    expect(scrollerOf(h).scrollTop).toBe(0);
    expect(document.activeElement).toBe(topLayer(h));
  });

  it("guard: the page shape records nothing and calls no focus", async () => {
    const { places } = await import("./places");
    const h = await mountAt("#/apps/host-1");
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    go({ root: "apps", item: "host-1", sub: { kind: "page" } });
    expect(h.querySelector(".stage")!.getAttribute("data-shape")).toBe("page");
    expect(focus).not.toHaveBeenCalled();
    go({ root: "apps", item: "host-2", sub: { kind: "page" } });
    expect(places.keys()).not.toContain("#/apps/host-1/page");
    expect(focus).not.toHaveBeenCalled();
  });
});
