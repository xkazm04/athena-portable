// @vitest-environment jsdom
/**
 * The stage follows the OS's reduced-motion preference live — README section 3.1, ADR 0089.
 * With the motion setting on `system`, a change of the OS preference after Console has rendered
 * must reach the Stage's `calm` prop with no other state change.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ calm: [] as boolean[] }));

vi.mock("@/stage/Stage", () => ({
  escapeRises: () => false,
  default: (p: { calm: boolean }) => {
    seen.calm.push(p.calm);
    return null;
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const os = { reduced: false, listeners: [] as (() => void)[] };
vi.stubGlobal("matchMedia", (q: string) => ({
  media: q,
  get matches() {
    return q.includes("reduce") ? os.reduced : false;
  },
  addEventListener: (_: string, f: () => void) => {
    if (q.includes("reduce")) os.listeners.push(f);
  },
  removeEventListener: () => {},
}));
window.matchMedia = globalThis.matchMedia;

const { default: Console } = await import("./Console");
const { startSettings, useSettings } = await import("@/stores/settings");

let root: Root | null = null;
afterEach(() => act(() => root?.unmount()));

describe("Console's calm prop", () => {
  it("flips when the OS asks for reduced motion, with the setting on system", async () => {
    await startSettings();
    expect(useSettings.getState().motion).toBe("system");
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(<Console />));
    expect(seen.calm.at(-1)).toBe(false);

    os.reduced = true;
    act(() => os.listeners.forEach((f) => f()));
    expect(document.documentElement.getAttribute("data-motion")).toBe("calm");
    expect(seen.calm.at(-1)).toBe(true);

    os.reduced = false;
    act(() => os.listeners.forEach((f) => f()));
    expect(seen.calm.at(-1)).toBe(false);
  });
});
