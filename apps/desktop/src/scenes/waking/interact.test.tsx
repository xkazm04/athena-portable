// @vitest-environment jsdom
/**
 * Tests for what the first act does when touched — README section 3.1 and 3.4, ADR 0085 and 0087.
 *
 * A DOM is needed for these and only these: what the address field opens, and where the keyboard
 * is after the way forward changes under it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The face cards are offered only where WebGL2 can draw; this suite is about the act, not the machine.
vi.mock("@/avatar/support", () => ({ canDrawFace: () => true }));

import type { AvatarId } from "@/avatar/types";
import { INERT_ACTIONS, type SetupModel } from "@/modules/setup/model";

import { fixtures } from "./fixtures";
import WakingView from "./view";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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

function mount(fixture: string, step: 0 | 1 | 2 | 3, avatar?: AvatarId) {
  const openPage = vi.fn();
  const onAvatar = vi.fn();
  const model: SetupModel = { ...fixtures[fixture]!, actions: { ...INERT_ACTIONS, openPage } };
  act(() =>
    root.render(<WakingView model={model} onLater={() => {}} initialStep={step} avatar={avatar} onAvatar={onAvatar} />),
  );
  return { openPage, onAvatar };
}

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const submit = (form: HTMLFormElement) =>
  act(() => void form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

describe("the address field opens what the apps register opens", () => {
  it("a bare host is opened as an address, as the register would open it", () => {
    const { openPage } = mount("no-page", 1);
    const input = host.querySelector<HTMLInputElement>("#waking-url")!;
    type(input, "  mail.example.com ");
    submit(host.querySelector("form")!);
    // Rust's `Url::parse` refuses "mail.example.com" (no scheme), and the refusal was only logged.
    expect(openPage.mock.calls).toEqual([["http://mail.example.com"]]);
  });

  it("an address with its scheme is opened as typed", () => {
    const { openPage } = mount("no-page", 1);
    type(host.querySelector<HTMLInputElement>("#waking-url")!, "https://mail.example.com/inbox");
    submit(host.querySelector("form")!);
    expect(openPage.mock.calls).toEqual([["https://mail.example.com/inbox"]]);
  });

  it("text that names no origin stays in the field and the button says why", () => {
    const { openPage } = mount("no-page", 1);
    const input = host.querySelector<HTMLInputElement>("#waking-url")!;
    for (const typed of ["my invoicing tool", "about:blank"]) {
      type(input, typed);
      submit(host.querySelector("form")!);
      expect(openPage).not.toHaveBeenCalled();
      expect(input.value).toBe(typed);
      expect(host.querySelector('[title="That is not an address an app can live at."]')).not.toBeNull();
    }
  });

  it("an empty field says why Open it waits, rather than a silent disabled button", () => {
    mount("no-page", 1);
    expect(host.querySelector('[title="Type an address first."]')).not.toBeNull();
  });
});

describe("the keyboard keeps its place on the way forward", () => {
  it("Next into a step whose Wake her is not ready lands on Wake her and its reason, not on the page", () => {
    mount("no-page", 2);
    const next = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Next: Face"))!;
    act(() => next.focus());
    act(() => void next.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.textContent).toContain("Wake her");
    expect(document.activeElement).not.toBe(document.body);
    expect(host.querySelector(".waking__foot")!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.getAttribute("title")).toBe("Open a page first — Athena works inside one.");
  });

  it("Next into a step whose Wake her is ready keeps the same button focused", () => {
    mount("ready", 2);
    const next = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Next: Face"))!;
    act(() => next.focus());
    act(() => void next.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(document.activeElement?.textContent).toContain("Wake her");
  });
});

describe("the face step", () => {
  const card = (id: AvatarId) => host.querySelector<HTMLButtonElement>(`[data-avatar-choice="${id}"]`)!;
  // The step is its own chunk (first paint, ADR 0095): let it arrive.
  const arrive = () =>
    act(async () => {
      await import("./face-step");
      await new Promise((r) => setTimeout(r, 0));
    });

  it("choosing a card hands that form to the setting, the halo included", async () => {
    const { onAvatar } = mount("ready", 3);
    await arrive();
    act(() => void card("d08-origami").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => void card("halo").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onAvatar.mock.calls).toEqual([["d08-origami"], ["halo"]]);
  });

  it("is one radio group: one tab stop on the chosen card, and the arrows move the choice", async () => {
    const { onAvatar } = mount("ready", 3, "b04-owl");
    await arrive();
    expect([...host.querySelectorAll('[role="radio"]')].map((r) => r.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    const group = host.querySelector('[role="radiogroup"]')!;
    act(() => void group.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(onAvatar).toHaveBeenLastCalledWith("halo");
    expect(document.activeElement).toBe(card("halo"));
  });

  it("is reached from the steps list, and Voice no longer ends the act", async () => {
    mount("ready", 2);
    expect(host.textContent).toContain("Next: Face");
    const face = [...host.querySelectorAll<HTMLButtonElement>(".waking__step")].find((b) => b.textContent?.includes("Face"))!;
    act(() => void face.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await arrive();
    expect(host.textContent).toContain("How will she appear?");
    expect(host.textContent).toContain("Owl of light");
    expect(host.textContent).toContain("Wake her");
  });
});
