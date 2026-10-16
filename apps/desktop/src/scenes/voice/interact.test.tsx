// @vitest-environment jsdom
/**
 * Tests for what the Voice scene does when touched — README section 3.1, ADR 0028, 0087 and 0089.
 *
 * A DOM is needed for these and only these: the OpenAI key's replace, cancel and Enter-to-save (and
 * that it is never shown back), the hold button, the studio's document keys, and the one
 * requirement the performance budget makes of the meters: nothing asks for a frame unless a take
 * is recording or her voice is playing, and the frames stop when it ends.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Path } from "@/depth/model";
import { INERT_ACTIONS, type VoiceActions, type VoiceModel } from "@/modules/voice/model";

import { fixtures } from "./fixtures";
import VoiceScene, { SETTINGS, STUDIO } from "./view";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function spy(fixture: string, over: Partial<VoiceModel> = {}): { model: VoiceModel; calls: string[] } {
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
  return { model: { ...fixtures[fixture]!, actions, ...over }, calls };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const mount = (model: VoiceModel, path: Path, go: (to: Path) => void = () => {}) =>
  act(() => root.render(<VoiceScene model={model} path={path} go={go} /> as ReactElement));

const button = (text: string): HTMLButtonElement => {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`no button "${text}"`);
  return found;
};
const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const keyOn = (target: EventTarget, key: string, type: "keydown" | "keyup" = "keydown") =>
  act(() => void target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true })));

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the OpenAI key", () => {
  it("Replace opens the field and Keep the stored key closes it without saving", () => {
    const { model, calls } = spy("typical");
    mount(model, SETTINGS);
    expect(host.querySelector("input")).toBeNull();
    click(button("Replace"));
    expect(host.querySelector('input[type="password"]')).not.toBeNull();
    click(button("Keep the stored key"));
    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).toContain("Replace");
    expect(calls).toEqual([]);
  });

  it("Enter saves the trimmed key, the field empties, and the key is never in the page again", () => {
    const { model, calls } = spy("typical");
    mount(model, SETTINGS);
    click(button("Replace"));
    const input = host.querySelector<HTMLInputElement>("input")!;
    type(input, "  sk-secret-123  ");
    keyOn(input, "Enter");
    expect(calls).toEqual(['saveKey ["sk-secret-123"]']);
    expect(host.textContent).not.toContain("sk-secret-123");
    expect(host.innerHTML).not.toContain("sk-secret-123");
  });

  it("an empty field saves nothing, and the studio keys leave the field its letters", () => {
    const { model, calls } = spy("engine", { mode: "studio" });
    mount(model, STUDIO);
    // The engine step has no field; the hear step's OpenAI key field is where letters are typed.
    const hear = spy("hear-muted");
    mount(hear.model, STUDIO);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="OpenAI API key"]')!;
    keyOn(input, "Enter");
    for (const k of ["b", "s", "1", " "]) keyOn(input, k);
    expect(hear.calls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("Remove says it is busy and cannot be pressed twice while a removal runs", () => {
    const { model, calls } = spy("typical", { keyBusy: true });
    mount(model, SETTINGS);
    const wrapper = host.querySelector('[aria-label="Removing the key..."]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector("button")?.disabled).toBe(true);
    const idle = spy("typical");
    mount(idle.model, SETTINGS);
    click(button("Remove"));
    expect(idle.calls).toEqual(["removeKey"]);
    expect(calls).toEqual([]);
  });
});

describe("hold to talk", () => {
  it("pointer down starts the test take in settings and up stops it", () => {
    const { model, calls } = spy("typical");
    mount(model, SETTINGS);
    const hold = button("Hold to talk");
    act(() => void hold.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(calls).toEqual(["recordStart"]);
    const recording = spy("typical", { hear: { recording: true, micError: null, takes: {} } });
    mount(recording.model, SETTINGS);
    act(() => void button("Listening").dispatchEvent(new MouseEvent("pointerup", { bubbles: true })));
    expect(recording.calls).toEqual(["recordStop"]);
  });

  it("in the studio the button records and the document's Space holds, release stops", () => {
    const { model, calls } = spy("stt-compare");
    mount(model, STUDIO);
    act(() => void button("Hold to talk").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    keyOn(document.body, " ");
    expect(calls).toEqual(["recordStart", "recordStart"]);
    const recording = spy("recording");
    mount(recording.model, STUDIO);
    keyOn(document.body, " ", "keyup");
    expect(recording.calls).toEqual(["recordStop"]);
  });
});

describe("the studio's Hold button held from the keyboard", () => {
  // The button shows <Kbd>Space</Kbd>, and a mouse take leaves it focused; the document keys give a
  // focused button its own Space and Enter (keys.ts ownsKey), so the button must take them itself.
  it("Space and Enter on the focused button start a take, and letting go stops it, once each", () => {
    const { model, calls } = spy("stt-compare");
    mount(model, STUDIO);
    const hold = button("Hold to talk");
    act(() => hold.focus());
    keyOn(hold, " ");
    keyOn(hold, "Enter");
    expect(calls).toEqual(["recordStart", "recordStart"]);
    const recording = spy("recording");
    mount(recording.model, STUDIO);
    const held = button("Listening");
    act(() => held.focus());
    keyOn(held, " ", "keyup");
    expect(recording.calls).toEqual(["recordStop"]);
  });

  it("a held key's repeats do not restart the take", () => {
    const { model, calls } = spy("stt-compare");
    mount(model, STUDIO);
    const hold = button("Hold to talk");
    act(() => void hold.dispatchEvent(new KeyboardEvent("keydown", { key: " ", repeat: true, bubbles: true, cancelable: true })));
    expect(calls).toEqual([]);
  });
});

describe("the studio's document keys", () => {
  it("take Enter, B, S and the numbers from the body, and Escape is left alone for the stage", () => {
    const { model, calls } = spy("stt-compare");
    mount(model, STUDIO);
    keyOn(document.body, "1");
    keyOn(document.body, "2");
    keyOn(document.body, "b");
    keyOn(document.body, "s");
    keyOn(document.body, "Enter");
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => void document.body.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(false);
    expect(calls).toEqual([
      'studio [{"t":"pick_stt","engine":"whisper"}]',
      'studio [{"t":"pick_stt","engine":"openai"}]',
      'studio [{"t":"back"}]',
      'studio [{"t":"skip"}]',
      'studio [{"t":"use_stt"}]',
    ]);
  });

  it("a focused button keeps its own Enter, so the dock does not act twice", () => {
    const { model, calls } = spy("engine");
    mount(model, STUDIO);
    keyOn(button("Skip"), "Enter");
    expect(calls).toEqual([]);
  });

  it("stop listening when the studio goes away", () => {
    const { model, calls } = spy("pick");
    mount(model, STUDIO);
    act(() => root.render(<div />));
    keyOn(document.body, "Enter");
    expect(calls).toEqual([]);
  });

  it("a take in progress is stopped when the studio goes away", () => {
    const { model, calls } = spy("recording");
    mount(model, STUDIO);
    act(() => root.render(<div />));
    expect(calls).toEqual(["recordStop"]);
  });

  it("Start talking finishes the studio and lands in settings", () => {
    const moves: Path[] = [];
    const { model, calls } = spy("ready");
    mount(model, STUDIO, (to) => moves.push(to));
    click(button("Start talking"));
    expect(calls).toEqual(["finish"]);
    expect(moves).toEqual([SETTINGS]);
  });

  it("the rail's receipts and Restart are wired", () => {
    const { model, calls } = spy("stt-compare");
    mount(model, STUDIO);
    click(button("Install"));
    click(button("Restart"));
    expect(calls).toEqual(['studio [{"t":"go","step":"install"}]', 'studio [{"t":"restart"}]']);
  });
});

describe("the field and settings move", () => {
  it("a place is a button that goes there", () => {
    const moves: Path[] = [];
    mount(fixtures.typical!, { root: "voice" }, (to) => moves.push(to));
    click(button("Studio"));
    click(button("Settings"));
    expect(moves).toEqual([STUDIO, SETTINGS]);
  });

  it("Reopen studio reopens it and dives; Refresh asks the daemon again", () => {
    const moves: Path[] = [];
    const { model, calls } = spy("typical");
    mount(model, SETTINGS, (to) => moves.push(to));
    click(button("Reopen studio"));
    click(button("Refresh"));
    expect(calls).toEqual(["reopenStudio", "refresh"]);
    expect(moves).toEqual([STUDIO]);
  });
});

describe("frames: the meters run only while something is recording or playing", () => {
  const stub = () => {
    const raf = vi.fn(() => 1);
    const caf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", caf);
    return { raf, caf };
  };

  it("every fixture at rest asks for no frame", () => {
    const { raf } = stub();
    for (const id of ["engine", "installing", "pick", "stt-compare", "hear-muted", "ready", "typical", "heavy"]) {
      mount(fixtures[id]!, STUDIO);
      mount(fixtures[id]!, SETTINGS);
      mount(fixtures[id]!, { root: "voice" });
    }
    expect(raf).not.toHaveBeenCalled();
  });

  it("a recording take runs one loop, and it is cancelled when the take ends", () => {
    const { raf, caf } = stub();
    mount(fixtures.recording!, STUDIO);
    expect(raf).toHaveBeenCalledTimes(1);
    mount(fixtures["stt-compare"]!, STUDIO);
    expect(caf).toHaveBeenCalled();
  });

  it("her voice playing runs one loop in the studio, and one in settings", () => {
    const { raf } = stub();
    mount(fixtures.speaking!, STUDIO);
    expect(raf).toHaveBeenCalledTimes(1);
    raf.mockClear();
    const playing = { ...fixtures.typical!, preview: fixtures.speaking!.preview };
    mount(playing, SETTINGS);
    expect(raf).toHaveBeenCalledTimes(1);
  });
});
