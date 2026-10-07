/**
 * ADR 0028 (Athena's voice is set up in a studio), README section 3.1 — the Voice view, rendered.
 *
 * Every fixture rendered to static markup with no shell, and the few things each must say: the
 * studio's one engine card, the install's three faces, the comparison's milliseconds, the
 * settings page's two columns, and the states that are not "it worked".
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { concatPcm } from "./audio";
import { fixtures } from "./fixtures";
import VoiceView from "./view";
import { barHeight, binFor } from "./waveform";

const html = (id: string) => renderToStaticMarkup(<VoiceView model={fixtures[id]} />);

describe("the studio", () => {
  it("offers Kokoro alone, recommended, with its install state and key 1", () => {
    const out = html("engine");
    expect(out).toContain("Kokoro — local, private, about 400 MB");
    expect(out).toContain("Recommended");
    expect(out).toContain("Needs install");
    expect(out).toContain("Her voice");
    expect(out).toContain("Your voice");
    expect(out).toContain("not yet");
  });

  it("an install in flight shows its phase and percentage; a failure its reason and Try again; manual its links", () => {
    expect(html("installing")).toContain("Downloading the voice model");
    expect(html("installing")).toContain("64%");
    expect(html("failed")).toContain("connection reset by github.com");
    expect(html("failed")).toContain("Try again");
    expect(html("manual")).toContain("kokoro-multi-lang-v1_0");
    expect(html("manual")).toContain("Check again");
  });

  it("pick shows the Heart tile with Play and what she will say first", () => {
    const out = html("pick");
    expect(out).toContain("Heart");
    expect(out).toContain("English (US) · female · A");
    expect(out).toContain("Play");
    expect(out).toContain("Good morning — I&#x27;m Athena.");
    expect(out).toContain("This is her voice");
    expect((out.match(/data-bar=""/g) ?? []).length).toBe(28);
  });

  it("the comparison shows each listener's text and milliseconds, and receipts fold the answered steps", () => {
    const out = html("stt-compare");
    expect(out).toContain("412 ms");
    expect(out).toContain("968 ms");
    expect(out).toContain("cloud");
    expect(out).toContain("She speaks as Heart.");
    expect(out).toContain("change");
  });

  it("ready says Start talking and the chord", () => {
    const out = html("ready");
    expect(out).toContain("Start talking");
    expect(out).toContain("Ctrl+Shift+Space");
  });
});

describe("settings and the other states", () => {
  it("settings has Output and Input and the way back into the studio", () => {
    const out = html("typical");
    expect(out).toContain("Output");
    expect(out).toContain("Input");
    expect(out).toContain("Run the studio again");
    expect(out).toContain("Replace");
    expect(out).toContain("Remove");
  });

  it("a stored key is never rendered back, and a refused save says the daemon's words", () => {
    const out = html("heavy");
    expect(out).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(out).toContain("Whisper small.en is not installed.");
    expect(out).toContain("187 MB");
  });

  it("the daemon offline is a problem note, never an empty page", () => {
    const out = html("degraded");
    expect(out).toContain('role="alert"');
    expect(out).toContain("daemon_offline");
  });

  it("starting and loading say they are waiting", () => {
    expect(html("empty")).toContain("Athena is starting");
    expect(html("loading")).toContain("Reading her voice setup");
  });
});

describe("the meters, pure", () => {
  it("mirrors the bins round the centre", () => {
    expect(binFor(0, 28, 48)).toBe(binFor(27, 28, 48));
    expect(binFor(13, 28, 48)).toBeLessThan(binFor(0, 28, 48));
    expect(binFor(0, 28, 48)).toBe(47);
  });

  it("scales a bar by v^0.8 inside its row and never below the floor", () => {
    expect(barHeight(0, 24)).toBe(3);
    expect(barHeight(255, 24)).toBe(24);
    expect(barHeight(128, 24)).toBeGreaterThan(3 + (24 - 3) * 0.5);
  });

  it("joins a take's chunks in order", () => {
    expect([...concatPcm([new Int16Array([1, 2]), new Int16Array([3])])]).toEqual([1, 2, 3]);
  });
});
