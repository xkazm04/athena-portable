/**
 * The microphone's remembered answer — ADR 0221, the voice-io rule that a refusal is a designed
 * state, remembered, with the platform's own way back.
 *
 * The platform already knows whether this app may hear: `navigator.permissions` says so without
 * raising a prompt, and tells a listener when the person changes it. This file reads that answer,
 * follows it, and turns a refusal into the sentence that undoes it. It is loaded by the Setup hook
 * only (`index.ts`, itself loaded with the depths that draw it), so Main's first frame never
 * carries it. Like `modules/voice/mic.ts` it imports nothing from `lib/voice` at run time (ADR
 * 0192); the standing is a type.
 */
import type { MicStanding } from "@/lib/voice";

/** What the platform remembers: `recalled` is false where it holds no answer yet (or cannot say). */
export interface MicPermission {
  standing: MicStanding;
  recalled: boolean;
}

export type MicPlatform = "windows" | "macos" | "other";

/** The platform's permission state as a standing; `prompt` and no answer are both unknown. */
export function micPermissionOf(state: PermissionState | undefined): MicPermission {
  return state === "granted" || state === "denied"
    ? { standing: state, recalled: true }
    : { standing: "unknown", recalled: false };
}

/** The microphone's permission status, or `null` where the API is missing or refuses the name. Never prompts. */
export async function queryMic(permissions: Pick<Permissions, "query"> | undefined): Promise<PermissionStatus | null> {
  try {
    return (await permissions?.query({ name: "microphone" as PermissionName })) ?? null;
  } catch {
    return null;
  }
}

/** What the platform remembers about the microphone, read without asking the person anything. */
export async function readMicPermission(permissions: Pick<Permissions, "query"> | undefined): Promise<MicPermission> {
  return micPermissionOf((await queryMic(permissions))?.state);
}

/** Hear every change the person makes to the answer (the OS switch, the prompt); returns the way to stop. */
export function watchMicPermission(status: PermissionStatus, onChange: (standing: MicStanding) => void): () => void {
  const heard = () => onChange(micPermissionOf(status.state).standing);
  status.addEventListener("change", heard);
  return () => status.removeEventListener("change", heard);
}

/** The platform, from the user agent: only the re-grant path differs between them. */
export function micPlatform(userAgent: string): MicPlatform {
  if (/Windows/.test(userAgent)) return "windows";
  return /Macintosh|Mac OS X/.test(userAgent) ? "macos" : "other";
}

/**
 * How a refusal is undone on this platform, in plain words; empty for any other standing. On
 * Windows two answers can refuse: the system switch, and the one Athena's own prompt keeps for
 * this app (the switch does not undo that one), so both are named.
 */
export function micRemedy(standing: MicStanding, platform: MicPlatform): string {
  if (standing !== "denied") return "";
  if (platform === "windows")
    return "Turn it on in Settings > Privacy & security > Microphone, with desktop apps allowed to use it. If you refused Athena's own microphone prompt, press Check again and choose Allow when she asks.";
  if (platform === "macos") return "Turn it on for Athena in System Settings > Privacy & Security > Microphone, then press Check again.";
  return "Turn it on for Athena in the system's privacy settings for the microphone, then press Check again.";
}

// -- what the Setup hook loads with `import()`, so none of this is first-frame code ------------

/** The hook's microphone answer: the standing, the words beside it, and how to undo a refusal. */
export interface MicAnswer {
  standing: MicStanding;
  detail: string;
  remedy?: string;
}

const here = (): MicPlatform => micPlatform(typeof navigator === "undefined" ? "" : navigator.userAgent);

/**
 * A press's answer with its remedy: a refusal leads with how to undo it, and the browser's own
 * words follow for whoever wants them. Any other answer is the press's own.
 */
export function answerOf(answer: MicAnswer): MicAnswer {
  const remedy = micRemedy(answer.standing, here());
  return remedy ? { standing: answer.standing, detail: `${remedy} (${answer.detail})`, remedy } : answer;
}

/**
 * Seed the answer from what the platform remembers, then follow every change the person makes to
 * it; resolves to the way to stop. A change keeps a press's words when the standing is the same (a
 * granted label stays); a refusal's words are its remedy. Without the API nothing is touched.
 */
export async function followMic(set: (next: (now: MicAnswer) => MicAnswer) => void): Promise<() => void> {
  const status = await queryMic(typeof navigator === "undefined" ? undefined : navigator.permissions);
  if (!status) return () => {};
  const hear = (standing: MicStanding) => {
    const remedy = micRemedy(standing, here());
    set((now) => (now.standing === standing ? now : { standing, detail: remedy, remedy }));
  };
  if (status.state !== "prompt") hear(status.state);
  return watchMicPermission(status, hear);
}
