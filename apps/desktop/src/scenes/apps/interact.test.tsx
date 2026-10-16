/**
 * @vitest-environment jsdom
 *
 * The Apps depth, driven — README section 3.4 and 3.5, ADR 0029, 0063 and 0088.
 *
 * What a static render cannot prove: that Forget takes two presses and Keep takes nothing, that
 * Enter registers and clears the field, that the switch writes the origin and the value it names,
 * that opening an app and a page ask for the right thing, and that hovering an app puts its name at
 * the centre. Each action is a spy on the model's own `BrowserActions`, so "wired" means the right
 * call with the right arguments.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Path } from "@/depth/model";
import type { BrowserActions } from "@/modules/browser/model";

import { PATHS, fixtures } from "./fixtures";
import type { AppsModel } from "./model";
import AppsView from "./view";

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

function spies(): { [K in keyof BrowserActions]: ReturnType<typeof vi.fn> } & BrowserActions {
  return {
    open: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    navigate: vi.fn(),
    register: vi.fn(),
    openApp: vi.fn(),
    setEnabled: vi.fn(),
    forget: vi.fn(),
  } as never;
}

function mount(fixture: string, at: Path, go: (to: Path) => void = () => {}) {
  const actions = spies();
  const source = fixtures[fixture]!;
  const model: AppsModel = { ...source, browser: { ...source.browser, actions } };
  act(() => root.render(<AppsView model={model} path={at} go={go} />));
  return actions;
}

const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = (el: Element | null | undefined) => {
  expect(el, "the control exists").toBeTruthy();
  act(() => (el as HTMLElement).click());
};

/** React tracks the value it last set, so a plain `.value =` is swallowed; use the native setter. */
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("forgetting an app takes two presses", () => {
  it("the first press asks, Keep takes it back and forgets nothing", () => {
    const a = mount("typical", PATHS.app!);
    click(button("Forget this app"));
    expect(host.textContent).toContain("It is a first sight again.");
    expect(a.forget).not.toHaveBeenCalled();
    click(button("Keep"));
    expect(host.textContent).not.toContain("Yes, forget");
    expect(a.forget).not.toHaveBeenCalled();
  });

  it("keeps the keyboard where it was: Keep takes focus when asked, the first button again after", () => {
    mount("typical", PATHS.app!);
    click(button("Forget this app"));
    expect(document.activeElement).toBe(button("Keep"));
    click(button("Keep"));
    expect(document.activeElement).toBe(button("Forget this app"));
  });

  it("the second press forgets that origin, and the depth rises out to the field", () => {
    const go = vi.fn();
    const a = mount("typical", PATHS.app!, go);
    click(button("Forget this app"));
    click(button("Yes, forget"));
    expect(a.forget).toHaveBeenCalledExactlyOnceWith("http://localhost:3004");
    expect(go).toHaveBeenCalledWith({ root: "apps" });
  });
});

describe("the switch and Open", () => {
  it("writes the origin and the value the person chose", () => {
    const a = mount("typical", PATHS.app!);
    click([...host.querySelectorAll('[role="radio"]')].find((r) => r.textContent?.trim() === "off"));
    expect(a.setEnabled).toHaveBeenCalledExactlyOnceWith("http://localhost:3004", false);
  });

  it("opens the app by its origin", () => {
    const a = mount("typical", PATHS.app!);
    click(button("Show the page"));
    expect(a.openApp).toHaveBeenCalledExactlyOnceWith("http://localhost:3004");
  });

  it("an app with no tab says Open, and an unregistered page can be registered by its address", () => {
    const crm = mount("typical", { root: "apps", item: "https://crm.example.test" });
    click(button("Open the page"));
    expect(crm.openApp).toHaveBeenCalledExactlyOnceWith("https://crm.example.test");
    const bare = mount("typical", { root: "apps", item: "http://example.test" });
    click(button("Register this app"));
    expect(bare.register).toHaveBeenCalledExactlyOnceWith("http://example.test/blank");
  });

  it("showing an unregistered page focuses its tab and moves to its page", () => {
    const go = vi.fn();
    const a = mount("typical", { root: "apps", item: "http://example.test" }, go);
    click(button("Show the page"));
    expect(a.focus).toHaveBeenCalledExactlyOnceWith(3);
    expect(go).toHaveBeenCalledWith({
      root: "apps",
      item: "http://example.test",
      sub: { kind: "page" },
    });
  });
});

describe("the field", () => {
  it("registers on Enter with a normalised address, and clears the field", () => {
    const a = mount("typical", PATHS.field!);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Address of the app to register"]')!;
    type(input, "invoicing.example.test");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(a.register).toHaveBeenCalledExactlyOnceWith("http://invoicing.example.test");
    expect(input.value).toBe("");
  });

  it("keeps the allow-list's Escape: the first drops the typed address, the next lets the field go", () => {
    // The stage never takes a text field's Escape, and the empty field focuses this box itself, so
    // a box that never lets go leaves Escape unable to rise out of Apps.
    mount("typical", PATHS.field!);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Address of the app to register"]')!;
    act(() => input.focus());
    type(input, "half-typed.example");
    const escape = () =>
      act(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      });
    escape();
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    escape();
    expect(document.activeElement).not.toBe(input);
  });

  it("will not register an empty address, and says why on the button", () => {
    const a = mount("typical", PATHS.field!);
    const press = host.querySelector<HTMLInputElement>('input[aria-label="Address of the app to register"]')!;
    act(() => {
      press.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(a.register).not.toHaveBeenCalled();
    expect(host.querySelector('[title="Type an address first."]')).toBeTruthy();
  });

  it("puts the app under attention at the centre, and takes it away when it is let go", () => {
    mount("typical", PATHS.field!);
    const orb = host.querySelector<HTMLElement>(".apps__orb")!;
    act(() => {
      orb.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      orb.focus();
    });
    expect(host.querySelector(".apps__marquee")?.textContent).toBe("localhost:3004");
    act(() => orb.blur());
    expect(host.querySelector(".apps__marquee")?.textContent).toBe("The apps Athena works in");
  });

  it("opens an app's own level from its orb, and a page from its chip after focusing its tab", () => {
    const go = vi.fn();
    const a = mount("typical", PATHS.field!, go);
    click(host.querySelector(".apps__orb"));
    expect(go).toHaveBeenLastCalledWith({ root: "apps", item: "http://localhost:3004" });
    click(host.querySelector(".apps__chip-main"));
    expect(a.focus).toHaveBeenCalledExactlyOnceWith(1);
    expect(go).toHaveBeenLastCalledWith({
      root: "apps",
      item: "http://localhost:3004",
      sub: { kind: "page" },
    });
    click(host.querySelector(".apps__chip-close"));
    expect(a.close).toHaveBeenCalledExactlyOnceWith(1);
  });
});
