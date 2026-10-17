/**
 * Tests for the Voice depth's view — README section 3.1, ADR 0028 and 0087.
 *
 * Every fixture is rendered at the root, in the studio and in settings with no shell, and each
 * capability of the parity matrix's Voice rows is asserted to be there. What needs a click (the key
 * field's replace and cancel, the hold button, the frame loops) is in `interact.test.tsx`; what a
 * key does is in `keys.test.ts`.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { STEP_ORDER } from "@/modules/voice/model";

import { fixtureIds, fixtures } from "./fixtures";
import { micBins } from "./parts";
import VoiceScene, { SETTINGS, STUDIO, withMoves } from "./view";

const ROOT = { root: "voice" } as const;
const go = () => {};
const draw = (fixture: string, path = ROOT as import("@/depth/model").Path) =>
  renderToStaticMarkup(<VoiceScene model={fixtures[fixture]!} path={path} go={go} />);

describe("every fixture renders at every level", () => {
  for (const id of fixtureIds) {
    it(id, () => {
      expect(draw(id)).toContain("vsc--field");
      const studio = draw(id, STUDIO);
      const settings = draw(id, SETTINGS);
      // A gate stands in front of both places, and says so; otherwise each draws its own scene.
      expect(studio).toMatch(/vsc--studio|vsc--gate/);
      expect(settings).toMatch(/vsc--settings|vsc--gate/);
    });
  }
  it("has the module's fixtures and the live moments", () => {
    for (const id of ["empty", "typical", "heavy", "degraded", "recording", "speaking", "hear-muted"]) {
      expect(fixtureIds).toContain(id);
    }
  });
  it("an unknown place is said, not drawn and not a crash", () => {
    const out = renderToStaticMarkup(
      <VoiceScene model={fixtures.typical!} path={{ root: "voice", item: "karaoke" }} go={go} />,
    );
    expect(out).toContain("There is no such place under Voice.");
    expect(out).toContain("Back to Voice");
  });
});

describe("the field: two places and the daemon's standing", () => {
  it("offers the studio and settings as buttons with what is true of each", () => {
    const out = draw("typical");
    expect(out.match(/class="vsc-place focus-ring"/g)).toHaveLength(2);
    expect(out).toContain("Studio");
    expect(out).toContain("finished — walk it again");
    expect(out).toContain("output installed · input ready");
    expect(out).toContain("Ctrl+Shift+Space");
  });

  it("says where an unfinished studio stands", () => {
    expect(draw("installing")).toContain("step 2 of 5: Install");
    expect(draw("ready")).toContain("step 5 of 5: Ready");
  });

  it("says her voice is off, with the config's reason, when it cannot run", () => {
    const out = draw("heavy");
    expect(out).toContain("Her voice is off for now.");
    expect(out).toContain("Whisper small.en is not installed.");
  });

  it("offline: the plain sentence, the code, and no empty page", () => {
    const out = draw("degraded");
    expect(out).toContain("Athena&#x27;s daemon is not running, so her voice cannot be set up yet.");
    expect(out).toContain("daemon_offline");
    expect(out).toContain('role="alert"');
  });

  it("starting and loading say they are waiting", () => {
    expect(draw("empty")).toContain("Athena is starting. Her voice setup appears when the daemon answers.");
    expect(draw("loading")).toContain("Reading her voice setup...");
  });

  it("a refused config says it could not be read, shows the reason and offers Ask again", () => {
    const refused = { ...fixtures.degraded!, daemon: "ready" as const, problem: "token_invalid: refused" };
    const out = renderToStaticMarkup(<VoiceScene model={refused} path={ROOT} go={go} />);
    expect(out).toContain("Athena could not read her voice setup.");
    expect(out).toContain("token_invalid: refused");
    expect(out).toContain("Ask again");
  });

  it("the gates stand in front of both places", () => {
    expect(draw("degraded", STUDIO)).toContain("daemon_offline");
    expect(draw("degraded", SETTINGS)).toContain("daemon_offline");
  });
});

describe("the studio", () => {
  it("every step shows its number, its title, her line and the dock", () => {
    const seen = new Set<string>();
    for (const id of ["engine", "installing", "pick", "stt-compare", "ready"]) {
      const out = draw(id, STUDIO);
      const step = fixtures[id]!.studio.step;
      seen.add(step);
      expect(out).toContain(`Step ${STEP_ORDER.indexOf(step) + 1} of 5`);
      expect(out).toContain(fixtures[id]!.line.replaceAll("'", "&#x27;"));
      expect(out).toContain("Keys for this step");
      expect(out).toContain(fixtures[id]!.dock.primaryLabel);
    }
    expect([...seen].sort()).toEqual([...STEP_ORDER].sort());
  });

  it("draws every art as stylised, and says so", () => {
    for (const id of ["engine", "pick", "stt-compare", "ready"]) {
      expect(draw(id, STUDIO)).toContain("Stylised drawing");
    }
    expect(draw("stt-compare", STUDIO)).toContain('data-kind="whisper"');
    expect(draw("stt-compare", STUDIO)).toContain('data-kind="openai"');
    expect(draw("engine", STUDIO)).toContain('data-kind="kokoro"');
  });

  it("the rail is clickable back to every answered step and Restart is there", () => {
    const out = draw("stt-compare", STUDIO);
    for (const label of ["Engine", "Install", "Pick her voice"]) expect(out).toContain(`title="Go back to ${label}"`);
    expect(out).not.toContain('title="Go back to Ready"');
    expect(out).toContain("Restart");
    expect(out).toContain('aria-current="step"');
  });

  it("engine: Kokoro alone, recommended, key 1, with its install state", () => {
    const out = draw("engine", STUDIO);
    expect(out).toContain("Kokoro — local, private, about 360 MB");
    expect(out).toContain("Recommended");
    expect(out).toContain("Needs install");
    expect(out).toContain("Use Kokoro");
  });

  it("install: progress with its phase, the failure with Try again, manual with the links", () => {
    expect(draw("installing", STUDIO)).toContain("Downloading the voice model");
    expect(draw("installing", STUDIO)).toContain("64%");
    expect(draw("installing", STUDIO)).toContain("Installing...");
    expect(draw("failed", STUDIO)).toContain("connection reset by github.com");
    expect(draw("failed", STUDIO)).toContain("Try again");
    expect(draw("manual", STUDIO)).toContain("kokoro-multi-lang-v1_0");
    expect(draw("manual", STUDIO)).toContain("Check again");
  });

  it("pick: the voice, Play with Space, what she will say first", () => {
    const out = draw("pick", STUDIO);
    expect(out).toContain("Heart");
    expect(out).toContain("English (US) · female · A");
    expect(out).toContain("Play");
    expect(out).toContain("Her first words will be: “Good morning — I&#x27;m Athena.”");
    expect(out).toContain("This is her voice");
    expect(out).toContain("Her real voice, live, while she speaks.");
  });

  it("pick: while she speaks the button says Stop and the bell is working", () => {
    const out = draw("speaking", STUDIO);
    expect(out).toContain("Stop");
    expect(out).toContain("Speaking");
    expect(out).toContain('data-speaking="true"');
    expect(out).toContain('data-pose="working"');
  });

  it("hear: both listeners side by side with their takes, milliseconds, the cloud tag and a pick", () => {
    const out = draw("stt-compare", STUDIO);
    expect(out).toContain("Whisper base.en");
    expect(out).toContain("OpenAI");
    expect(out).toContain("cloud");
    expect(out).toContain("412 ms");
    expect(out).toContain("968 ms");
    expect(out).toContain("Book the meeting room for Thursday at ten.");
    expect(out).toContain("Picked");
    expect(out).toContain("Use this one");
    expect(out).toContain("Whisper base.en is picked. Press Enter to keep it.");
    expect(out).toContain("Use Whisper");
  });

  it("hear: recording shows the hero as the microphone, labelled stylised, and the bell listening", () => {
    const out = draw("recording", STUDIO);
    expect(out).toContain("Listening — let go to send");
    expect(out).toContain('data-source="mic"');
    expect(out).toContain('data-active="true"');
    expect(out).toContain("Stylised: drawn from your microphone&#x27;s level, not a measured spectrum.");
    expect(out).toContain('data-pose="hearing"');
    expect((out.match(/data-bar=""/g) ?? []).length).toBe(56);
  });

  it("hear: pending, failed and refused takes say what is true", () => {
    expect(draw("transcribing", STUDIO)).toContain("Writing it down...");
    const failed = draw("take-failed", STUDIO);
    expect(failed).toContain("OpenAI refused the stored key (401)");
    expect(failed).toContain("412 ms");
    expect(draw("mic-refused", STUDIO)).toContain("The microphone did not open: Permission denied");
  });

  it("hear: a listener that is not ready is muted and says why, and cannot be picked", () => {
    const out = draw("hear-muted", STUDIO);
    expect(out).toContain('data-muted="true"');
    expect(out).toContain("Whisper small.en is not installed");
    expect(out).toContain("OpenAI refused the stored key");
    expect(out).toContain("No listener is ready yet");
    expect(out).toContain("Pick one");
    // The not-ready key field is offered where the key is the way in.
    expect(out).toContain('aria-label="OpenAI API key"');
    // The hero does not invite a key that cannot record.
    expect(out).not.toContain("Hold Space and speak");
    expect(draw("stt-compare", STUDIO)).toContain("Quiet. Hold Space and speak.");
  });

  it("pick: the hero does not invite Space while her voice is not installed", () => {
    expect(draw("pick", STUDIO)).toContain("Quiet. Press Space or Play to hear her.");
    const pick = fixtures.pick!;
    const absent = { ...pick, kokoro: pick.kokoro && { ...pick.kokoro, state: "absent" as const } };
    const out = renderToStaticMarkup(<VoiceScene model={absent} path={STUDIO} go={go} />);
    expect(out).not.toContain("Press Space or Play");
    expect(out).toContain("Her voice is not installed yet.");
  });

  it("ready: Start talking, the facts, and the chord", () => {
    const out = draw("ready", STUDIO);
    expect(out).toContain("She is ready.");
    expect(out).toContain("Start talking");
    expect(out).toContain("Hears you with");
    expect(out).toContain("Ctrl+Shift+Space");
  });

  it("is not a second main landmark: the stage's scenes are the one <main>", () => {
    // stage/Stage.tsx wraps every scene in <main className="stage__scenes">.
    for (const id of ["engine", "installing", "pick", "stt-compare", "ready"]) {
      expect(draw(id, STUDIO)).not.toMatch(/<main[\s>]/);
    }
  });

  it("the dock shows Back only after the first step, Skip until the last, and Enter always", () => {
    expect(draw("engine", STUDIO)).not.toContain(">Back<");
    expect(draw("pick", STUDIO)).toContain("Back");
    expect(draw("ready", STUDIO)).not.toContain(">Skip<");
    expect(draw("engine", STUDIO)).toContain("Skip");
  });
});

describe("settings", () => {
  it("has Output and Input, Refresh, Reopen studio and the hotkey", () => {
    const out = draw("typical", SETTINGS);
    for (const word of ["Output", "Input", "Refresh", "Reopen studio", "Test take", "Engine home"]) {
      expect(out).toContain(word);
    }
    expect(out).toContain("Talk anywhere: hold");
    expect(out).toContain("Ctrl+Shift+Space");
    expect(out).toContain("voice ready");
  });

  it("output: the engine, an install when it is missing, the voice with Play", () => {
    expect(draw("typical", SETTINGS)).toContain("Play");
    const bare = { ...fixtures.engine!, mode: "settings" as const };
    const out = renderToStaticMarkup(<VoiceScene model={bare} path={SETTINGS} go={go} />);
    expect(out).toContain("Needs install");
    expect(out).toContain("Install now");
    expect(out).toContain("Install Kokoro first.");
  });

  it("input: the listener rail, Whisper's models with their standing, and the install of one", () => {
    const out = draw("typical", SETTINGS);
    expect(out).toContain("Whisper · local");
    expect(out).toContain("OpenAI · cloud");
    expect(out).toContain("tiny.en · 75 MB");
    expect(out).toContain("not installed");
    // A model downloading shows its progress; one that is chosen and missing offers its install.
    expect(draw("heavy", SETTINGS)).toContain("Downloading the voice model");
    expect(draw("heavy", SETTINGS)).toContain("187 MB");
    const idle = { ...fixtures.heavy!, installComponent: null };
    const offered = renderToStaticMarkup(<VoiceScene model={idle} path={SETTINGS} go={go} />);
    expect(offered).toContain("Install small.en");
  });

  it("the key: stored shows Replace and Remove and never the key; a refusal is verbatim", () => {
    const out = draw("typical", SETTINGS);
    expect(out).toContain("Replace");
    expect(out).toContain("Remove");
    expect(out).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(out).not.toContain('type="text"');
    const heavy = draw("heavy", SETTINGS);
    expect(heavy).toContain("OpenAI refused the stored key (401 invalid_api_key)");
    expect(heavy).toContain("validator_failed: the key does not look like an OpenAI key");
  });

  it("the key: absent shows a password field that is not a text field", () => {
    const bare = { ...fixtures.engine!, mode: "settings" as const };
    const out = renderToStaticMarkup(<VoiceScene model={bare} path={SETTINGS} go={go} />);
    expect(out).toContain('type="password"');
    expect(out).toContain('autoComplete="off"');
    expect(out).toContain("Save key");
    expect(out).toContain("Sealed on this machine");
  });

  it("the test take names the listener, and says when it is not ready", () => {
    expect(draw("typical", SETTINGS)).toContain("One take through Whisper base.en.");
    expect(draw("heavy", SETTINGS)).toContain("Whisper small.en is not ready yet.");
  });
});

describe("the scene moves the person where the model's own act ends", () => {
  it("finishing the studio lands in settings, reopening it lands in the studio", () => {
    const moves: unknown[] = [];
    const calls: string[] = [];
    const model = {
      ...fixtures.ready!,
      actions: { ...fixtures.ready!.actions, finish: () => void calls.push("finish"), reopenStudio: () => calls.push("reopen") },
    };
    const wrapped = withMoves(model, (to) => moves.push(to));
    wrapped.actions.finish();
    wrapped.actions.reopenStudio();
    expect(calls).toEqual(["finish", "reopen"]);
    expect(moves).toEqual([SETTINGS, STUDIO]);
  });

  it("a refused finish is said on the ready step, where Enter was pressed", () => {
    const out = renderToStaticMarkup(
      <VoiceScene model={{ ...fixtures.ready!, finishError: "the store is read-only" }} path={STUDIO} go={go} />,
    );
    expect(out).toContain("Not kept: the store is read-only. The studio stays open; press Enter to try again.");
  });

  it("finishing lands in settings only once the row is stored; a refusal stays in the studio", async () => {
    const moves: unknown[] = [];
    const finishing = (stored: boolean) => ({
      ...fixtures.ready!,
      actions: { ...fixtures.ready!.actions, finish: () => Promise.resolve(stored) },
    });
    withMoves(finishing(false), (to) => moves.push(to)).actions.finish();
    await Promise.resolve();
    expect(moves).toEqual([]);
    withMoves(finishing(true), (to) => moves.push(to)).actions.finish();
    await Promise.resolve();
    expect(moves).toEqual([SETTINGS]);
  });
});

describe("the microphone's hero is the existing waveform's input, not a loop of its own", () => {
  it("is silent at level 0, grows with the level and reuses one buffer", () => {
    let level = 0;
    const read = micBins(() => level);
    const quiet = Array.from(read());
    expect(quiet.every((v) => v === 0)).toBe(true);
    level = 0.8;
    const loud = read();
    expect(Math.max(...loud)).toBeGreaterThan(100);
    expect(read()).toBe(loud);
    level = 5;
    expect(Math.max(...read())).toBeLessThanOrEqual(255);
  });
});
