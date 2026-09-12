# 0020. Push-to-talk is a held key in the chrome, and a spoken turn lands in the panel

Date: 2026-09-12

## Status

Accepted. Implements the plan's c32 (README §3.1); builds on ADR 0019 (voice is a socket on the
daemon's port), ADR 0013 (the module-first window) and ADR 0014 (the relay).

## Context

The daemon's `/voice` exists (ADR 0019). The shell has to capture a microphone, stream it, play
the reply, and show the user what was heard and said — without a second chat surface, a second
run loop, or a second way to answer a card. Four things had to be decided: where the key lives,
where the microphone is captured, where the transcript goes, and who runs a host tool a spoken
turn calls.

## Decision

**The key is in the module bar, and its hotkey is the chrome webview's.** A hold-to-talk control
sits in the bar's trailing group beside the theme and window buttons, so it is on screen on every
module. Down is `start`, up is `stop`, with the pointer or with Space held. `Ctrl+Space`, held,
mirrors it for as long as the chrome webview has the keyboard. It is *not* an OS-global shortcut
in this commit: that is a Tauri plugin, a Cargo dependency, a capability and a `lib.rs` edit,
which the hands commit is touching in parallel, and the demo holds the key in the bar. When the
global shortcut lands it registers the same `press`/`release` pair and nothing else changes.

**The microphone is captured in the webview, as PCM16 at 16 kHz.** `getUserMedia` feeds a
`ScriptProcessorNode` and the buffer is decimated to 16 kHz by nearest sample and sent as one
binary frame per callback. The worklet alternative needs a module URL the `tauri://` protocol makes
awkward, and 85 ms of buffer on a push-to-talk key is not felt. The Setup wizard gains a
microphone passage that asks once and releases at once, so the permission prompt lands in the
setup act and not in the middle of act 2; it is never required, because a machine with no
microphone types its turns.

**A spoken turn lands in the panel's transcript and cards.** The voice store renders nothing. It
writes the final transcript as the user's line, the deltas as Athena's, the tool rows as the run
loop writes them, and a decision card into the same `cards` the panel's buttons answer. One
table, two ways to say yes: the button over HTTP, the word over the socket.

**The voice store runs the page's tools the way the run loop does.** A host `tool.call` with no
`tool.result` behind it in the same turn is run on the focused page through the relay and answered
with `tool_result`; a call the daemon already settled — a gated one, refused pending approval — is
not. The one refusal the store makes on its own is the run loop's: a call whose `host:<app_id>` is
not the app the focused page declared. The two loops are two because the socket carries the
answer inside the connection while HTTP carries it in the next request's frame; what they refuse
and what they run is the same.

**Barge-in is the daemon's decision and the player's job.** The player schedules each chunk at the
end of the previous one, tagged by generation. `voice.stopped` with `barge_in` drops that
generation; pressing the key over a reply drops it locally as well, before the daemon has said so,
because a second of stale audio between the two is the difference between "she stopped" and "she
talked over me".

**Every browser API is an argument.** `WebSocket`, `getUserMedia`, `AudioContext` and the relay
are handed to the store as `VoiceDeps`, so the headless test drives the real framing, the real
resampling and the real event handling against fakes, and `vitest` never needs a window.

## Consequences

- `lib/events.ts` learns the `voice` family, the same three kinds `contracts/channel.py` has.
- `lib/voice.ts` is the codec and the two devices; `stores/voice.ts` is the loop; the control is
  `components/PushToTalk.tsx`; the app root starts the store and renders the key.
- `stores/voice.test.ts` covers: the key lit only when `/health` lists `/voice`; `start`, audio,
  `stop`; no page open; the transcript landing in the panel; an unsettled host call run and
  answered, a settled one not; a foreign app refused; a turn error; playback and `barge_in`; a
  press over a reply; the socket closing mid-turn. `lib/voice.test.ts` covers the resampler, the
  byte order, the audio frame and the subprotocol.
- Verified by hand: none in this commit. The provider backend needs a key and the microphone
  needs a device and a WebView2 permission; both are the act 2 rehearsal's, and the act 2 command
  remains on a key in the demo script as the plan requires.
- The OS-global shortcut is the one item of c32 deferred, named above with what it takes.
