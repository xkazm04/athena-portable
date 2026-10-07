/**
 * ADR 0028 (Athena's voice is set up in a studio), README section 3.1 — the Voice model, pure.
 *
 * The step machine, the greeting, the install's words and the ready mapping, with no window, no
 * daemon and no audio: every rule the studio keeps is a function of its arguments here.
 */
import { describe, expect, it } from "vitest";

import type { InstallState, VoiceConfig } from "@/lib/voice-setup";

import { fixtures } from "./fixtures";
import {
  HEAR_IDLE,
  INERT_ACTIONS,
  PREVIEW_IDLE,
  SILENT_METERS,
  STUDIO_START,
  TEST_LINE,
  greetingFor,
  installView,
  keyAction,
  pathProgress,
  previewText,
  readySttEngines,
  selectVoice,
  stagesOf,
  studioReduce,
  sttColumns,
  type StudioEvent,
  type StudioState,
  type VoiceSources,
} from "./model";

const READY = { kokoroReady: true };
const ABSENT = { kokoroReady: false };

function walk(ctx: { kokoroReady: boolean }, ...events: StudioEvent[]): StudioState {
  return events.reduce((s, e) => studioReduce(s, e, ctx), STUDIO_START);
}

describe("the step machine", () => {
  it("skips install when Kokoro is already on disk, and marks it done", () => {
    const s = walk(READY, { t: "choose_engine" });
    expect(s.step).toBe("pick");
    expect(s.done).toEqual(["engine", "install"]);
    expect(s.engineChosen).toBe(true);
  });

  it("stops on install when Kokoro is absent, and holds there until it is ready", () => {
    const s = walk(ABSENT, { t: "choose_engine" });
    expect(s.step).toBe("install");
    expect(studioReduce(s, { t: "next" }, ABSENT).step).toBe("install");
    const after = studioReduce(s, { t: "next" }, READY);
    expect(after.step).toBe("pick");
    expect(after.done).toContain("install");
  });

  it("back from pick passes over an auto-done install to the engine", () => {
    const s = walk(READY, { t: "choose_engine" }, { t: "back" });
    expect(s.step).toBe("engine");
    expect(walk(ABSENT, { t: "choose_engine" }, { t: "next" }).step).toBe("install");
  });

  it("the first preview wakes her and selects the voice; a second does not re-select", () => {
    let s = walk(READY, { t: "choose_engine" });
    expect(s.wokeUp).toBe(false);
    s = studioReduce(s, { t: "previewed", voice: "af_heart" }, READY);
    expect(s.wokeUp).toBe(true);
    expect(s.voice).toBe("af_heart");
    expect(s.step).toBe("pick");
    const again = studioReduce(s, { t: "previewed", voice: "af_other" }, READY);
    expect(again).toBe(s);
  });

  it("the first preview speaks a greeting for the hour; later previews speak the test line", () => {
    const morning = new Date(2026, 9, 7, 8, 0);
    expect(previewText(false, morning)).toBe("Good morning — I'm Athena.");
    expect(previewText(true, morning)).toBe(TEST_LINE);
    expect(TEST_LINE).toBe("Hello, I am Athena, your personal assistant.");
  });

  it("choosing the voice folds pick into a receipt and moves to how she hears you", () => {
    const s = walk(READY, { t: "choose_engine" }, { t: "choose_voice", voice: "af_heart" });
    expect(s.step).toBe("hear");
    expect(s.done).toContain("pick");
  });

  it("an stt pick is needed before Enter moves on, then it reaches ready", () => {
    let s = walk(READY, { t: "choose_engine" }, { t: "choose_voice", voice: "af_heart" });
    expect(studioReduce(s, { t: "use_stt" }, READY)).toBe(s);
    expect(studioReduce(s, { t: "next" }, READY)).toBe(s);
    s = studioReduce(s, { t: "pick_stt", engine: "openai" }, READY);
    s = studioReduce(s, { t: "use_stt" }, READY);
    expect(s.step).toBe("ready");
    expect(s.stt).toBe("openai");
  });

  it("change reopens a receipt, and moving on returns to where the person was", () => {
    let s = walk(
      READY,
      { t: "choose_engine" },
      { t: "choose_voice", voice: "af_heart" },
      { t: "pick_stt", engine: "whisper" },
      { t: "use_stt" },
    );
    expect(s.step).toBe("ready");
    s = studioReduce(s, { t: "go", step: "pick" }, READY);
    expect(s.step).toBe("pick");
    s = studioReduce(s, { t: "choose_voice", voice: "af_heart" }, READY);
    expect(s.step).toBe("ready");
  });

  it("go never jumps ahead to a step nobody answered", () => {
    const s = walk(READY, { t: "choose_engine" });
    expect(studioReduce(s, { t: "go", step: "hear" }, READY)).toBe(s);
  });

  it("skip marks the step skipped, and its receipt says so", () => {
    const s = walk(READY, { t: "choose_engine" }, { t: "skip" });
    expect(s.step).toBe("hear");
    expect(s.skipped).toEqual(["pick"]);
    const model = selectVoice(sources({ studio: s }));
    expect(model.receipts.map((r) => [r.step, r.status])).toEqual([
      ["engine", "done"],
      ["install", "done"],
      ["pick", "skipped"],
    ]);
  });

  it("restart returns to the first card", () => {
    expect(walk(READY, { t: "choose_engine" }, { t: "restart" })).toEqual(STUDIO_START);
  });

  it("derives the three stages and how far along the path is", () => {
    const start = stagesOf(STUDIO_START);
    expect(start.map((s) => s.status)).toEqual(["now", "todo", "todo"]);
    expect(pathProgress(start)).toBe(0);
    const hear = stagesOf(walk(READY, { t: "choose_engine" }, { t: "choose_voice", voice: "af_heart" }));
    expect(hear.map((s) => s.status)).toEqual(["done", "now", "todo"]);
    expect(pathProgress(hear)).toBe(0.5);
  });
});

describe("greeting by hour", () => {
  it.each([
    [5, "Good morning — I'm Athena."],
    [11, "Good morning — I'm Athena."],
    [12, "Good afternoon — I'm Athena."],
    [17, "Good afternoon — I'm Athena."],
    [18, "Good evening — I'm Athena."],
    [22, "Good evening — I'm Athena."],
    [23, "It's late — I'm Athena. I'll keep my voice down."],
    [3, "It's late — I'm Athena. I'll keep my voice down."],
  ])("%i:00 says %s", (hour, line) => {
    expect(greetingFor(hour)).toBe(line);
  });
});

describe("install state to view text", () => {
  const s = (over: Partial<InstallState>): InstallState => ({
    component: "kokoro",
    state: "idle",
    received_bytes: 0,
    total_bytes: null,
    error: null,
    ...over,
  });

  it("a download with a total says a percentage and fills the ring", () => {
    const v = installView(s({ state: "downloading_engine", received_bytes: 50, total_bytes: 200 }));
    expect(v).toMatchObject({ label: "Downloading the engine", percent: 25, figure: "25%", busy: true, ring: 0.25 });
  });

  it("a download with no total says megabytes and leaves the bar to pulse", () => {
    const v = installView(s({ state: "downloading_model", received_bytes: 18 * 1024 * 1024 }));
    expect(v).toMatchObject({ label: "Downloading the voice model", percent: null, figure: "18 MB", busy: true, ring: 0 });
  });

  it("extracting, completed, not needed, failed, manual and idle each have their words", () => {
    expect(installView(s({ state: "extracting" })).label).toBe("Unpacking");
    expect(installView(s({ state: "completed" }))).toMatchObject({ label: "Installed", ring: 1, busy: false });
    expect(installView(s({ state: "not_needed" }))).toMatchObject({ label: "Already installed", ring: 1 });
    expect(installView(s({ state: "failed", error: "connection reset" }))).toMatchObject({
      label: "The install did not finish",
      error: "connection reset",
    });
    expect(installView(s({ state: "failed" })).error).toBe("the daemon gave no reason");
    expect(installView(s({ state: "manual" })).label).toBe("Needs a hand to install");
    expect(installView(null)).toMatchObject({ phase: "idle", label: "Not installed", busy: false });
  });

  it("never claims more than 100%", () => {
    expect(installView(s({ state: "downloading_model", received_bytes: 300, total_bytes: 200 })).percent).toBe(100);
  });
});

describe("ready and reason", () => {
  it("a ready config is available with no reason", () => {
    const m = fixtures.typical;
    expect(m.available).toBe(true);
    expect(m.reason).toBe("");
  });

  it("a config that is not ready says the daemon's sentence", () => {
    const m = fixtures.heavy;
    expect(m.available).toBe(false);
    expect(m.reason).toBe("Whisper small.en is not installed.");
  });

  it("no config at all is neither available nor given a reason it does not have", () => {
    expect(fixtures.degraded.available).toBe(false);
    expect(fixtures.degraded.reason).toBe("");
    expect(fixtures.degraded.daemon).toBe("offline");
  });

  it("the mood is the studio until it is finished, settings after, the studio again when reopened", () => {
    expect(selectVoice(sources({ studioDone: false })).mode).toBe("studio");
    expect(selectVoice(sources({ studioDone: true })).mode).toBe("settings");
    expect(selectVoice(sources({ studioDone: true, reopened: true })).mode).toBe("studio");
  });
});

describe("the comparison", () => {
  it("columns take every stt engine, with cloud said aloud and the reason for one not ready", () => {
    const cols = fixtures.heavy.columns;
    expect(cols.map((c) => [c.id, c.where, c.ready])).toEqual([
      ["whisper", "local", false],
      ["openai", "cloud", false],
    ]);
    expect(cols[1].reason).toMatch(/refused the stored key/);
  });

  it("a take is shown with its text and milliseconds, and the pick is marked", () => {
    const cols = fixtures["stt-compare"].columns;
    expect(cols[0]).toMatchObject({ body: "Book the meeting room for Thursday at ten.", picked: true });
    expect(cols[0].take.ms).toBe(412);
    expect(cols[1].picked).toBe(false);
  });

  it("a take goes to every ready engine and to no other", () => {
    expect(readySttEngines(fixtures.typical.config)).toEqual(["whisper", "openai"]);
    expect(readySttEngines(fixtures.heavy.config)).toEqual([]);
    expect(readySttEngines(null)).toEqual([]);
  });

  it("an empty transcript reads as heard nothing, not as a blank column", () => {
    const cols = sttColumns(fixtures.typical.config, {
      ...HEAR_IDLE,
      takes: { whisper: { state: "done", text: "", ms: 10, error: null } },
    }, null);
    expect(cols[0].body).toBe("(heard nothing)");
  });
});

describe("keys", () => {
  it.each([
    ["engine", "1", "down", "choose_engine"],
    ["engine", "b", "down", null],
    ["install", "B", "down", "back"],
    ["pick", "s", "down", "skip"],
    ["ready", "s", "down", null],
    ["pick", "Enter", "down", "primary"],
    ["pick", " ", "down", "toggle_preview"],
    ["hear", " ", "down", "record_start"],
    ["hear", " ", "up", "record_stop"],
    ["hear", "2", "down", "pick_stt_2"],
    ["pick", " ", "up", null],
  ] as const)("on %s, %j %s means %s", (step, key, phase, act) => {
    expect(keyAction(step, key, phase)).toBe(act);
  });
});

describe("the dock", () => {
  it("Enter's label and its reason follow the card", () => {
    expect(fixtures.engine.dock).toMatchObject({ canBack: false, primaryLabel: "Use Kokoro" });
    expect(fixtures.installing.dock).toMatchObject({ primaryLabel: "Installing...", primaryDisabledReason: "The install is running." });
    expect(fixtures.failed.dock.primaryLabel).toBe("Try again");
    expect(fixtures.manual.dock.primaryLabel).toBe("Check again");
    expect(fixtures.pick.dock).toMatchObject({ primaryLabel: "This is her voice", primaryDisabledReason: undefined });
    expect(fixtures.ready.dock).toMatchObject({ primaryLabel: "Start talking", canSkip: false });
  });

  it("the style card is not yet until decided", () => {
    expect(fixtures.engine.styleHer.every((l) => l.value === null)).toBe(true);
    expect(fixtures.ready.styleHer.map((l) => l.value)).toEqual([
      "Kokoro, on this machine",
      "Heart · English (US) · female · A",
    ]);
    expect(fixtures.ready.styleHears[0].value).toBe("Whisper base.en, on this machine");
  });
});

function sources(over: Partial<VoiceSources>): VoiceSources {
  const config = fixtures.typical.config as VoiceConfig;
  return {
    daemon: "ready",
    config,
    problem: null,
    loading: false,
    studioDone: false,
    reopened: false,
    studio: STUDIO_START,
    install: null,
    installError: null,
    preview: PREVIEW_IDLE,
    hear: HEAR_IDLE,
    keyBusy: false,
    saveError: null,
    now: new Date(2026, 9, 7, 9),
    actions: INERT_ACTIONS,
    meters: SILENT_METERS,
    ...over,
  };
}
