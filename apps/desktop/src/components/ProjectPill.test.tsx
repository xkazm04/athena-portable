// @vitest-environment jsdom
/**
 * The project pill — README section 3.5, ADR 0225. Core, a Project and a held switch each say
 * themselves, the button's name says where she works, the menu switches and goes to the list, and
 * Escape closes the menu without reaching the window behind it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import ProjectPill, { PENDING_WORD, ProjectChip, pillLabel, type ProjectPillProps } from "./ProjectPill";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SPACES = [
  { id: "spc_0123456789ab", name: "Taxes", hue: 200 },
  { id: "spc_ba9876543210", name: "Garden", hue: 120 },
];

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(props: Partial<ProjectPillProps> = {}) {
  const onPick = vi.fn();
  const onAll = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root!.render(<ProjectPill spaces={SPACES} activeId="" pending={null} onPick={onPick} onAll={onAll} {...props} />),
  );
  const button = host.querySelector<HTMLButtonElement>(".project-pill__button")!;
  return { host, button, onPick, onAll };
}

const items = (h: HTMLElement) => [...h.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];

it("says Core for core, with a name that says so", () => {
  const { button } = mount();
  expect(button.textContent).toContain("Core");
  expect(button.getAttribute("aria-label")).toBe("Project: Core");
  expect(button.getAttribute("aria-haspopup")).toBe("menu");
  expect(button.querySelector(".project-dot--core")).not.toBeNull();
});

it("names the active project, drawn in its hue", () => {
  const { button } = mount({ activeId: "spc_0123456789ab" });
  expect(button.textContent).toContain("Taxes");
  expect(button.getAttribute("aria-label")).toBe("Project: Taxes");
  expect(button.querySelector<HTMLElement>(".project-dot")!.style.getPropertyValue("--project-hue")).toBe("200");
});

it("says a held switch lands after this turn", () => {
  const { button } = mount({ activeId: "spc_0123456789ab", pending: "spc_ba9876543210" });
  expect(button.textContent).toContain(PENDING_WORD);
  expect(button.getAttribute("aria-label")).toBe(`Project: Taxes; ${PENDING_WORD} to Garden`);
  expect(pillLabel(SPACES, "spc_0123456789ab", "")).toBe(`Project: Taxes; ${PENDING_WORD} to Core`);
});

it("opens a menu of the projects, core and the list, and switches", () => {
  const { host, button, onPick } = mount({ activeId: "spc_0123456789ab" });
  act(() => button.click());
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(items(host).map((i) => i.textContent)).toEqual(["Taxes", "Garden", "Back to core", "All projects"]);
  // The focus starts on where she is.
  expect(document.activeElement?.textContent).toBe("Taxes");

  act(() => items(host)[1]!.click());
  expect(onPick).toHaveBeenCalledWith("spc_ba9876543210");
  expect(host.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(button);

  act(() => button.click());
  act(() => items(host)[2]!.click());
  expect(onPick).toHaveBeenLastCalledWith("");
});

it("goes to all projects", () => {
  const { host, button, onAll } = mount();
  act(() => button.click());
  act(() => items(host).at(-1)!.click());
  expect(onAll).toHaveBeenCalledOnce();
});

it("offers no list where the window cannot go there", () => {
  const { host, button } = mount({ onAll: undefined });
  act(() => button.click());
  expect(items(host).map((i) => i.textContent)).not.toContain("All projects");
});

it("moves with the arrows, and Escape closes the menu and never reaches the window", () => {
  const { host, button } = mount();
  act(() => button.click());
  const menu = host.querySelector<HTMLElement>('[role="menu"]')!;
  // Core is checked, so it has the focus; down wraps to the list's end, then to the first.
  expect(document.activeElement?.textContent).toBe("Back to core");
  act(() => void menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(document.activeElement?.textContent).toBe("All projects");
  act(() => void menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(document.activeElement?.textContent).toBe("Taxes");

  const windowHeard = vi.fn();
  window.addEventListener("keydown", windowHeard);
  const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => void document.activeElement!.dispatchEvent(esc));
  expect(host.querySelector('[role="menu"]')).toBeNull();
  expect(esc.defaultPrevented).toBe(true);
  expect(windowHeard).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(button);
  window.removeEventListener("keydown", windowHeard);
});

it("draws a chip, inert or as a button", () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const go = vi.fn();
  act(() =>
    root!.render(
      <>
        <ProjectChip space={SPACES[0]!} />
        <ProjectChip space={SPACES[1]!} onClick={go} label="Open the project Garden" />
      </>,
    ),
  );
  expect(host.querySelector("span.project-chip")!.textContent).toBe("Taxes");
  const b = host.querySelector<HTMLButtonElement>('button[aria-label="Open the project Garden"]')!;
  act(() => b.click());
  expect(go).toHaveBeenCalledOnce();
});
