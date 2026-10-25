// @vitest-environment jsdom
/**
 * Tests for the studio's keys in the scene — README section 3.1, ADR 0028 and 0087.
 *
 * `model.test.ts` pins the table (`keyAction`); these pin that each key the table names is carried
 * out against the model's own actions on the right step, that a text field or a button keeps what
 * is its own, and that Escape is left to the stage. The act table (`acts`) is pinned here too: each
 * act's availability and its refusal sentence, and that every control in the studio that mirrors an
 * act reads that one entry (a DOM is needed for that parity, hence jsdom).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { INERT_ACTIONS, type KeyAction, type VoiceActions, type VoiceModel } from "@/modules/voice/model";

import { fixtureIds, fixtures } from "./fixtures";
import { acts, ownsKey, perform, studioKey, type KeyLike } from "./keys";
import VoiceScene, { STUDIO } from "./view";

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
  it("does not open the microphone on hear while no listener is ready, as the Hold button will not", () => {
    // The take would be recorded and thrown away (live.ts recordStop returns with no engines).
    const muted = key("hear-muted", " ");
    expect(muted.done).toBe(false);
    expect(muted.calls).toEqual([]);
    expect(fixtures["hear-muted"]!.columns.some((c) => c.ready)).toBe(false);
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

describe("one act table: every act's availability and its reason come from acts()", () => {
  it("record_start is refused with the listener's sentence on hear-muted, record_stop runs while recording, and perform obeys", () => {
    expect(acts(fixtures["hear-muted"]!).record_start).toEqual({
      enabled: false,
      reason: "No listener is ready yet — install a Whisper model or add a key below.",
    });
    expect(acts(fixtures.recording!).record_stop).toEqual({ enabled: true });
    const { model, calls } = spy("hear-muted");
    expect(perform(model, "record_start")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("primary is refused with the dock's own reason, and perform says it did nothing", () => {
    const { model, calls } = spy("hear-muted");
    expect(acts(model).primary).toEqual({ enabled: false, reason: model.dock.primaryDisabledReason });
    expect(perform(model, "primary")).toBe(false);
    expect(calls).toEqual([]);
  });
});

type Act = Exclude<KeyAction, null>;

/** What a rendered control says of itself: disabled, and the reason its wrapper carries. */
function stateOf(button: HTMLButtonElement): { enabled: boolean; reason?: string } {
  if (!button.disabled) return { enabled: true };
  return { enabled: false, reason: button.parentElement?.getAttribute("title") ?? undefined };
}

/** The controls in the studio that mirror an act, found in the studio's own markup. */
function controlsOf(model: VoiceModel): Partial<Record<Act, HTMLButtonElement | null>> {
  const doc = new DOMParser().parseFromString(
    renderToStaticMarkup(createElement(VoiceScene, { model, path: STUDIO, go: () => {} })),
    "text/html",
  );
  const chip = (k: string) =>
    [...doc.querySelectorAll<HTMLButtonElement>(".vsc-keys button")].find((b) => b.querySelector("kbd")?.textContent === k) ?? null;
  const hold = doc.querySelector<HTMLButtonElement>('button[title="Hold to talk; let go to send"]');
  const takes = [...doc.querySelectorAll(".vsc-take")].map((t) => t.querySelector<HTMLButtonElement>(":scope > .row button"));
  return {
    choose_engine: doc.querySelector<HTMLButtonElement>(".vsc-opt"),
    back: chip("B"),
    skip: chip("S"),
    primary: chip("Enter"),
    toggle_preview: doc.querySelector<HTMLButtonElement>(".vsc-card .vsc-voice button"),
    // The Hold button is the take's one control: it starts a take, and while one records it ends it.
    record_start: model.hear.recording ? null : hold,
    record_stop: model.hear.recording ? hold : null,
    pick_stt_1: takes[0] ?? null,
    pick_stt_2: takes[1] ?? null,
  };
}

const ACTS: readonly Act[] = [
  "choose_engine",
  "back",
  "skip",
  "primary",
  "toggle_preview",
  "record_start",
  "record_stop",
  "pick_stt_1",
  "pick_stt_2",
];

describe("table parity: no control in the studio decides on its own", () => {
  it("the table has one entry per act the module's keys can name", () => {
    expect(Object.keys(acts(fixtures.typical!)).sort()).toEqual([...ACTS].sort());
  });
  for (const id of fixtureIds) {
    describe(id, () => {
      const model = fixtures[id]!;
      let controls: ReturnType<typeof controlsOf> | null = null;
      for (const act of ACTS) {
        it(act, () => {
          controls ??= controlsOf(model);
          const control = controls[act] ?? null;
          const entry = acts(model)[act];
          if (act === "back" || act === "skip") {
            if (!controls.primary) return; // a gate stands in front of the studio: no dock is drawn
            // The dock shows B and S only while they act, so a hidden chip is the refusal.
            expect(control === null ? { enabled: false } : stateOf(control)).toEqual({ enabled: entry.enabled });
            return;
          }
          if (!control) return; // this act has no control on this rendering
          expect(stateOf(control)).toEqual(entry.enabled ? { enabled: true } : { enabled: false, reason: entry.reason });
        });
      }
    });
  }
});
