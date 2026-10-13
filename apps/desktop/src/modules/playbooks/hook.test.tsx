// @vitest-environment jsdom
/**
 * `usePlaybooksModel` — README section 3.5, ADR 0088 and 0090. The module bar's Playbooks opens a
 * portal by selecting the Browser and making a tab; a console scene must make the tab and not
 * select the Browser (a Rust `browser` selection shows a page under a scene), then tell the scene.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaybooksModel } from "./model";

const tabsCreate = vi.fn<(url: string) => Promise<number>>();
const select = vi.fn<(id: string) => Promise<void>>();

vi.mock("@/lib/ipc", () => ({ tabsCreate: (url: string) => tabsCreate(url) }));
vi.mock("@/stores/shell", () => ({ useShell: { getState: () => ({ select: (id: string) => select(id) }) } }));
vi.mock("@/lib/companion", () => ({ athenaOffer: vi.fn(async () => {}) }));

const { usePlaybooksModel } = await import("./index");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function modelWith(options?: { afterOpen?: (url: string) => void }): PlaybooksModel {
  let got: PlaybooksModel | null = null;
  function Probe() {
    got = usePlaybooksModel(options);
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Probe />));
  act(() => root.unmount());
  return got!;
}

beforeEach(() => {
  tabsCreate.mockReset().mockResolvedValue(7);
  select.mockReset().mockResolvedValue();
});

describe("opening a portal", () => {
  it("selects the Browser and then makes the tab, as the module bar's Playbooks always did", async () => {
    modelWith().actions.open("https://example.com/a");
    await vi.waitFor(() => expect(tabsCreate).toHaveBeenCalledWith("https://example.com/a"));
    expect(select).toHaveBeenCalledWith("browser");
    expect(select.mock.invocationCallOrder[0]!).toBeLessThan(tabsCreate.mock.invocationCallOrder[0]!);
  });

  it("with afterOpen makes the tab, selects nothing, and tells the scene after the tab exists", async () => {
    const afterOpen = vi.fn();
    modelWith({ afterOpen }).actions.open("https://example.com/b");
    await vi.waitFor(() => expect(afterOpen).toHaveBeenCalledWith("https://example.com/b"));
    expect(tabsCreate).toHaveBeenCalledWith("https://example.com/b");
    expect(select).not.toHaveBeenCalled();
  });

  it("does not tell the scene when the tab could not be made, and logs it", async () => {
    const afterOpen = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    tabsCreate.mockRejectedValue(new Error("no shell"));
    modelWith({ afterOpen }).actions.open("https://example.com/c");
    await vi.waitFor(() => expect(log).toHaveBeenCalled());
    expect(afterOpen).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("is the same model the module's view uses: the shipped chores, the verdicts, the totals", () => {
    const m = modelWith();
    expect(m.items.length).toBe(m.totals.count);
    expect(m.items.length).toBeGreaterThan(0);
  });
});
