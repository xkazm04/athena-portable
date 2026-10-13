# 0091 — The Voice scene has one frame loop, and reopens a finished studio on arrival

## Context

Porting the Voice module into the depth scene (ADR 0087, 0090) raised two choices a later reader
could question. The module drew up to three live meters at once (her waveform, the orb's glow, the
microphone's bar), each on its own `requestAnimationFrame` loop, while ADR 0089 budgets at most one
loop in the window and none when nothing moves. And the module's mood (studio or settings) came
from whether the studio had been finished, while a depth is chosen by the path: `voice/studio`
must be the studio even for a person who finished it, and the live wiring behaves differently
there (a take goes to every ready listener only while the studio is reopened).

## Decision

1. **One loop at a time.** The studio's hero is the module's own `Waveform`. While her voice plays
   it reads her spectrum; while a take records it reads the microphone's level, shaped by a fixed
   envelope into bins and labelled "Stylised: drawn from your microphone's level, not a measured
   spectrum". The orb's level glow is not drawn separately, and the studio's hold button has no meter
   of its own. Settings keeps the module's `MicMeter` on the Test take (no waveform is running there
   while a take records). No new script runs per frame: the envelope function is only called by the
   waveform's existing loop, and a test asserts that no fixture at rest requests a frame and that
   each live moment requests exactly one loop and cancels it when it ends.
2. **The path decides the place; arriving at the studio reopens it.** `voice/studio` always draws
   the studio and `voice/settings` always settings. When the person arrives at the studio and the
   module says it was finished, the scene calls the module's own `reopenStudio` once per arrival
   (after the "studio done" row has been read), so the wiring behaves as the old "Run the studio
   again" did. Finishing lands in settings and reopening from settings lands in the studio; the view
   adds that move to the model's own action and nothing else.
3. **The studio's keys live on the document.** The stage focuses its own layer when a move ends, so
   a key handler on a child element would never see a key. The handler yields to text fields, to a
   button's own Enter and Space, to chords, and to Escape (the stage's), ignores a layer that is
   leaving (`inert`), and stops a take that is still recording when the window loses focus or the
   studio goes away.

## Consequences

- The level meter is no longer a separate visual; the drawing of her voice and of the microphone
  share one shape. The parity matrix records this as `changed:`.
- A person who finished the studio and opens `voice/studio` resets the studio's own state
  (nothing the daemon owns changes).
- The module's old view is untouched and keeps its three meters until the cutover deletes it.
