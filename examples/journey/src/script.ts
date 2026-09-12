/**
 * docs/demo.md section 1 — the script, and the clock the take runs on.
 *
 * The narration is written before anything is recorded, so the script is the input and the video
 * is paced to it, never the other way round. This file is the only place that knows how long a
 * beat lasts: `take/audio/durations.json` when `narrate.mjs` has measured the real clips, and the
 * script's own words-per-second estimate when it has not. A beat is then held for
 * `max(clip, settle) + breath`, measured from the moment its actions *start*.
 *
 * The caption is derived here too, and once: the speaker's name is part of what the audience
 * reads for Mira and Athena and is absent for the narrator, and a second rendering of that rule
 * somewhere else would be a second script.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** `examples/journey/` — the package root, which every path in the take is relative to. */
export const PACKAGE_ROOT: string = resolve(here, "..");

/** Where the take's own output goes: the video, the offsets, and the narration clips. */
export const TAKE_DIR: string = resolve(PACKAGE_ROOT, "take");
export const DURATIONS_PATH: string = resolve(TAKE_DIR, "audio", "durations.json");

export type Voice = "narrator" | "mira" | "athena";

export interface Beat {
  readonly id: string;
  /** `ledgerbox`, `hirelane`, `tidycrm`, or `record` for act 4's overlay. */
  readonly app: string;
  readonly voice: Voice;
  readonly line: string;
  /** The "on screen" column of docs/demo.md section 2 — what the beat has to show. */
  readonly screen: string;
  readonly settle_ms: number;
  readonly estimate_s: number;
}

export interface Act {
  readonly id: string;
  readonly title: string;
  readonly estimate_s: number;
  readonly beats: readonly Beat[];
}

export interface Script {
  readonly title: string;
  readonly language: string;
  readonly words_per_second: number;
  readonly breath_ms: number;
  readonly acts: readonly Act[];
}

/** Where the script is. `JOURNEY_SCRIPT` may be absolute or relative to the package root. */
export function scriptPath(): string {
  const named = process.env.JOURNEY_SCRIPT ?? "script/journey.en.json";
  return isAbsolute(named) ? named : resolve(PACKAGE_ROOT, named);
}

export function loadScript(path = scriptPath()): Script {
  if (!existsSync(path)) throw new Error(`no script at ${path}; set JOURNEY_SCRIPT`);
  return JSON.parse(readFileSync(path, "utf8")) as Script;
}

/** Every beat of every act, in order — the take plays exactly this list and nothing else. */
export function beatsOf(script: Script): Beat[] {
  return script.acts.flatMap((act) => [...act.beats]);
}

/**
 * The measured clip lengths, when narration has been generated.
 *
 * `{ "<beat id>": <milliseconds> }`, written by `scripts/narrate.mjs`. Absent is the ordinary
 * case for a rehearsal: the take then paces itself from the script's own words-per-second, which
 * is what docs/demo.md section 2 states the estimates are.
 */
export function loadDurations(path = DURATIONS_PATH): Record<string, number> {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const measured: Record<string, number> = {};
  for (const [id, value] of Object.entries(parsed)) {
    const ms = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(ms) && ms > 0) measured[id] = ms;
  }
  return measured;
}

/** How long the voice takes over this beat: the measured clip, or the script's own estimate. */
export function clipMsOf(beat: Beat, script: Script, measured: Record<string, number>): number {
  const known = measured[beat.id];
  if (known !== undefined) return known;
  const words = beat.line.split(/\s+/).filter((word) => word.length > 0).length;
  return Math.round((words / script.words_per_second) * 1000);
}

/** `max(clip, settle) + breath`, from the moment the beat's actions start. */
export function holdMsOf(beat: Beat, script: Script, measured: Record<string, number>): number {
  return Math.max(clipMsOf(beat, script, measured), beat.settle_ms) + script.breath_ms;
}

/**
 * What the audience reads under the picture.
 *
 * The narrator is the film talking about itself and is left bare; Mira and Athena are two people
 * in a conversation and the audience has to be able to tell which of them is speaking without
 * working it out from the voice alone (docs/demo.md section 1, "Voices").
 */
export function captionOf(beat: Beat): string {
  if (beat.voice === "mira") return `Mira: ${beat.line}`;
  if (beat.voice === "athena") return `Athena: ${beat.line}`;
  return beat.line;
}
