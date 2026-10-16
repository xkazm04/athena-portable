// @vitest-environment jsdom
/**
 * Tests for the Voice depth as the running app uses it — README section 3.5, ADR 0090 and 0092.
 *
 * `live.tsx` adds one rule to the module's model: arriving at `voice/studio` reopens a finished
 * studio, once per arrival, and not before the "studio done" row has been read. Finishing it again
 * while still there lands in settings and must not be undone by a second reopen.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Path } from "@/depth/model";
import type { VoiceModel } from "@/modules/voice/model";

import { fixtures } from "./fixtures";

const state: { model: VoiceModel } = { model: fixtures.typical! };
vi.mock("@/modules/voice/index", () => ({ useVoiceModel: () => state.model }));
// The view is a lazy chunk; what is drawn is not this file's rule.
vi.mock("./view", () => ({ default: () => null }));

const { live } = await import("./live");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;
let reopen: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  reopen = vi.fn<() => void>();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** The model with a mode and a loading flag; the actions are the fixture's, reopen recorded. */
function at(path: Path, over: { mode: VoiceModel["mode"]; loading?: boolean }) {
  state.model = {
    ...fixtures.typical!,
    mode: over.mode,
    loading: over.loading ?? false,
    actions: { ...fixtures.typical!.actions, reopenStudio: reopen },
  };
  const { Live } = live;
  act(() => root.render(<Live path={path} go={() => {}} />));
}

const STUDIO: Path = { root: "voice", item: "studio" };
const SETTINGS: Path = { root: "voice", item: "settings" };
const FIELD: Path = { root: "voice" };

describe("arriving at the studio reopens a finished one, once per arrival", () => {
  it("a finished studio is reopened on arrival", () => {
    at(STUDIO, { mode: "settings" });
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it("an unfinished studio is not reopened", () => {
    at(STUDIO, { mode: "studio" });
    expect(reopen).not.toHaveBeenCalled();
  });

  it("waits for the done row: nothing while loading, the reopen once it is read", () => {
    at(STUDIO, { mode: "studio", loading: true });
    expect(reopen).not.toHaveBeenCalled();
    at(STUDIO, { mode: "settings", loading: false });
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it("finishing it again while still there is not undone by a second reopen", () => {
    at(STUDIO, { mode: "settings" });
    at(STUDIO, { mode: "studio" });
    at(STUDIO, { mode: "settings" });
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it("leaving and arriving again is a new arrival", () => {
    at(STUDIO, { mode: "settings" });
    at(FIELD, { mode: "settings" });
    at(STUDIO, { mode: "settings" });
    expect(reopen).toHaveBeenCalledTimes(2);
  });

  it("settings and the field never reopen it", () => {
    at(SETTINGS, { mode: "settings" });
    at(FIELD, { mode: "settings" });
    expect(reopen).not.toHaveBeenCalled();
  });
});
