# 0193. A leaving layer is a still, and only the arriving scene is live

Date: 2026-10-25

## Context

A depth move plays as layers (README section 3.1, ADR 0087 and 0089): the place you left plays
out while the place you arrived at plays in, and a move during a move keeps up to two leaving
layers. `layers.ts` said what each layer was doing, but `Stage.tsx` drew every layer through the
scene renderer, so a leaving layer was a whole live scene, only `aria-hidden` and `inert`, until
its `animationend` or the 900 ms safety flush. Two scenes, and up to three in an interrupted move,
ran their effects, polls, subscriptions, document listeners and frame loops at once.

The scenes paid for it by hand. Six `closest("[inert]")` guards in five scene files
(`scenes/voice/studio.tsx`, `scenes/chores/topic.tsx`, `replay.tsx` twice, `intake/intake.tsx`,
`adopt/studio.tsx`) kept a leaving copy from taking a key meant for the arriving one, and ADR
0092's one-loop budget for Voice held because the studio remembered to ignore a leaving layer. An
effect without a guard (a poll, a mic stopped on unmount, a subscription) still ran twice for the
length of the leave, and a new scene had to know the rule to be safe.

## Decision

1. **One live scene, by construction.** A layer is live only while it is arriving or at rest
   (`isLive` in `layers.ts`). The stage draws the scene only into a live layer, so a move
   unmounts the scene being left in the move's own commit: its cleanups run at the move's start,
   not at its `animationend`.
2. **The leave plays a still.** The layer section is a class component whose
   `getSnapshotBeforeUpdate` copies the section's DOM when a live layer turns into a leaving one,
   the one moment React offers between a render that drops the scene and the DOM losing it.
   `componentDidUpdate` puts the copy back, before the frame is painted, and marks the section
   `data-still`. CSS animates the section exactly as before, on `transform` and `opacity` only
   (ADR 0089).
3. **What a still is** (`stage/still.ts`): a deep clone of the layer's children; each canvas drawn
   into its copy by `drawImage` so a waveform or a sky does not blank; field values and scroll
   offsets carried over; HTML ids, `autofocus` and `autoplay` stripped, so the copy cannot be found
   by `getElementById` instead of the arriving scene, steal focus or start media. SVG elements keep
   their ids, because their gradients and masks are referenced by them and the still is inert. A
   clone carries no listener, so a still answers nothing.
4. **Not first-frame code.** `still.ts` is fetched by `import()` once the stage has drawn (ADR
   0095); the static part is the class layer, measured at +245 B gzipped against the run base
   (164,936 B to 165,181 B, ceiling 165,412 B). A move made before the module lands leaves its
   layer empty for that one leave.
5. **Calm is unchanged.** Under calm a move is one layer at rest and no still is taken.

## Consequences

- No scene can take a key, fire a fetch, keep a frame loop or a microphone alive, or double a
  subscription during a move, present or future, with no guard to remember. React work during a
  move is one live tree instead of two or three.
- The six `closest("[inert]")` guards are now dead code. They stay until a pass in their own
  contexts removes them; they are harmless, since no leaving layer runs a scene.
- A scene's unmount now happens at the move's start. A scene that relied on staying mounted for
  the leave (none found) would see its cleanup earlier.
- The still is a picture: a leave no longer shows a scene's own animation continuing (a spinner, a
  live waveform) under the move. Its last frame is held for the length of the leave.
- Copying the layer costs a DOM clone at the move's start; `pnpm perf:stage` measures it.
