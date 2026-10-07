# 0028. Athena's voice is set up in a studio, and she speaks locally by default

Date: 2026-10-07

Extends [0019](0019-voice-is-a-socket-on-the-daemons-port-and-a-transport-around-the-one-lane.md):
the voice socket stays one transport around the one lane. What changes is where its backend comes
from: a person's choice, made in a module, held by the daemon. It no longer depends on whichever
environment variable the shell happened to inherit.

## Context

Voice existed only when `OPENAI_API_KEY` was set in the environment the desktop shell was started
from. With no key there was no `/voice` at all, and nothing inside the app could change that. The
owner asked for voice to be set up the way Personas sets it up: a guided studio that defaults to
local Kokoro speaking with the Heart voice, and lets the person choose the provider. The setup
experience should also become the standard in the registry's `voice-io` subject.

What the scouts found:

- **Personas** runs Kokoro as `sherpa-onnx-offline-tts.exe`, launching it once per clip, with
  files in a per-user engine home (`~/.personas/companion-tts`). That home was already installed
  on the owner's machine. Its first-run flow (the "Table" studio that won its design contest) has
  four steps: choose the engine, install it, pick a voice by ear (the first preview greets you and
  selects the voice), then try the transcribers side by side.
- **The daemon is a one-file PyInstaller binary that excludes numpy.** Any Python Kokoro package
  needs numpy and onnxruntime.
- **`voice-io` already says:**
  - the stored preference is a reference, not a promise;
  - engines report absent, broken or ready;
  - comparison is done by ear;
  - cloud is never a silent fallback.
  It does not yet say what the setup experience is.

## Decision

1. **Speaking is local Kokoro, run by the daemon, from the shared engine home.**
   - A new backend calls the same sherpa-onnx executable as Personas, through stdlib
     `subprocess` and `wave`. The core stays stdlib-only and the sidecar gains nothing.
   - The engine home is Personas' own (`PERSONAS_HOME`, else `~/.personas/companion-tts`), so a
     machine that has one app installed has both. An install lock stops the two apps installing
     at once.
   - The voice in v1 is `af_heart` (speaker 3 of `kokoro-multi-lang-v1_0`), pinned by a test.
   - To hide the per-sentence model reload, sentence n+1 is synthesized while sentence n plays.
   - Rejected: a resident `kokoro-onnx` extra (numpy in the sidecar, plus an install separate from
     Personas'). Rejected: hosting Kokoro in the Rust shell (the daemon would need a channel back
     to the shell).
2. **Hearing is a separate choice.** It is either local whisper.cpp from the shared home, or
   OpenAI with a key sealed by the connectors seal, labelled as cloud. The backend that `/voice`
   uses is composed from one speaker and one listener.
3. **The daemon holds the choice and applies it live.** `ATHENA_HOME/voice/config.json` is the
   single source. The defaults are Kokoro/Heart for speaking and Whisper `base.en` for hearing.
   - `/voice` is always registered. A start frame refuses with the reason while the chosen
     engines are not ready.
   - New routes: `GET`/`PUT /voice/config`, `POST /voice/preview`, `POST /voice/transcribe`,
     `POST`/`GET /voice/install`, and `PUT`/`DELETE /voice/key`.
   - The UI decides whether voice is available from the config's `ready` field, not from the
     health route's socket list.
   - Download URLs are constants in the daemon. The client never supplies one.
4. **A Voice module, studio first.**
   - The first visit runs the studio: her voice (engine, install, pick by ear), your voice (one
     take, every ready transcriber side by side with its latency), then ready.
   - Answered steps fold into receipts that reopen them.
   - Later visits open a two-column Output and Input settings page. "Run the studio again" is
     the way back in.
5. **The registry gains `voice-setup-experience`** under `voice-io`, with Personas and Athena as
   its applications.

## Consequences

- Voice no longer depends on how the shell was started. A machine with no key and no Personas
  needs one ~400 MB download to speak and one Whisper model to hear.
- The daemon now runs external executables it did not ship. It probes them before use and reports
  `broken` with the reason when they fail.
- The first sentence of a live reply still waits about 1.7 s for Kokoro's model to load. A
  resident engine is future work, governed by `voice-io`'s real-time synthesis budget.
- Only one speaking provider is offered in v1. Adding another (OpenAI, Pocket TTS) means one
  adapter and one catalog entry; the flow does not change.
