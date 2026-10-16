// @vitest-environment jsdom
/**
 * The title bar's close confirm — README section 3.1 and 3.5, ADR 0026 (closing Main closes both
 * windows, and says so). A confirm that takes focus owes it back when it goes away.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const win = vi.hoisted(() => ({ close: vi.fn(), minimize: vi.fn(), toggleMaximize: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => win }));
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  hasShell: () => true,
}));

import WindowControls from "./WindowControls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.clearAllMocks();
});

function mount(waiting: boolean): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<WindowControls waiting={waiting} />));
  return host;
}

const closeButton = (h: HTMLElement) => h.querySelector<HTMLButtonElement>('[aria-label="Close Athena"]');
const byText = (h: HTMLElement, text: string) =>
  [...h.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text);

it("asks first when a decision waits, and hands focus to Keep", () => {
  const h = mount(true);
  act(() => closeButton(h)!.click());
  expect(win.close).not.toHaveBeenCalled();
  expect(h.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(document.activeElement).toBe(byText(h, "Keep"));
});

it("gives focus back to the close button when Keep is pressed", () => {
  const h = mount(true);
  act(() => closeButton(h)!.click());
  act(() => byText(h, "Keep")!.click());
  expect(h.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.activeElement).toBe(closeButton(h));
});

it("gives focus back to the close button when Escape dismisses the confirm", () => {
  const h = mount(true);
  act(() => closeButton(h)!.click());
  act(() => {
    byText(h, "Keep")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  expect(h.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.activeElement).toBe(closeButton(h));
});

it("is described by its question, so a screen reader says why it asks and not only Keep", () => {
  const h = mount(true);
  act(() => closeButton(h)!.click());
  const dialog = h.querySelector('[role="alertdialog"]')!;
  const id = dialog.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  expect(document.getElementById(id!)?.textContent).toBe("A decision is waiting. Close anyway?");
});

it("leaves focus alone on a first render, when nothing was confirmed", () => {
  const before = document.activeElement;
  mount(true);
  expect(document.activeElement).toBe(before);
});

it("closes at once when nothing waits", () => {
  const h = mount(false);
  act(() => closeButton(h)!.click());
  expect(win.close).toHaveBeenCalledTimes(1);
});
