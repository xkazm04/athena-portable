// @vitest-environment jsdom
/**
 * `usePlaybooksModel` — README section 3.5, ADR 0088 and 0090. Opening a portal makes the tab and
 * selects no module (a Rust `browser` selection shows a page under a scene), then tells the scene,
 * which decides where the person goes.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PLAYBOOKS } from "@/lib/playbooks.shipped";
import { usePlaybooks } from "@/stores/playbooks";

import type { PlaybooksModel } from "./model";

const tabsCreate = vi.fn<(url: string) => Promise<number>>();

vi.mock("@/lib/ipc", () => ({ tabsCreate: (url: string) => tabsCreate(url) }));
vi.mock("@/lib/companion", () => ({ athenaOffer: vi.fn(async () => {}) }));

const { usePlaybooksModel } = await import("./index");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function modelWith(afterOpen: (url: string) => void = () => {}): PlaybooksModel {
  let got: PlaybooksModel | null = null;
  function Probe() {
    got = usePlaybooksModel(afterOpen);
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
});

describe("opening a portal", () => {
  it("makes the tab and tells the scene after the tab exists", async () => {
    const afterOpen = vi.fn();
    modelWith(afterOpen).actions.open("https://example.com/b");
    await vi.waitFor(() => expect(afterOpen).toHaveBeenCalledWith("https://example.com/b"));
    expect(tabsCreate).toHaveBeenCalledWith("https://example.com/b");
  });

  it("does not tell the scene when the tab could not be made, and logs it", async () => {
    const afterOpen = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    tabsCreate.mockRejectedValue(new Error("no shell"));
    modelWith(afterOpen).actions.open("https://example.com/c");
    await vi.waitFor(() => expect(log).toHaveBeenCalled());
    expect(afterOpen).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("says it is loading while the shipped set has not arrived, and is not an empty build", () => {
    usePlaybooks.setState({ items: null });
    const m = modelWith();
    expect(m.loading).toBe(true);
    expect(m.items).toEqual([]);
  });

  it("is the same model the module's view uses once the set is here: the verdicts and the totals", () => {
    usePlaybooks.setState({ items: PLAYBOOKS });
    const m = modelWith();
    expect(m.loading).toBe(false);
    expect(m.items.length).toBe(m.totals.count);
    expect(m.items.length).toBeGreaterThan(0);
  });
});
