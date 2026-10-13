/**
 * @vitest-environment jsdom
 *
 * The Accounts depth, driven — README sections 3.5 and 4, ADR 0021 and 0062.
 *
 * What a static render cannot prove: that disconnecting takes two presses and Keep it takes
 * nothing, that Enter sends the token and clears it, that the allow-list is a draft until Add and
 * Escape drops it, that hovering a card puts its name at the centre, and that nothing but the
 * vault's own silence removes the records notice. Each action is a spy on the model's own
 * `ConnectorActions`, so "wired" means the right call with the right arguments.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Path } from "@/depth/model";
import type { ConnectorActions, ConnectorsModel } from "@/modules/connectors/model";

import { fixtures } from "./fixtures";
import AccountsView from "./view";

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

function spies(): { [K in keyof ConnectorActions]: ReturnType<typeof vi.fn> } & ConnectorActions {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    probe: vi.fn(),
    setEnabled: vi.fn(),
    setWrites: vi.fn(),
    setAllowlist: vi.fn(),
  } as never;
}

function mount(fixture: string, at: Path, actions = spies(), go: (to: Path) => void = () => {}) {
  // `heavy` has a save in flight on Notion; the row is idle here so its controls can be pressed.
  const source = fixtures[fixture]!;
  const model: ConnectorsModel = { ...source, rows: source.rows.map((r) => ({ ...r, busy: "" })), actions };
  act(() => root.render(<AccountsView model={model} path={at} go={go} />));
  return actions;
}

const item = (id: string): Path => ({ root: "accounts", item: id });
const list = (id: string): Path => ({ root: "accounts", item: id, sub: { kind: "allowlist" } });

const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = (el: Element | undefined) => {
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
const key = (el: Element, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });
const input = () => host.querySelector("input.input") as HTMLInputElement;

describe("disconnect takes two presses", () => {
  it("the first press asks, with the credential's fate named, and calls nothing", () => {
    const a = mount("typical", item("notion"));
    click(button("Disconnect"));
    expect(host.textContent).toContain("Disconnect? The stored credential is destroyed.");
    expect(button("Yes, disconnect")).toBeTruthy();
    expect(button("Keep it")).toBeTruthy();
    expect(a.disconnect).not.toHaveBeenCalled();
  });

  it("Keep it puts the account back as it was, and still calls nothing", () => {
    const a = mount("typical", item("notion"));
    click(button("Disconnect"));
    click(button("Keep it"));
    expect(host.textContent).not.toContain("The stored credential is destroyed");
    expect(button("Disconnect")).toBeTruthy();
    expect(a.disconnect).not.toHaveBeenCalled();
  });

  it("keeps the keyboard where it was: Keep it takes focus when asked, Disconnect again after", () => {
    mount("typical", item("notion"));
    click(button("Disconnect"));
    expect(document.activeElement).toBe(button("Keep it"));
    click(button("Keep it"));
    expect(document.activeElement).toBe(button("Disconnect"));
  });

  it("the second press disconnects that account, once", () => {
    const a = mount("typical", item("notion"));
    click(button("Disconnect"));
    click(button("Yes, disconnect"));
    expect(a.disconnect).toHaveBeenCalledTimes(1);
    expect(a.disconnect).toHaveBeenCalledWith("notion");
  });

  it("holds on an account that needs reconnecting too", () => {
    const a = mount("needs-reauth", item("gmail"));
    click(button("Disconnect"));
    expect(a.disconnect).not.toHaveBeenCalled();
    click(button("Yes, disconnect"));
    expect(a.disconnect).toHaveBeenCalledWith("gmail");
  });
});

describe("connect", () => {
  it("Enter sends the trimmed token once and clears the field", () => {
    const a = mount("empty", item("notion"));
    type(input(), "  ntn_secret  ");
    key(input(), "Enter");
    expect(a.connect).toHaveBeenCalledTimes(1);
    expect(a.connect).toHaveBeenCalledWith("notion", { token: "ntn_secret" });
    expect(input().value).toBe("");
  });

  it("Enter on an empty field sends nothing, and the button says why", () => {
    const a = mount("empty", item("notion"));
    key(input(), "Enter");
    expect(a.connect).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Paste the token first."]')).toBeTruthy();
  });

  it("the OAuth pair is sent as client_id and client_secret, and the secret is cleared", () => {
    const a = mount("empty", item("gmail"));
    const [id, secret] = [...host.querySelectorAll("input.input")] as HTMLInputElement[];
    type(id!, "abc.apps.googleusercontent.com");
    type(secret!, "shh");
    click(button("Connect with Google"));
    expect(a.connect).toHaveBeenCalledWith("gmail", { client_id: "abc.apps.googleusercontent.com", client_secret: "shh" });
    expect(([...host.querySelectorAll("input.input")] as HTMLInputElement[])[1]!.value).toBe("");
  });
});

describe("the switches", () => {
  it("the on and off switch and the writes switch call their own actions", () => {
    const a = mount("typical", item("notion"));
    const radio = (group: string, label: string) =>
      [...host.querySelectorAll(`[aria-label="${group}"] [role="radio"]`)].find((r) => r.textContent === label);
    click(radio("Notion switch", "off"));
    expect(a.setEnabled).toHaveBeenCalledWith("notion", false);
    click(radio("Notion writes", "on"));
    expect(a.setWrites).toHaveBeenCalledWith("notion", true);
  });

  it("Check now probes that account", () => {
    const a = mount("typical", item("notion"));
    click(button("Check now"));
    expect(a.probe).toHaveBeenCalledWith("notion");
  });

  it("the writes switch cannot be pressed while the account is not connected", () => {
    const a = mount("typical", item("gmail"));
    const on = [...host.querySelectorAll('[aria-label="Gmail writes"] [role="radio"]')].find((r) => r.textContent === "on");
    expect((on as HTMLButtonElement).disabled).toBe(true);
    click(on ?? undefined);
    expect(a.setWrites).not.toHaveBeenCalled();
  });
});

describe("the allow-list is a draft until Add", () => {
  it("typing saves nothing, and Add saves the list with the new entry on the end", () => {
    const a = mount("heavy", list("notion"));
    type(input(), "aaaaaaaabbbbbbbbccccccccdddddddd");
    expect(a.setAllowlist).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Not on the list until you press Add. Escape drops what you typed.");
    click(button("Add"));
    expect(a.setAllowlist).toHaveBeenCalledWith("notion", [
      "0123456789abcdef0123456789abcdef",
      "fedcba9876543210fedcba9876543210",
      "11111111222222223333333344444444",
      "aaaaaaaabbbbbbbbccccccccdddddddd",
    ]);
    expect(input().value).toBe("");
  });

  it("Enter adds, several at once when separated by commas, and an entry already there is not doubled", () => {
    const a = mount("heavy", list("notion"));
    type(input(), "x1, x2 ,11111111222222223333333344444444");
    key(input(), "Enter");
    expect((a.setAllowlist.mock.calls[0]![1] as string[]).slice(3)).toEqual(["x1", "x2"]);
  });

  it("Escape drops the draft without saving, and a second Escape lets the field go", () => {
    const a = mount("heavy", list("notion"));
    input().focus();
    type(input(), "half-typed");
    key(input(), "Escape");
    expect(input().value).toBe("");
    expect(a.setAllowlist).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input());
    key(input(), "Escape");
    expect(document.activeElement).not.toBe(input());
  });

  it("Remove saves the list without that entry", () => {
    const a = mount("heavy", list("notion"));
    click(host.querySelector('[aria-label="Remove fedcba9876543210fedcba9876543210"]') ?? undefined);
    expect(a.setAllowlist).toHaveBeenCalledWith("notion", [
      "0123456789abcdef0123456789abcdef",
      "11111111222222223333333344444444",
    ]);
  });

  it("Add is refused with a reason when the draft is empty or already listed", () => {
    mount("heavy", list("notion"));
    expect(host.querySelector('[aria-label="Type something first."]')).toBeTruthy();
    type(input(), "0123456789abcdef0123456789abcdef");
    expect(host.querySelector('[aria-label="That is already on the list."]')).toBeTruthy();
  });

  it("is inert while the account is not connected: no Add, no typing, no Remove", () => {
    const a = mount("typical", list("gmail"));
    expect(input().disabled).toBe(true);
    key(input(), "Enter");
    expect(a.setAllowlist).not.toHaveBeenCalled();
  });

  it("opens from the account and goes back to it", () => {
    const go = vi.fn();
    mount("typical", item("notion"), spies(), go);
    click(button("Edit the page ids"));
    expect(go).toHaveBeenCalledWith({ root: "accounts", item: "notion", sub: { kind: "allowlist" } });
    mount("typical", list("notion"), spies(), go);
    click(button("Back to Notion"));
    expect(go).toHaveBeenLastCalledWith({ root: "accounts", item: "notion" });
  });
});

describe("the field", () => {
  it("puts the name of the card under attention at the centre, and gives the centre back", () => {
    mount("typical", { root: "accounts" });
    const marquee = () => host.querySelector(".accounts__marquee")!.textContent;
    expect(marquee()).toBe("Accounts");
    const gmail = host.querySelector('[data-go="gmail"]') as HTMLButtonElement;
    act(() => gmail.focus());
    expect(marquee()).toBe("Gmail");
    expect(host.querySelector(".accounts__line")!.textContent).toBe("Nothing is stored for Gmail.");
    act(() => gmail.blur());
    expect(marquee()).toBe("Accounts");
  });

  it("opens an account by its card", () => {
    const go = vi.fn();
    mount("typical", { root: "accounts" }, spies(), go);
    click(host.querySelector('[data-go="notion"]') ?? undefined);
    expect(go).toHaveBeenCalledWith({ root: "accounts", item: "notion" });
  });
});

describe("the records notice cannot be waved away", () => {
  it("has no control inside it and survives every press on the page", () => {
    mount("records-unreadable", { root: "accounts" });
    const notice = host.querySelector(".accounts__notice")!;
    expect(notice.querySelectorAll("button, a, [tabindex]")).toHaveLength(0);
    expect(notice.getAttribute("role")).toBe("alert");
    click(host.querySelector('[data-go="notion"]') ?? undefined);
    expect(host.querySelector(".accounts__notice")).toBeTruthy();
  });
});
