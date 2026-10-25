/**
 * The microphone's remembered answer (ADR 0221): read without a prompt, followed while the
 * platform changes it, and a refusal said as the platform's way to give it back.
 */
import { describe, expect, test, vi } from "vitest";

import { fixtures } from "./fixtures";
import { micPermissionOf, micPlatform, micRemedy, readMicPermission, watchMicPermission } from "./mic";
import { isReady, notReadyBecause } from "./readiness";
import { INERT_ACTIONS, selectSetup, type SetupModel, type SetupSources } from "./model";

const sourcesOf = (): SetupSources => ({
  onboarded: true,
  hydrated: true,
  engine: "claude_code",
  engineIds: ["claude_code", "codex"],
  probes: null,
  problem: null,
  checking: false,
  theme: "system",
  brainPath: "",
  tabs: [],
  storePath: null,
  actions: INERT_ACTIONS,
});

/** A permission status the test can flip: the platform's `change` event, nothing more. */
class FakeStatus extends EventTarget {
  constructor(public state: PermissionState) {
    super();
  }
  flip(next: PermissionState) {
    this.state = next;
    this.dispatchEvent(new Event("change"));
  }
}

const permissions = (state: PermissionState) => ({
  query: vi.fn(async () => new FakeStatus(state) as unknown as PermissionStatus),
});

describe("case 0: reading the remembered answer never prompts", () => {
  test("denied and granted are recalled; prompt, a throw and no API are unknown", async () => {
    expect(await readMicPermission(permissions("denied"))).toEqual({ standing: "denied", recalled: true });
    expect(await readMicPermission(permissions("granted"))).toEqual({ standing: "granted", recalled: true });
    expect(await readMicPermission(permissions("prompt"))).toEqual({ standing: "unknown", recalled: false });
    const throws = { query: vi.fn(async () => Promise.reject(new TypeError("microphone is not a permission name"))) };
    expect(await readMicPermission(throws)).toEqual({ standing: "unknown", recalled: false });
    expect(await readMicPermission(undefined)).toEqual({ standing: "unknown", recalled: false });
    expect(micPermissionOf(undefined)).toEqual({ standing: "unknown", recalled: false });
  });

  test("the read asks for the microphone by name and nothing else", async () => {
    const p = permissions("denied");
    await readMicPermission(p);
    expect(p.query).toHaveBeenCalledWith({ name: "microphone" });
  });
});

describe("case 1: the answer is followed while the platform changes it", () => {
  test("a change is heard with its new standing, and the returned function stops hearing", () => {
    const status = new FakeStatus("denied");
    const heard = vi.fn();
    const stop = watchMicPermission(status as unknown as PermissionStatus, heard);
    status.flip("granted");
    expect(heard).toHaveBeenCalledWith("granted");
    stop();
    status.flip("denied");
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("case 2: a refusal is said as the platform's way to give it back", () => {
  const windows = micRemedy("denied", "windows");
  const macos = micRemedy("denied", "macos");
  const other = micRemedy("denied", "other");

  test("Windows names the Settings switch and letting desktop apps use it", () => {
    expect(windows).toContain("Settings > Privacy & security > Microphone");
    expect(windows).toMatch(/desktop apps/);
  });

  test("REVISION: Windows also names allowing it again at Athena's own prompt, so the switch is not the only path", () => {
    // WebView2 keeps a refusal per origin, and the Windows switch does not undo it.
    expect(windows).toContain("Settings > Privacy & security > Microphone");
    expect(windows).toMatch(/Athena's own microphone prompt/);
    expect(windows).toMatch(/Allow/);
  });

  test("macOS names System Settings, anything else names the system's privacy settings", () => {
    expect(macos).toContain("System Settings > Privacy & Security > Microphone");
    expect(other).toMatch(/system's privacy settings/);
  });

  test("no sentence carries the machinery's words, and a standing that is not a refusal has none", () => {
    for (const s of [windows, macos, other]) {
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toMatch(/NotAllowedError|webview|getUserMedia/i);
    }
    expect(micRemedy("granted", "windows")).toBe("");
    expect(micRemedy("unknown", "macos")).toBe("");
  });

  test("the platform is read from the user agent", () => {
    expect(micPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/130.0")).toBe("windows");
    expect(micPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")).toBe("macos");
    expect(micPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("other");
  });
});

describe("guard case 7: the microphone is never required", () => {
  test("isReady and the not-ready sentence are unchanged by every mic standing", () => {
    for (const fixture of Object.values(fixtures)) {
      const base: SetupModel = { ...fixture, mic: "unknown", micDetail: "", micRemedy: "" };
      for (const mic of ["unknown", "granted", "denied", "unsupported"] as const) {
        const m: SetupModel = { ...fixture, mic, micDetail: "x", micRemedy: mic === "denied" ? "Turn it on." : "" };
        expect(isReady(m)).toBe(isReady(base));
        expect(notReadyBecause(m)).toBe(notReadyBecause(base));
      }
    }
  });
});

describe("the selector carries the remedy beside the browser's words", () => {
  test("none by default, and the hook's sentence when it gives one", () => {
    expect(selectSetup(sourcesOf()).micRemedy).toBe("");
    expect(selectSetup({ ...sourcesOf(), mic: "denied", micRemedy: "Turn it on." }).micRemedy).toBe("Turn it on.");
  });
});
