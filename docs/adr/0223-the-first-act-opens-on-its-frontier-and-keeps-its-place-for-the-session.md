# 0223. The first act opens on its frontier and keeps its place for the session

Date: 2026-10-25

Builds on ADR 0085 and 0087 (the first act and its steps) and ADR 0094 (a reopened act survives
navigating away and back; a restart forgets it). README section 3.5. Owner-approved in triage
2026-10-25, with +199 B of the first-paint ceiling raised to 166,251 B (b84b727c) earmarked for it.

## Context

The act's position was `useState(initialStep)` inside `WakingView`, with `initialStep = 0`, and the
running app never passed one. A first-run person who pressed Later to look around (often to open the
app the Reach step asks for) came back to an act remounted at Mind, already done, and pressed Next
three times to reach Wake her. The step the person still owed was already computable: the view
derived it for the tendrils (`lit`), and the stories hand-listed it (`INITIAL_STEPS`). The Voice step
reported "Her voice: ..." and offered nothing to act on it, though setup lives in the voice studio.

## Decision

1. **`scenes/waking/steps.ts`, pure.** The four steps, `litSteps(model, avatar)` (the facts that
   light her tendrils) and `openingStep(model, avatar, kept)`: a kept step wins; otherwise the first
   step not yet done; with everything done, the last step, where Wake her is. It reads the Setup
   module's facts and decides nothing about readiness, so no opening step bypasses `isReady` /
   `notReadyBecause`: Wake her stays gated exactly as before.
2. **The place is kept in the act's session store.** `reopen.ts` gains `step: Step | null` and
   `keep(step)`; a step click and Next report the step through `onStep`. `set(true)` (the reshow
   from Mind) puts the step back on Mind, so "Show the welcome again" walks it from the start.
   `on` and `set(on)` keep their shape for their other readers (the console, the Mind depth).
   Nothing is written to disk: a restart forgets the place, as ADR 0094 forgets the flag.
3. **The frontier holds once the engine has answered.** While the engine is still being looked
   for, the act follows the model to the step still owed; once it has answered, the position is
   fixed for that mount, so opening a page on Reach does not move the act out from under the
   person. The adjustment is made while rendering, not in an effect.
4. **The Voice step is a door.** While her voice is not available, "Set up her voice in the studio"
   keeps the Voice step and goes to `{ root: "voice", item: "studio" }`; coming back lands on Voice.
5. `initialStep` stays as the preview and test override (it wins over a kept step and the
   frontier), and `INITIAL_STEPS` stays for the stories.
6. **First-frame code, within its earmark.** `scenes/waking` is in the first frame. The r2 build
   tried lazy seams (a lazy Voice body: +883 B, it split readiness and React out of the root chunk;
   a runtime-free one: +357 B) and none fit, so the owner raised the ceiling instead. Measured
   2026-10-25 against HEAD b84b727c with sibling edits masked: 165,902 B before, 166,101 B after,
   +199 B, exactly the earmark; the ceiling is not raised again.

## Consequences

- A person who leaves the act (Later, the voice studio) and returns lands on the step they were on,
  and a first arrival lands on the step still owed, often directly on Wake her.
- The position is session state, not a row: two windows or a restart do not share it.
- The first-paint headroom left after this card is the wave's shared +150 B.
- Rollback is the commit's revert: no stored data or contract changes.
