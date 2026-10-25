# 0160. The atlas lane story is one reducer, and a tick carries its epoch

Date: 2026-10-25

Extends ADR 0150 (a lane run opens; with the story on it moves the stop).

## Context

The archify-lanes drawing tells the turn as a guided story whose state is three facts: the stop,
whether the story is told, and whether its clock is playing. They were three `useState`s in
`Drawing.tsx`, written from eight doors: the TURN toggle, the view bus, `set_turn`, the story bar's
play, step and chapter, the editorial script rail, an opened run, and the interval tick. Each door
re-stated the rules by hand (wrap the stop, playing implies story, reduced motion steps instead of
playing), and two earlier fixes had already closed this class one door at a time (`set_turn
tell=false` left the clock running; a fractional stop crashed the story bar). Two defects were
still live:

1. The clock was a `setInterval` keyed on `[beatMs, playing, reduced]`, not on the stop, so a
   manual step, chapter jump, run or `set_turn` while playing was followed by an auto-advance on
   the old interval's leftover time and the stop the reader picked could flash past.
2. Under reduced motion the clock stopped but `playing` stayed true, and `read_turn` reported a
   playing story while nothing moved.

## Decision

1. **One pure transition authority**, `turnReduce(state, action, env)` in `archify-lanes/turn.ts`,
   over `StoryState { stop, story, playing, epoch }` and an action union (`toggle`, `view`, `tool`,
   `play`, `step`, `chapter`, `pick`, `run`, `tick`). `Drawing.tsx` holds it in `useReducer`; every
   door is a dispatch. `Tools.tsx`'s `set_turn` computes its answer with `turnTool` (the reducer's
   own `tool` transition) and makes exactly one dispatch.
2. **Invariants are the reducer's, not the doors'**: `0 <= stop < 12`, `playing` implies `story`.
3. **Every hand action bumps `epoch`; a tick carries the epoch it was armed under** and is dropped
   if a door has moved since. The drawing arms one `setTimeout` per `[epoch, stop]`, so each beat,
   including the one a reader picked, gets a full `beatMs`.
4. **`playingNow(state, env)` is what "playing" means outside the reducer**: the state says playing
   and motion is allowed. `read_turn`, the story bar and `data-motion-owner` read it.

`askStop` and `turnAfter` stay as the building blocks the reducer calls, so their tests stand.

## Consequences

- A new story door (a deep link, a shortcut, node-to-stop) is one action; it cannot forget to stop
  the clock or wrap the stop. `test/lanes.turn.test.ts` holds the invariants as a property loop.
- Any hand action while playing (including a view switch to the view already shown) restarts the
  beat from that moment; that is the intended reading of "the reader moved".
- Under reduced motion the stored `playing` may stay true (so turning reduced motion off resumes
  the story), but nothing outside the reducer reads it raw.
- The reducer closes over `reduced` through a `useCallback`; React reads the latest reducer at
  render, so a reduced-motion change takes effect on the next action.
