/**
 * @vitest-environment jsdom
 *
 * The snapshot the first frame reads follows the settings store, and only the store's answers —
 * README section 3.5, ADR 0165. The store's read seam is faked; everything above it is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));

vi.mock("@/lib/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/store")>()),
  settingRead: vi.fn(async (key: string) => rows.values[key] ?? null),
  storePath: vi.fn(async () => null),
}));

import { APPEARANCE_KEY, bootAppearance } from "@/appearance-boot";
import { followAppearance } from "@/appearance-follow";
import { SETTING_KEYS } from "@/lib/store";
import { readRows, useSettings } from "@/stores/settings";

const stored = () => JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? "null") as unknown;
let stop: () => void = () => {};

beforeEach(() => {
  localStorage.clear();
  rows.values = {};
  document.documentElement.setAttribute("data-theme", "dark");
  useSettings.setState({
    hydrated: false,
    problem: null,
    theme: "system",
    skin: "athena",
    typeScale: "comfortable",
    motion: "system",
  });
});
afterEach(() => stop());

describe("followAppearance", () => {
  it("case 5: a hydrated store is written as the snapshot, and system stays system", () => {
    stop = followAppearance();
    useSettings.setState({ hydrated: true, theme: "light", skin: "loop-tide", typeScale: "large", motion: "calm" });
    expect(stored()).toEqual({ theme: "light", skin: "loop-tide", typeScale: "large", motion: "calm" });
    useSettings.setState({ theme: "system", motion: "system" });
    expect(stored()).toEqual({ theme: "system", skin: "loop-tide", typeScale: "large", motion: "system" });
  });

  it("case 6: before hydration, or after a refused first read, the snapshot is untouched", () => {
    const prior = JSON.stringify({ theme: "light", skin: "loop-tide", typeScale: "large", motion: "calm" });
    localStorage.setItem(APPEARANCE_KEY, prior);
    stop = followAppearance();
    useSettings.setState({ theme: "dark", typeScale: "compact" });
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe(prior);
    useSettings.setState({ hydrated: false, problem: "store_unavailable: database is locked", skin: "athena" });
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe(prior);
  });

  it("case 7: the store stays authority: a stale snapshot paints, then the hydrate corrects screen and snapshot", async () => {
    localStorage.setItem(
      APPEARANCE_KEY,
      JSON.stringify({ theme: "light", skin: "athena", typeScale: "comfortable", motion: "full" }),
    );
    bootAppearance(window);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    stop = followAppearance();
    rows.values = { [SETTING_KEYS.theme]: "dark" };
    await readRows();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(stored()).toMatchObject({ theme: "dark" });
  });
});
