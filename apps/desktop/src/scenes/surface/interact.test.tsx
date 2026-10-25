/**
 * @vitest-environment jsdom
 *
 * The surface's ask row, driven — README section 3.1, ADR 0026, 0087 and 0089.
 *
 * What a static render cannot prove: that the hand-over says it is happening while it does, says
 * it is done when it is, and shows a refusal as an error. The model's `ask` is a promise the test
 * holds in its hand.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fixtures } from "./fixtures";
import SurfaceView from "./view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(ask: (text: string) => Promise<void>) {
  const base = fixtures.typical!;
  act(() => root.render(<SurfaceView model={{ ...base, actions: { ...base.actions, ask } }} />));
}

function type(value: string) {
  const input = host.querySelector<HTMLInputElement>("#surface-ask")!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const submit = () => act(() => host.querySelector("form")!.requestSubmit());
const send = () => host.querySelector<HTMLButtonElement>(".surface__send")!;
const note = () => host.querySelector<HTMLElement>(".surface__ask-note")!;

describe("the ask row", () => {
  it("says it is handing the words over while it does, then that it has", async () => {
    let done!: () => void;
    const ask = vi.fn(() => new Promise<void>((resolve) => (done = resolve)));
    mount(ask);
    type("Check my flights");
    submit();
    expect(ask).toHaveBeenCalledWith("Check my flights");
    expect(send().textContent).toBe("Handing it over…");
    expect(send().disabled).toBe(true);
    expect(note().textContent).toBe("Handing it to her window…");
    await act(async () => done());
    expect(send().textContent).toBe("Hand it to her");
    expect(note().textContent).toContain("Handed to her window");
    expect(note().dataset.tone).toBeUndefined();
  });

  it("says so, as an error, when her window would not come forward for a card that waits", async () => {
    const base = fixtures.asking!;
    const summon = vi.fn(() => Promise.reject(new Error("no window labelled athena")));
    act(() => root.render(<SurfaceView model={{ ...base, actions: { ...base.actions, summon } }} />));
    const open = [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Open her window"))!;
    await act(async () => open.click());
    expect(summon).toHaveBeenCalledOnce();
    expect(note().textContent).toBe("Her window did not come forward: no window labelled athena");
    expect(note().dataset.tone).toBe("error");
  });

  it("toggles her window when her illustration is pressed, and only then", () => {
    const base = fixtures.typical!;
    const toggle = vi.fn();
    const summon = vi.fn(() => Promise.resolve());
    act(() => root.render(<SurfaceView model={{ ...base, actions: { ...base.actions, toggle, summon } }} />));
    const bell = host.querySelector<HTMLButtonElement>("button.surface__bell")!;
    expect(bell.getAttribute("aria-label")).toBe("Show Athena's window");
    act(() => bell.click());
    expect(toggle).toHaveBeenCalledOnce();
    expect(summon).not.toHaveBeenCalled();
    // Rust says she is out on `athena:status`; the model follows, and so does the name.
    act(() => root.render(<SurfaceView model={{ ...base, windowVisible: true, actions: { ...base.actions, toggle, summon } }} />));
    expect(bell.getAttribute("aria-label")).toBe("Put Athena's window away");
    act(() => bell.click());
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it("shows a refusal as an error, and clears it when the person types again", async () => {
    mount(() => Promise.reject(new Error("her window did not answer")));
    type("hello");
    await act(async () => submit());
    expect(note().textContent).toBe("her window did not answer");
    expect(note().dataset.tone).toBe("error");
    type("hello again");
    expect(note().dataset.tone).toBeUndefined();
    expect(note().textContent).toContain("Your words go to her own window");
  });
});

describe("what needs you", () => {
  it("case 5: pressing the Gmail need dives to Gmail once, and so does pressing the Accounts light", () => {
    const base = fixtures.typical!;
    const dive = vi.fn();
    act(() => root.render(<SurfaceView model={{ ...base, actions: { ...base.actions, dive } }} />));
    const need = [...host.querySelectorAll<HTMLButtonElement>("button.surface__need")].find(
      (b) => b.querySelector(".surface__need-label")?.textContent === "Gmail",
    )!;
    act(() => need.click());
    expect(dive).toHaveBeenCalledOnce();
    expect(dive).toHaveBeenLastCalledWith({ root: "accounts", item: "gmail" });
    const light = [...host.querySelectorAll<HTMLButtonElement>("button.surface__light")].find((b) =>
      b.getAttribute("aria-label")?.startsWith("Accounts,"),
    )!;
    act(() => light.click());
    expect(dive).toHaveBeenCalledTimes(2);
    expect(dive).toHaveBeenLastCalledWith({ root: "accounts", item: "gmail" });
  });

  it("case 6: the '+N more' button dives to the first remaining need's depth", () => {
    const base = fixtures["many needs"]!;
    const dive = vi.fn();
    act(() => root.render(<SurfaceView model={{ ...base, actions: { ...base.actions, dive } }} />));
    const more = host.querySelector<HTMLButtonElement>("button.surface__needs-more")!;
    expect(more.textContent).toBe(`+${base.needs.length - 3} more`);
    act(() => more.click());
    expect(dive).toHaveBeenCalledOnce();
    expect(dive).toHaveBeenCalledWith({ root: base.needs[3]!.to.root });
  });
});
