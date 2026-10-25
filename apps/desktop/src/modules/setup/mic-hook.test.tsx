/**
 * @vitest-environment jsdom
 *
 * The Setup hook knows the microphone's answer on arrival and follows it (ADR 0221). The
 * Permissions API, the user agent and getUserMedia are faked on `navigator`; the hook, the
 * selector and the readiness words are the real code.
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/store")>()),
  settingWrite: vi.fn(async () => {}),
  settingRead: vi.fn(async () => null),
  storePath: vi.fn(async () => null),
}));

import { useSettings } from "@/stores/settings";

import { useSetupModel } from "./index";
import { micRemedy } from "./mic";
import type { SetupModel } from "./model";
import { isReady, micFact } from "./readiness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeStatus extends EventTarget {
  constructor(public state: PermissionState) {
    super();
  }
  flip(next: PermissionState) {
    this.state = next;
    this.dispatchEvent(new Event("change"));
  }
}

const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/130.0";
const REMEDY = micRemedy("denied", "windows");

let host: HTMLDivElement;
let root: Root;
let model: SetupModel;
let status: FakeStatus;

function Probe() {
  const next = useSetupModel();
  useEffect(() => {
    model = next;
  });
  return null;
}

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await act(async () => await Promise.resolve());
};

function stub(name: "permissions" | "mediaDevices" | "userAgent", value: unknown) {
  Object.defineProperty(navigator, name, { configurable: true, value });
}

function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Probe />));
}

beforeEach(() => {
  useSettings.setState({ hydrated: true, onboarded: true, engine: "claude_code", brainPath: "" });
  status = new FakeStatus("denied");
  stub("userAgent", WINDOWS_UA);
  stub("permissions", { query: vi.fn(async () => status) });
  stub("mediaDevices", undefined);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  for (const name of ["permissions", "mediaDevices", "userAgent"] as const) {
    delete (navigator as unknown as Record<string, unknown>)[name];
  }
});

describe("the microphone's answer is known on arrival", () => {
  it("case 3: a remembered refusal is 'denied' with its remedy before any press", async () => {
    mount();
    await settle();
    expect(model.mic).toBe("denied");
    expect(micFact(model).summary).toBe(REMEDY);
    expect(micFact(model).standing).toBe("missing");
    // Mind's Microphone level draws micDetail beside its button: the remedy shows there too.
    expect(model.micDetail).toBe(REMEDY);
  });

  it("case 4: turning it on in the platform while the depth is open turns the row granted, with no press", async () => {
    mount();
    await settle();
    act(() => status.flip("granted"));
    await settle();
    expect(model.mic).toBe("granted");
    expect(micFact(model).standing).toBe("done");
  });

  it("the listener goes with the hook", async () => {
    const remove = vi.spyOn(status, "removeEventListener");
    mount();
    await settle();
    act(() => root.unmount());
    expect(remove).toHaveBeenCalledWith("change", expect.any(Function));
    mount();
  });

  it("case 5: a refused check says the remedy, and micDetail keeps the browser's own words after it", async () => {
    status = new FakeStatus("prompt");
    const refusal = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
    stub("mediaDevices", { getUserMedia: vi.fn(async () => Promise.reject(refusal)) });
    mount();
    await settle();
    expect(model.mic).toBe("unknown");
    act(() => model.actions.checkMic());
    await settle();
    expect(model.mic).toBe("denied");
    expect(micFact(model).summary).toBe(REMEDY);
    expect(model.micDetail.startsWith(REMEDY)).toBe(true);
    expect(model.micDetail).toContain("Permission denied");
    expect(model.micDetail.indexOf("Permission denied")).toBeGreaterThan(REMEDY.length - 1);
  });
});

describe("guard case 6: without the Permissions API nothing changes", () => {
  it("mount leaves the microphone unknown, and a granted check carries the track's label", async () => {
    stub("permissions", undefined);
    const track = { label: "Headset Microphone (USB Audio)", stop: vi.fn() };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    stub("mediaDevices", { getUserMedia: vi.fn(async () => stream) });
    mount();
    await settle();
    expect(model.mic).toBe("unknown");
    expect(micFact(model).summary).toBe("not asked yet");
    act(() => model.actions.checkMic());
    await settle();
    expect(model.mic).toBe("granted");
    expect(model.micDetail).toBe("Headset Microphone (USB Audio)");
    expect(micFact(model).summary).toBe("Headset Microphone (USB Audio)");
    expect(track.stop).toHaveBeenCalled();
    expect(isReady(model)).toBe(isReady({ ...model, mic: "unknown" }));
  });
});
