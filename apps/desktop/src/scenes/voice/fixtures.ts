/**
 * The Voice scene's fixtures — README section 3.5, ADR 0028 and 0087.
 *
 * The module's own fixtures, unchanged (the studio's moments, settings, the daemon states), plus
 * the live moments a still model could not show: a take recording, a voice playing, the two
 * listeners mid-take, one refused, and a comparison where neither is ready. Each extra is built by
 * the module's own `model()` (the selector), so a fixture cannot say something the selector would
 * not, and its sentences and dock are derived, never typed twice.
 */
import { fixtures as base, config, model, studio } from "@/modules/voice/fixtures";
import { HEAR_IDLE, type HearState, type PreviewState, type VoiceModel } from "@/modules/voice/model";

const compare = base["stt-compare"]!;
const heavy = base.heavy!;

/** The hear step with everything before it answered, as `stt-compare` has it. */
function hearing(hear: HearState, over: Parameters<typeof model>[0] = {}): VoiceModel {
  return model({ studioDone: false, studio: compare.studio, hear, ...over });
}

const playing: PreviewState = { phase: "playing", voice: "af_heart", error: null };

const extras: Record<string, VoiceModel> = {
  /** A take is being recorded: the hero is the microphone, the bell is listening. */
  recording: hearing({ recording: true, micError: null, takes: {} }),
  /** Both listeners are writing it down. */
  transcribing: hearing({
    recording: false,
    micError: null,
    takes: {
      whisper: { state: "pending", text: "", ms: null, error: null },
      openai: { state: "pending", text: "", ms: null, error: null },
    },
  }),
  /** One heard, one refused: both stay readable. */
  "take-failed": hearing({
    recording: false,
    micError: null,
    takes: {
      whisper: { state: "done", text: "Book the meeting room for Thursday at ten.", ms: 412, error: null },
      openai: { state: "failed", text: "", ms: null, error: "engine_error: OpenAI refused the stored key (401)" },
    },
  }),
  /** Neither listener is ready (the heavy fixture's config): the columns are muted and say why. */
  "hear-muted": hearing(HEAR_IDLE, { config: heavy.config, studio: { ...compare.studio, stt: null } }),
  /** The microphone refused: the reason, verbatim. */
  "mic-refused": hearing({ recording: false, micError: "The microphone did not open: Permission denied", takes: {} }),
  /** Her voice is playing: the hero is her real spectrum. */
  speaking: model({
    studioDone: false,
    config: config({ ready: false, reason: "Whisper base.en is not installed." }),
    studio: studio({ step: "pick", done: ["engine", "install"], engineChosen: true, wokeUp: true, voice: "af_heart" }),
    preview: playing,
  }),
};

export const fixtures: Record<string, VoiceModel> = { ...base, ...extras };

/** `typical` first: it is what the preview harness opens when no fixture is named. */
export const fixtureIds: readonly string[] = [
  "typical",
  ...Object.keys(base).filter((id) => id !== "typical"),
  ...Object.keys(extras),
];
