/**
 * The Adopt studio's deps in the running app — ADR 0097, README section 3.5.
 *
 * The client asks the daemon store for its endpoint at every call (`endpoint()` answers `null`
 * until `/health` said ready). Dictation is store-free: a held take through the voice module's
 * recorder, transcribed by `POST /voice/transcribe` with the listener the person chose; her
 * questions are spoken through `POST /voice/preview` with the chosen voice. Built once per mount
 * of the Chores scene.
 */
import { AdoptApi } from "@/lib/adopt-client";
import {
  VoiceSetupApi,
  refusalText,
  type VoiceConfig,
} from "@/lib/voice-setup";
import { PreviewPlayer, TakeRecorder } from "@/modules/voice/audio";
import { readySttEngines } from "@/modules/voice/model";
import { endpoint, useDaemon } from "@/stores/daemon";

import type { AdoptDeps, Dictation } from "./deps";

const at = () => endpoint(useDaemon.getState());

function liveDictation(): Dictation {
  const recorder = new TakeRecorder(() =>
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof AudioContext !== "undefined"
      ? {
          getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
          audioContext: () => new AudioContext(),
        }
      : null,
  );
  let player: PreviewPlayer | null = null;
  const config = async (): Promise<VoiceConfig | string> => {
    const e = at();
    if (!e) return "The daemon is not running";
    const out = await new VoiceSetupApi(e).config();
    return out.ok ? out.value : refusalText(out);
  };
  return {
    check: async () => {
      if (
        typeof navigator === "undefined" ||
        typeof navigator.mediaDevices?.getUserMedia !== "function"
      )
        return "This window offers no microphone";
      const c = await config();
      if (typeof c === "string") return c;
      return readySttEngines(c).includes(c.stt.engine)
        ? null
        : "Set up a listener in Mind → Voice first";
    },
    start: () => recorder.start(),
    stop: async () => {
      const pcm = await recorder.stop();
      if (pcm.length === 0)
        return {
          ok: false,
          reason: "The take was empty. Hold a little longer.",
        };
      const e = at();
      if (!e) return { ok: false, reason: "The daemon is not running" };
      const api = new VoiceSetupApi(e);
      const c = await api.config();
      if (!c.ok) return { ok: false, reason: refusalText(c) };
      const out = await api.transcribe(c.value.stt.engine, pcm);
      return out.ok
        ? { ok: true, text: out.value.text }
        : { ok: false, reason: refusalText(out) };
    },
    canSpeak: async () => {
      if (typeof AudioContext === "undefined")
        return "This window cannot play sound";
      const c = await config();
      if (typeof c === "string") return c;
      const kokoro = c.engines.find((x) => x.id === "kokoro");
      return kokoro?.state === "ready"
        ? null
        : "Set up her voice in Mind → Voice first";
    },
    speak: async (text) => {
      const e = at();
      if (!e) return;
      const api = new VoiceSetupApi(e);
      const c = await api.config();
      if (!c.ok) return;
      const clip = await api.preview(text, c.value.tts.voice);
      if (!clip.ok) return;
      player ??= new PreviewPlayer(() => new AudioContext());
      await player.play(clip.value.pcm, clip.value.sampleRate);
    },
  };
}

export function liveAdoptDeps(): AdoptDeps {
  return { client: new AdoptApi(at), dictation: liveDictation() };
}
