# 0196. The microphone is a choice, made where she says it sounded silent

Date: 2026-10-25

## Context

Every capture in the desktop app opened the system default input: push-to-talk
(`stores/voice.ts`), the studio's take and the settings' test take (`modules/voice/audio.ts`'s
`TakeRecorder`) all called `openMicrophone` (`lib/voice.ts`), and it asked `getUserMedia` for
`{channelCount, echoCancellation, noiseSuppression}` with no device. Nothing in the app listed or
chose an input. A laptop with a headset, a dock with a webcam microphone or a virtual audio device
often has a default that is not the microphone the person speaks into. That person heard "your
microphone sounded silent (-72 dB), check the input in Voice settings", and Voice settings had only
a Test take whose meter stayed flat. The studio made it worse: a silent take went to every engine,
and each column said "(heard nothing)", which blamed the engines for the microphone.

The registry's voice-io standard (stt-pipeline) holds that a flat meter localizes the fault to the
audio path, usually the wrong input device. Its voice-ux-integration technique holds that a degraded
affordance names the rung that failed and the single next action.

## Decision

1. **One `voice_input` settings row** (`SETTING_KEYS.voiceInput`) holds the browser's device id of
   the chosen input. An empty row or no row means the system default. Both windows read it: Main's
   Voice settings writes it, and her window's push-to-talk reads it at every press.
2. **`openMicrophone(apis, onChunk, deviceId?)`** asks for `deviceId: {exact}` with the same
   processing. With no device the constraints are exactly what they were. A stored device is a
   reference, not a promise. If the exact device fails, the default is asked once and the session
   reports `fellBack`. If the default fails too, its refusal is the one thrown. The session also
   carries the track's `label`.
3. **The picker is Voice settings' own** (`modules/voice/mic.ts`): `listMicrophones` lists audio
   inputs only and leaves out the browser's `default` and `communications` aliases. An input with no
   label is named by position ("Microphone 2"), never dropped. `micView` shows a stored device the
   browser no longer lists as the system default with one note. A small store keeps the list and the
   choice. `MicPicker` (`pieces.tsx`) sits in a Microphone row above Test take, so the meter below
   shows which input moves. It reads the list again after every take, because the browser names
   inputs only once the microphone has been granted.
4. **A silent take never reaches an engine.** A take whose peak is under `LEVEL_FLOOR_DB` is caught
   in `live.ts` with "This microphone sounded silent (no level). Pick another input above.".
5. **The silent utterance names the device and the act.** The sentence is now "your microphone
   (Realtek Array) sounded silent (-72 dB), choose another input in Voice settings".
6. **None of it rides the first frame.** `modules/voice/live.ts`, `model.ts` and `audio.ts` are in
   Main's first-paint chunk, because they are shared by two lazy depths. So `mic.ts` is loaded with
   `import()` from `live.ts` and statically only by the settings' pieces. It imports neither
   `lib/voice` (the level floor is an argument; see ADR 0192 for the chunk split that import causes)
   nor React: the `useSyncExternalStore` hook lives in `pieces.tsx`. Importing React from the lazy
   module re-split the React chunks (+240 B). The choice is a store of its own rather than fields
   of `useVoiceSetup` for the same reason. As first written inside the first frame the change was
   +704 B, against about 230 B of headroom. It lands at +221 B, 10 B under the ceiling.

## Consequences

- A person whose default input is wrong fixes it in one tap where the app pointed them, and every
  capture (push-to-talk, studio, test take) honours it. An unplugged device degrades to the default
  and the picker says so.
- The studio's comparison no longer blames the engines for a silent microphone. Its sentence says
  "above", and the picker is above the take in Voice settings. The studio itself has no picker
  (the studio file is another context's), so that word is wrong there. Recorded, not fixed here.
- No consent or gate change: ids and labels stay in the local settings row.
- The first frame has 10 B of headroom left. The next first-frame addition needs the owner or a
  further move out.
- Tests: `lib/voice.test.ts` ("the microphone the person chose"), `modules/voice/live.test.ts`,
  `model.test.ts`, `pieces.test.tsx` and `stores/voice.test.ts`.
