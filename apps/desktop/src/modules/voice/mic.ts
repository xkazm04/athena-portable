/**
 * The microphone the person chose — README section 3.1, ADR 0028 and the microphone ADR.
 *
 * Every capture (push-to-talk, the studio's take, the settings' test take) opens the device stored
 * in the `voice_input` row, or the system default when none is. This file is the part of that
 * choice only Voice settings and a finished take need: the list of inputs, the picker's view, and
 * the level check that keeps a silent take away from the engines. It is loaded with `import()` by
 * `live.ts` and statically by the settings' pieces, so Main's first frame never carries it — which
 * is also why the choice is a small store of its own here rather than fields of `useVoiceSetup`. It does
 * not import `lib/voice`: importing that from a lazy module makes the bundler split the first-frame
 * module into chunks of its own (ADR 0192), so the level floor is an argument.
 */
import { hasShell } from "@/lib/ipc";
import { SETTING_KEYS, settingRead, settingWrite } from "@/lib/store";

/** One audio input the person can choose, by the browser's id and a name to show. */
export interface MicDevice {
  id: string;
  label: string;
}

/**
 * The audio inputs, in the browser's order. Video devices, the browser's own "default" and
 * "communications" aliases (the picker offers the system default itself) and a device with no id
 * (it cannot be asked for) are left out. A device with no label — the browser hides names until
 * the microphone was granted once — is named by its position, never dropped: a person can still
 * pick it and watch the meter.
 */
export async function listMicrophones(enumerate: () => Promise<readonly MediaDeviceInfo[]>): Promise<MicDevice[]> {
  const inputs = (await enumerate()).filter(
    (d) => d.kind === "audioinput" && !!d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications",
  );
  return inputs.map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

/** What the picker shows: the inputs, which one is chosen, its name, and why it is not in use. */
export interface MicView {
  options: MicDevice[];
  /** The chosen device when it is connected; `null` is the system default. */
  chosen: string | null;
  label: string;
  note: string | null;
}

/**
 * The microphone picker's view. A stored device that the browser no longer lists is the system
 * default in use, said once under the picker; with no list yet nothing can be said about it.
 */
export function micView(mics: readonly MicDevice[] | undefined, choice: string | null | undefined): MicView {
  const options = [...(mics ?? [])];
  const found = options.find((m) => m.id === choice) ?? null;
  return {
    options,
    chosen: found?.id ?? null,
    label: found?.label ?? "System default",
    note:
      choice && !found && options.length > 0
        ? "The microphone you chose is not connected; using the system default."
        : null,
  };
}

/** The loudest sample of a take in dBFS; `-Infinity` for a take of pure zeros. */
export function peakDb(pcm: Int16Array): number {
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 1) peak = Math.max(peak, Math.abs(pcm[i]));
  return peak === 0 ? -Infinity : 20 * Math.log10(peak / 32768);
}

/**
 * The silent take's last sentence, true where the picker sits above the take (Voice settings). A
 * surface with no picker (the studio) swaps it for one that names where the picker is.
 */
export const PICK_ABOVE = "Pick another input above.";

/**
 * What a take whose peak is under `floorDb` (`lib/voice`'s `LEVEL_FLOOR_DB`) says, or `null` for a
 * take a listener can write down. Silence is the input's fault, so it names the microphone, not
 * the engines.
 */
export function silentTake(pcm: Int16Array, floorDb: number): string | null {
  const db = peakDb(pcm);
  if (db >= floorDb) return null;
  const level = Number.isFinite(db) ? `${Math.round(db)} dB` : "no level";
  return `This microphone sounded silent (${level}). ${PICK_ABOVE}`;
}

/** What the voice setup store asks of the microphone choice; `LIVE_MIC` is the real one. */
export interface MicSeam {
  /** The stored `voice_input` row: a device id, `""` or `null` for the system default. */
  read: () => Promise<string | null>;
  write: (id: string | null) => Promise<void>;
  /** The audio inputs the browser lists; empty where it lists none. */
  list: () => Promise<MicDevice[]>;
  silentTake: typeof silentTake;
}

export const LIVE_MIC: MicSeam = {
  read: async () => (hasShell() ? await settingRead<string>(SETTING_KEYS.voiceInput) : null),
  write: async (id) => {
    // A patch cannot carry null, so the system default is stored as the empty string.
    if (hasShell()) await settingWrite(SETTING_KEYS.voiceInput, id ?? "");
  },
  list: async () =>
    typeof navigator !== "undefined" && typeof navigator.mediaDevices?.enumerateDevices === "function"
      ? listMicrophones(() => navigator.mediaDevices.enumerateDevices())
      : [],
  silentTake,
};

// -- the choice, shared by the picker and every take in this window ---------------------------

export interface MicState {
  mics: MicDevice[];
  /** The device every take opens; `null` is the system default. */
  choice: string | null;
}

let seam: MicSeam = LIVE_MIC;
let state: MicState = { mics: [], choice: null };
/** The row, read once per window: a choice made here replaces it. */
let reading: Promise<unknown> | null = null;
const listeners = new Set<() => void>();

function put(next: Partial<MicState>): void {
  state = { ...state, ...next };
  for (const f of [...listeners]) f();
}

/** For tests: a fake row and device list, and a fresh choice (`null`: the live ones). */
export function setMicSeam(next: MicSeam | null): void {
  seam = next ?? LIVE_MIC;
  state = { mics: [], choice: null };
  reading = null;
}

/** The device a take opens: the stored row, read once, then whatever was chosen since. Never rejects. */
export async function micChoice(): Promise<string | null> {
  reading ??= seam.read().then(
    (id) => put({ choice: id || null }),
    (e: unknown) => console.error(`[voice] microphone row unreadable: ${String(e)}`),
  );
  await reading;
  return state.choice;
}

/** Ask the browser for its inputs again (their names appear once the microphone was granted). */
export async function refreshMics(): Promise<void> {
  put({ mics: await seam.list().catch(() => state.mics) });
}

/** Choose the input every take and every press opens, and store it as the `voice_input` row. */
export async function chooseMic(id: string | null): Promise<void> {
  reading = Promise.resolve();
  put({ choice: id });
  await seam.write(id).catch((e: unknown) => console.error(`[voice] microphone row not stored: ${String(e)}`));
}

/** Be told when the inputs or the choice change (the picker's `useSyncExternalStore`). */
export function subscribeMics(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The inputs and the choice as they stand; a new object on every change. */
export const micState = (): MicState => state;
