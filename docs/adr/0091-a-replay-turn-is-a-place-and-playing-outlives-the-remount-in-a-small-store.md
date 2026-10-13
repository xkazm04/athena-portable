# 0091 — A replay turn is a place, and "playing" outlives the remount in a small store

## Context

The Chores depth (README 3.5, ADR 0087) ends in `chores/<chore>/run/<turn>`: the replay of a run
at one turn. The old Playbooks view held the turn and the play state in its own component. A depth
scene is told its place and draws it, and the stage plays every change of place as a move (two
layers, 360 ms, `across` for a sibling), which remounts the scene. So if the turn is the place, a
step is a move and the scene's own state (a `useState` for "playing") does not survive it.

## Decision

1. **The turn is the place.** A step is `go(chores/<id>/run/<n+1>)`. A link, a reload and the
   breadcrumb all land on a turn, and `Turn 3` is a crumb. The cost is that each step is the
   stage's `across` move (a short slide and fade); it reads as turning a page, and under Calm it is
   one layer at rest.
2. **Playing lives in a tiny module store** beside the replay (`scenes/chores/replay.tsx`), read
   with `useSyncExternalStore`. It records which chore was started and when it last stepped, and
   goes stale after two steps' time, so leaving the replay mid-play and coming back later does not
   resume by itself. Back, Next, a dot, a ledger row and an arrow stop it. The timer is a
   `setTimeout`, never a frame request.
3. **Arrows are a document listener**, because the stage moves focus to the top layer on every
   move and so the keys arrive at the document, not at a focused replay element. A layer that is
   leaving is `inert`; the listener, and a timer that outlived a press, both check for that and do
   nothing, so one move is never stepped twice.

Two smaller choices ride with it. The map spreads a crowded cell as a sunflower over 0.46 of a step
(`markPoints`), because the module's ring layout is right for a few chores and a tangle for the
thirty that share the (4, 4) cell in the shipped set; the module's own layout and its tests are
unchanged. And the scene's portal "Open" makes the Browser tab and stays where it is (the hook's
`afterOpen`), because the page level, `apps/<app>/page`, belongs to the Apps depth and a Rust
`browser` selection shows a page under a scene (ADR 0088); when Apps lands, `afterOpen` takes the
person there.

## Consequences

- A turn is deep-linkable and the replay needs no state of its own except what the person is
  looking at; the cost is one small module-level store and a stale-after-two-steps rule to read.
- The slide on each step is the stage's, not the scene's; if it proves heavy for long runs the
  answer is a stage-level "same scene, new argument" move, not local state here.
- The Chores scene calls `usePlaybooksModel({ afterOpen })`; the module bar keeps its behaviour
  (select the Browser, then make the tab) when no option is given.
