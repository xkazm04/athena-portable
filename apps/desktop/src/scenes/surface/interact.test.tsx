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
