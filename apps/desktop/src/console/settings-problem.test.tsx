/**
 * @vitest-environment jsdom
 *
 * A refused settings read is a designed state, not a blank window — README section 3.5.
 *
 * The store's read seam is faked to refuse, then to answer. Before any read goes through, the
 * surface is the refusal in the store's words with a retry; the retry that reads the rows brings
 * the first act (or her surface) back. Everything above the seam is the real code.
 */
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({ refuse: true }));

vi.mock("@/lib/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/store")>()),
  settingRead: vi.fn(async () => {
    if (seams.refuse) throw new Error("store_unavailable: database is locked");
    return null;
  }),
  storePath: vi.fn(async () => null),
}));

import { Live as Waking } from "@/scenes/waking/live";
import { readRows, useSettings } from "@/stores/settings";

import { sceneFor } from "./scenes";

const noGo = () => {};
const surfaceOf = (retry: () => void) => {
  const { hydrated, onboarded, problem } = useSettings.getState();
  return sceneFor({ root: null }, { hydrated, onboarded, reopened: false, go: noGo, problem, retry });
};

beforeEach(() => {
  seams.refuse = true;
  useSettings.setState({ hydrated: false, problem: null, onboarded: false });
});

describe("a settings read that is refused", () => {
  it("keeps the settings unread and shows why, with a retry, where the surface would be", async () => {
    await readRows();
    expect(useSettings.getState().hydrated).toBe(false);
    expect(useSettings.getState().problem).toBe("store_unavailable: database is locked");
    const html = renderToStaticMarkup(<>{surfaceOf(noGo)}</>);
    expect(html).toContain("Athena could not read her settings");
    expect(html).toContain("store_unavailable: database is locked");
    expect(html).toContain("Read them again");
    expect(html).toContain('role="alert"');
  });

  it("reading again after the store answers brings the first act", async () => {
    await readRows();
    seams.refuse = false;
    await readRows();
    expect(useSettings.getState().hydrated).toBe(true);
    expect(useSettings.getState().problem).toBeNull();
    const scene = surfaceOf(noGo);
    expect(isValidElement(scene) && scene.type).toBe(Waking);
  });

  it("a refused re-read after the rows were shown keeps them", async () => {
    seams.refuse = false;
    await readRows();
    seams.refuse = true;
    await readRows();
    expect(useSettings.getState().hydrated).toBe(true);
    const scene = surfaceOf(noGo);
    expect(isValidElement(scene) && scene.type).toBe(Waking);
  });
});
