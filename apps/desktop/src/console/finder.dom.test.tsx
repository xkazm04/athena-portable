// @vitest-environment jsdom
/**
 * Go anywhere by name — README section 3.5, ADR 0087.
 *
 * The console's summon (its key rule and its trailing-slot control) mounted as the console mounts
 * it, the finder fetched as the lazy chunk it is, and the stores it reads filled the way the
 * window roots fill them. Everything above the stores is the real code.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SURFACE, type Path } from "@/depth/model";
import { escapeRises } from "@/stage/Stage";
import { useConnectors } from "@/stores/connectors";
import { usePlaybooks } from "@/stores/playbooks";
import { useSpaces } from "@/stores/spaces";

import { Summon, opensFinder } from "./Console";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  usePlaybooks.setState({ items: [{ id: "invoice-chase", shortTitle: "Invoice chase" }] as never });
  useConnectors.setState({ items: [{ id: "gh", label: "GitHub" }] as never });
  useSpaces.setState({ spaces: [{ id: "spc_0123456789ab", name: "Renovation", hue: 30 }] as never });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

function mount(go: (to: Path) => void, here: Path = SURFACE): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Summon go={go} here={here} />));
  return host;
}

const key = (target: EventTarget, init: KeyboardEventInit) => {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

/** The finder's field, once its lazy chunk has arrived. */
async function field(h: HTMLElement): Promise<HTMLInputElement> {
  for (let i = 0; i < 300; i++) {
    const input = h.ownerDocument.querySelector<HTMLInputElement>(".finder input");
    if (input) return input;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  throw new Error("the finder never opened");
}

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("opensFinder", () => {
  it("opens on Ctrl+K even while typing, and on '/' only outside a field", () => {
    expect(opensFinder({ key: "k", ctrlKey: true, metaKey: false, altKey: false }, true)).toBe(true);
    expect(opensFinder({ key: "/", ctrlKey: false, metaKey: false, altKey: false }, false)).toBe(true);
    expect(opensFinder({ key: "/", ctrlKey: false, metaKey: false, altKey: false }, true)).toBe(false);
  });
});

describe("the finder, summoned", () => {
  it("summon, type 'inv', Enter: one move to the chore, and the finder closes", async () => {
    const go = vi.fn();
    const h = mount(go);
    act(() => void key(document.body, { key: "k", ctrlKey: true }));
    const input = await field(h);
    expect(document.activeElement).toBe(input);
    type(input, "inv");
    act(() => void key(input, { key: "Enter" }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ root: "chores", item: "invoice-chase" });
    expect(document.querySelector(".finder")).toBeNull();
  });

  it("finds a project by its name, and core as Core (ADR 0225)", async () => {
    const go = vi.fn();
    const h = mount(go);
    act(() => void key(document.body, { key: "k", ctrlKey: true }));
    const input = await field(h);
    type(input, "renov");
    expect(document.querySelector(".finder__list")?.textContent).toContain("Projects / Renovation");
    act(() => void key(input, { key: "Enter" }));
    expect(go).toHaveBeenCalledWith({ root: "projects", item: "spc_0123456789ab" });
    act(() => void key(document.body, { key: "k", ctrlKey: true }));
    const again = await field(h);
    type(again, "core");
    act(() => void key(again, { key: "Enter" }));
    expect(go).toHaveBeenLastCalledWith({ root: "projects", item: "core" });
  });

  it("Escape inside the finder closes it, moves nowhere, and keeps the key from the stage", async () => {
    const go = vi.fn();
    const h = mount(go, { root: "mind", item: "engine" });
    act(() => void key(document.body, { key: "/" }));
    const input = await field(h);
    let e!: KeyboardEvent;
    act(() => {
      e = key(input, { key: "Escape" });
    });
    expect(e.defaultPrevented).toBe(true);
    expect(go).not.toHaveBeenCalled();
    expect(document.querySelector(".finder")).toBeNull();
  });

  it("guard: with the finder closed, Escape still rises one level", () => {
    const go = vi.fn();
    mount(go, { root: "mind", item: "engine" });
    const e = key(document.body, { key: "Escape" });
    expect(e.defaultPrevented).toBe(false);
    expect(escapeRises({ key: "Escape", defaultPrevented: e.defaultPrevented, targetIsTyping: false })).toBe(true);
    expect(document.querySelector(".finder")).toBeNull();
  });
});
