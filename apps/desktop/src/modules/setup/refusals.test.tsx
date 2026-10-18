/**
 * @vitest-environment jsdom
 *
 * A refused setting write is said where the choice was made — the look, the brain path, the engine
 * and "Wake her" — and the shown choice settles back to the stored row. The store's write seam is
 * faked to refuse the keys a test names; everything above it (the settings store, the Setup hook,
 * the Mind and first-act views) is the real code.
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({
  refuse: new Set<string>(),
  stored: {} as Record<string, unknown>,
  writes: [] as string[],
}));

vi.mock("@/lib/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/store")>()),
  settingWrite: vi.fn(async (key: string, value: unknown) => {
    if (seams.refuse.has(key)) throw new Error(`store_refused: ${key} is read-only`);
    seams.writes.push(key);
    seams.stored[key] = value;
  }),
  settingRead: vi.fn(async (key: string) => seams.stored[key] ?? null),
  storePath: vi.fn(async () => null),
}));

import { SETTING_KEYS } from "@/lib/store";
import MindView from "@/scenes/mind/view";
import WakingView from "@/scenes/waking/view";
import { useSettings } from "@/stores/settings";

import { useSetupModel } from "./index";
import { fixtures } from "./fixtures";
import type { SetupModel } from "./model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let model: SetupModel;
const finished = vi.fn();

function Probe() {
  const next = useSetupModel({ afterFinish: finished });
  useEffect(() => {
    model = next;
  });
  return null;
}

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await act(async () => await Promise.resolve());
};

beforeEach(() => {
  seams.refuse.clear();
  seams.writes.length = 0;
  seams.stored = { [SETTING_KEYS.theme]: "light", [SETTING_KEYS.engine]: "claude_code" };
  finished.mockClear();
  useSettings.setState({ hydrated: true, theme: "light", onboarded: false, engine: "claude_code", brainPath: "" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Probe />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a refused write is kept beside its control, and the stored row comes back", () => {
  it("the theme", async () => {
    seams.refuse.add(SETTING_KEYS.theme);
    act(() => model.actions.setTheme("dark"));
    await settle();
    expect(model.refusals.theme).toBe(`store_refused: ${SETTING_KEYS.theme} is read-only`);
    expect(useSettings.getState().theme).toBe("light");
  });

  it("the text size and motion", async () => {
    seams.refuse.add(SETTING_KEYS.typeScale).add(SETTING_KEYS.motion);
    act(() => model.actions.setTypeScale("compact"));
    act(() => model.actions.setMotion("calm"));
    await settle();
    expect(model.refusals.typeScale).toContain("store_refused");
    expect(model.refusals.motion).toContain("store_refused");
  });

  it("the brain path", async () => {
    seams.refuse.add(SETTING_KEYS.brainPath);
    act(() => model.actions.setBrainPath("D:/brain"));
    await settle();
    expect(model.refusals.brainPath).toContain("store_refused");
    expect(useSettings.getState().brainPath).toBe("");
  });

  it("the engine", async () => {
    useSettings.setState({ onboarded: true });
    seams.refuse.add(SETTING_KEYS.engine);
    act(() => model.actions.chooseEngine("codex"));
    await settle();
    expect(model.refusals.engine).toContain("store_refused");
    expect(useSettings.getState().engine).toBe("claude_code");
  });

  it("a write that lands clears its earlier refusal", async () => {
    seams.refuse.add(SETTING_KEYS.theme);
    act(() => model.actions.setTheme("dark"));
    await settle();
    seams.refuse.clear();
    act(() => model.actions.setTheme("dark"));
    await settle();
    expect(model.refusals.theme).toBeUndefined();
    expect(useSettings.getState().theme).toBe("dark");
  });
});

describe("Wake her", () => {
  it("a refused wake keeps the act open, with the reason", async () => {
    seams.refuse.add(SETTING_KEYS.onboarded);
    act(() => model.actions.finish());
    await settle();
    expect(useSettings.getState().onboarded).toBe(false);
    expect(finished).not.toHaveBeenCalled();
    expect(model.waking).toBe(false);
    expect(model.refusals.wake).toContain("store_refused");
  });

  it("a stored wake closes the act once the row has landed", async () => {
    act(() => model.actions.finish());
    expect(model.waking).toBe(true);
    await settle();
    expect(seams.writes).toContain(SETTING_KEYS.onboarded);
    expect(useSettings.getState().onboarded).toBe(true);
    expect(finished).toHaveBeenCalledTimes(1);
    expect(model.refusals.wake).toBeUndefined();
  });
});

describe("the views say it", () => {
  const refused = { theme: "store_refused: theme", brainPath: "store_refused: brain", engine: "store_refused: engine" };

  it("Mind shows the look and the brain refusals in their own sections", () => {
    const look = renderToStaticMarkup(
      <MindView model={{ ...fixtures.settings!, refusals: refused }} path={{ root: "mind", item: "look" }} go={() => {}} />,
    );
    expect(look).toContain("The theme was not stored. The stored choice is shown again.");
    const brain = renderToStaticMarkup(
      <MindView model={{ ...fixtures.settings!, refusals: refused }} path={{ root: "mind", item: "brain" }} go={() => {}} />,
    );
    expect(brain).toContain("The brain directory was not stored.");
    const engine = renderToStaticMarkup(
      <MindView model={{ ...fixtures.settings!, refusals: refused }} path={{ root: "mind", item: "engine" }} go={() => {}} />,
    );
    expect(engine).toContain("That engine choice was not stored.");
  });

  it("the first act shows a refused wake beside Wake her, and Waking her while it stores", () => {
    const refusedWake = renderToStaticMarkup(
      <WakingView model={{ ...fixtures.onboarding!, refusals: { wake: "store_refused: onboarded" } }} onLater={() => {}} initialStep={3} />,
    );
    expect(refusedWake).toContain("She is not awake yet");
    expect(refusedWake).toContain("store_refused: onboarded");
    const storing = renderToStaticMarkup(
      <WakingView model={{ ...fixtures.onboarding!, waking: true }} onLater={() => {}} initialStep={3} />,
    );
    expect(storing).toContain("Waking her…");
  });
});
