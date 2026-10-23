// @vitest-environment jsdom
/**
 * Her tone in the Voice module — ADR 0138 (Athena speaks with a halo), README section 3.1.
 *
 * The control picks Natural or Halo and applies it live, says the chosen one in one plain line,
 * plays the sample line in the chosen tone through the voice preview, and shows the daemon's line
 * when the halo's add-on is missing. A daemon older than the tone gets no control at all.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Tone } from "@/lib/voice-setup";

import { config, fixtures, model } from "./fixtures";
import { INERT_ACTIONS, TONE_COPY, toneOf, type VoiceModel } from "./model";
import { ToneControl } from "./pieces";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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
});

function draw(base: VoiceModel) {
  const chosen: Tone[] = [];
  const previews: Array<[string, Tone | undefined]> = [];
  const m: VoiceModel = {
    ...base,
    actions: {
      ...INERT_ACTIONS,
      chooseTone: (tone) => void chosen.push(tone),
      togglePreview: (voice, tone) => void previews.push([voice, tone]),
    },
  };
  act(() => root.render(<ToneControl model={m} />));
  return { chosen, previews };
}

const buttons = () => [...host.querySelectorAll("button")];
const button = (text: string) => buttons().find((b) => b.textContent?.includes(text))!;
const click = (el: HTMLElement) => act(() => void el.click());

describe("toneOf", () => {
  it("reads the choice, what she speaks in, and the add-on's standing from the config", () => {
    expect(toneOf(config())).toEqual({ chosen: "halo", speaking: "halo", available: true, note: null });
    expect(toneOf(fixtures.heavy!.config)).toMatchObject({ chosen: "halo", speaking: "natural", available: false });
  });

  it("is null for no config and for a daemon that sends no tone", () => {
    expect(toneOf(null)).toBeNull();
    expect(toneOf(config({ tts: { engine: "kokoro", voice: "af_heart" } }))).toBeNull();
  });
});

describe("ToneControl", () => {
  it("offers Natural and Halo with the chosen one's line, and choosing applies it", () => {
    const { chosen } = draw(fixtures.typical!);
    const radios = [...host.querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Natural"), expect.stringContaining("Halo")]));
    expect(host.textContent).toContain(TONE_COPY.halo.line);
    click(radios.find((r) => r.textContent?.includes("Natural")) as HTMLElement);
    expect(chosen).toEqual(["natural"]);
  });

  it("plays the sample line in the chosen tone through the voice preview", () => {
    const { previews } = draw(fixtures.typical!);
    click(button("Hear Halo"));
    expect(previews).toEqual([["af_heart", "halo"]]);
  });

  it("says Stop while its own preview plays, and not while her voice's plays", () => {
    draw(model({ preview: { phase: "playing", voice: "af_heart", tone: "halo", error: null } }));
    expect(button("Stop")).toBeTruthy();
    draw(model({ preview: { phase: "playing", voice: "af_heart", tone: null, error: null } }));
    expect(buttons().some((b) => b.textContent === "Stop")).toBe(false);
  });

  it("without the add-on it shows the plain line, and the choice stays", () => {
    draw(fixtures.heavy!);
    const note = host.querySelector('[role="status"]');
    expect(note?.textContent).toBe("The halo tone needs an add-on that is not installed; she speaks in her natural tone.");
    expect(host.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain("Halo");
  });

  it("a daemon older than the tone gets a sentence, not a control", () => {
    draw(model({ config: config({ tts: { engine: "kokoro", voice: "af_heart" } }) }));
    expect(host.querySelector('[role="radio"]')).toBeNull();
    expect(host.textContent).toContain("does not offer a tone");
  });
});
