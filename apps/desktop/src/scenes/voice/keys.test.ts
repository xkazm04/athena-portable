/**
 * Tests for the studio's keys in the scene — README section 3.1, ADR 0028 and 0087.
 *
 * `model.test.ts` pins the table (`keyAction`); these pin that each key the table names is carried
 * out against the model's own actions on the right step, that a text field or a button keeps what
 * is its own, and that Escape is left to the stage.
 */
import { describe, expect, it } from "vitest";

import { INERT_ACTIONS, type VoiceActions, type VoiceModel } from "@/modules/voice/model";

import { fixtures } from "./fixtures";
import { ownsKey, perform, studioKey, type KeyLike } from "./keys";

/** The model with every action recorded, so a key's effect is a list of calls. */
function spy(fixture: string): { model: VoiceModel; calls: string[] } {
  const calls: string[] = [];
  const actions = Object.fromEntries(
    Object.keys(INERT_ACTIONS).map((name) => [
      name,
      (...all: unknown[]) => {
        // A handler wired straight to onClick is handed the click; it is not an argument of the act.
        const args = all.filter((a) => !(typeof a === "object" && a !== null && "nativeEvent" in a));
        calls.push(`${name}${args.length ? ` ${JSON.stringify(args)}` : ""}`);
      },
    ]),
  ) as unknown as VoiceActions;
  return { model: { ...fixtures[fixture]!, actions }, calls };
}

const press = (key: string, over: Partial<KeyLike> = {}): KeyLike => ({
  key,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: null,
  ...over,
});

/** What a key does on a fixture's step, end to end: the table, then the act. */
function key(fixture: string, k: string, phase: "down" | "up" = "down", over: Partial<KeyLike> = {}) {
  const { model, calls } = spy(fixture);
  const act = studioKey(model, press(k, over), phase);
  const done = act === null ? false : perform(model, act);
  return { act, done, calls };
}

describe("Enter is the primary act of each step", () => {
  it("engine chooses Kokoro", () => {
    expect(key("engine", "Enter").calls).toEqual(['studio [{"t":"choose_engine"}]']);
  });
  it("install starts the install when Kokoro is missing, and checks again after a manual one", () => {
    expect(key("installing", "Enter").calls).toEqual([]); // running: Enter has a reason not to
    expect(key("failed", "Enter").calls).toEqual(['install ["kokoro"]']);
    expect(key("manual", "Enter").calls).toEqual(["refresh"]);
  });
  it("pick keeps the voice, hear keeps the picked listener, ready finishes", () => {
    expect(key("pick", "Enter").calls).toEqual(['studio [{"t":"choose_voice","voice":"af_heart"}]']);
    expect(key("stt-compare", "Enter").calls).toEqual(['studio [{"t":"use_stt"}]']);
    expect(key("ready", "Enter").calls).toEqual(["finish"]);
  });
  it("hear without a pick does nothing, and says why on the dock", () => {
    expect(key("hear-muted", "Enter").calls).toEqual([]);
    expect(fixtures["hear-muted"]!.dock.primaryDisabledReason).toContain("Take one take");
  });
});

describe("B and S", () => {
  it("B goes back from every step but the first, S skips from every step but the last", () => {
    expect(key("engine", "b").act).toBeNull();
    expect(key("pick", "b").calls).toEqual(['studio [{"t":"back"}]']);
    expect(key("pick", "B").calls).toEqual(['studio [{"t":"back"}]']);
    expect(key("engine", "s").calls).toEqual(['studio [{"t":"skip"}]']);
    expect(key("ready", "s").act).toBeNull();
  });
});

describe("1 and 2", () => {
  it("1 chooses the engine on the engine step", () => {
    expect(key("engine", "1").calls).toEqual(['studio [{"t":"choose_engine"}]']);
  });
  it("1 and 2 pick the first and second listener on the hear step, only when it is ready", () => {
    expect(key("stt-compare", "1").calls).toEqual(['studio [{"t":"pick_stt","engine":"whisper"}]']);
    expect(key("stt-compare", "2").calls).toEqual(['studio [{"t":"pick_stt","engine":"openai"}]']);
    expect(key("hear-muted", "1").calls).toEqual([]);
    expect(key("hear-muted", "2").calls).toEqual([]);
  });
  it("mean nothing elsewhere", () => {
    expect(key("pick", "1").act).toBeNull();
    expect(key("ready", "2").act).toBeNull();
  });
});

describe("Space", () => {
  it("toggles the preview on pick, only once her voice is installed", () => {
    expect(key("pick", " ").calls).toEqual(['togglePreview ["af_heart"]']);
    const { model, calls } = spy("pick");
    const notReady = { ...model, kokoro: model.kokoro && { ...model.kokoro, state: "absent" as const } };
    expect(perform(notReady, "toggle_preview")).toBe(false);
    expect(calls).toEqual([]);
  });
  it("holds to record on hear: down starts, up stops, and neither twice", () => {
    expect(key("stt-compare", " ").calls).toEqual(["recordStart"]);
    expect(key("stt-compare", " ", "up").done).toBe(false); // not recording: nothing to stop
    expect(key("recording", " ").done).toBe(false); // already recording: a repeat does not restart
    expect(key("recording", " ", "up").calls).toEqual(["recordStop"]);
  });
  it("up means nothing on other steps", () => {
    expect(key("pick", " ", "up").act).toBeNull();
  });
});

describe("who owns a key", () => {
  const el = (matches: string[]) => ({ closest: (sel: string) => (matches.some((m) => sel.includes(m)) ? {} : null) });

  it("a text field keeps every key, so typing a key never moves the studio", () => {
    for (const k of ["b", "s", "1", " ", "Enter"]) {
      expect(ownsKey(el(["input"]), k)).toBe(true);
      expect(key("pick", k, "down", { target: el(["input"]) }).act).toBeNull();
    }
  });
  it("a button keeps its own Enter and Space and gives the letters to the studio", () => {
    expect(ownsKey(el(["button"]), "Enter")).toBe(true);
    expect(ownsKey(el(["button"]), " ")).toBe(true);
    expect(ownsKey(el(["button"]), "b")).toBe(false);
    expect(key("pick", "b", "down", { target: el(["button"]) }).act).toBe("back");
    expect(key("pick", "Enter", "down", { target: el(["button"]) }).act).toBeNull();
  });
  it("a radio keeps Enter and Space too", () => {
    expect(ownsKey(el(["[role='radio']"]), " ")).toBe(true);
  });
  it("the body owns nothing", () => {
    expect(ownsKey(null, "Enter")).toBe(false);
    expect(ownsKey({}, "Enter")).toBe(false);
  });
  it("a chord, a repeat and Escape are not the studio's: Escape rises, the stage owns it", () => {
    expect(key("pick", "Enter", "down", { ctrlKey: true }).act).toBeNull();
    expect(key("pick", "b", "down", { altKey: true }).act).toBeNull();
    expect(key("pick", "b", "down", { metaKey: true }).act).toBeNull();
    expect(key("pick", " ", "down", { repeat: true }).act).toBeNull();
    expect(key("pick", "Escape").act).toBeNull();
  });
});
