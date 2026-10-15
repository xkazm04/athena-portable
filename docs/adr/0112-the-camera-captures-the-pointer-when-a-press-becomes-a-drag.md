# 0112. The camera captures the pointer when a press becomes a drag

Date: 2026-10-15

Amends the rig of `docs/kit-camera-contract.md` §2 (round 3 of the layered-UI program). Closes
atlas KIT-GAPS R5-A1 and the item `docs/layered-ui-formula.md` carried as "the rig's pointer
capture still steals `click` from DOM controls in the scene (fourth report)".

## Context

`useCameraRig`'s `bind.onPointerDown` called `setPointerCapture` on every press, and the first
`pointermove` panned the scene. A captured pointer retargets the click that follows to the
capturing element, so a DOM control drawn inside a camera scene lost its mouse click. Focus,
Enter and hover still worked, so only the mouse was broken. Atlas worked around it by stopping
`pointerdown` on every node (`archify-lanes/Scene.tsx`), which cost "a pan cannot start on a box".
A pan released over a node could also open it, and a click on a node nudged the camera by the
sub-pixel the press wobbled.

The state behind all of this (the pointer map, the pinch, the last point and time, `moving`) was
spread across refs in a 600-line hook with no test. Every other rule in the kit is a pure module
with a `node --test` file.

## Decision

1. **The pointer is a pure machine.** `zoom/gesture.ts` exports
   `gestureStep(state, input, { drag }) -> { state, effects }`. The inputs are `down`, `move`,
   `up`, `cancel`, `lostcapture`, `click` and `expire`. The effects are `halt`, `capture`,
   `release`, `drag {dx, dy, dt}`, `pinch {factor, mid, pan}`, `moving`, `coast`, `settle` and
   `swallowClick`. The module is type-imports-only, like the other pure kit modules, and
   `test/gesture.test.ts` pins it. `useCameraRig` only carries the effects out.
2. **A press is a click until it travels `DRAG_SLOP` (4) screen pixels** from where it went down.
   It is measured on the screen, before `panDelta` divides by the zoom, so the click tolerance
   does not shrink as the reader zooms in. Before the threshold nothing is captured and nothing
   moves.
3. **Capture at the threshold.** The move that crosses the slop captures the pointer, then pans by
   the whole distance from the press origin, so the scene does not lag the hand. A second pointer
   is a pinch, and every pointer in it is captured at once, as before.
4. **The trailing click of a drag is swallowed once**, by a capture-phase `click` listener on the
   scene. The swallow is cleared by the next `down`, and by `expire`, which the hook sends in a
   `setTimeout(0)` after the up. A drag that produced no click at all, such as a touch pan, then
   never eats the click of a later ordinary press. This amends the card's first wording (a
   swallow that waited for the next click) after review.
5. **Every exit releases.** Up releases what it captured. A `cancel` or a lost capture ends the
   whole gesture: it releases what is still held (not the pointer whose capture is already gone),
   sets `moving` false and keeps no pointer. A `lostpointercapture` for a pointer the rig already
   let go (its own release after an up) is a no-op. A `down` under an id the rig still holds (an
   up lost outside the scene) starts a fresh press instead of pinching with a ghost.
6. **No new `bind` member.** The `click` and `lostpointercapture` listeners attach through
   `bind.ref`, beside the non-passive `wheel` listener, so a surface that spreads `bind` by hand
   (atlas's `Drawing.tsx`) gets them. The lost-capture listener acts only on the scene's own
   capture, because a child's implicit touch capture also fires `lostpointercapture` and it
   bubbles.

## Consequences

- A DOM control inside a camera scene answers the mouse with no `stopPropagation` and no opt-out
  option. Atlas dropped `holdPointer`, so a pan can start on a node.
- A pan released over a node no longer opens it, and a click on a node no longer moves the camera.
  `rig.moving` turns true at the threshold, not on the press.
- A press still stops inertia and cancels a flight (the `halt` effect), as before. A grab stops the
  camera even when it turns out to be a click.
- `drag: "none"` still makes the pointer inert, and the pinch-to-one-finger hand-off still does
  not jump.
- The swallow lasts one task. A platform that sends the click of a short touch drag in a later
  task, which is rare because a touch that travels does not tap, gets that click through.
- No contract type, wire format or stored state changes. The hook's options and `bind` keep their
  shapes; the barrel adds `gestureStep`, `initialGesture`, `swallowsClick`, `DRAG_SLOP` and the
  `Gesture*` types.
