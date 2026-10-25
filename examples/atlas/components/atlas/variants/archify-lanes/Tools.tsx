"use client";

/**
 * `read_turn` / `set_turn` — the two capabilities only a drawing that TELLS the turn can answer.
 *
 * The shell registers what is true of the whole app; the turn's position is a fact about this
 * drawing, so the drawing registers it and it unmounts with the drawing. That rule came from the
 * round-5 archify sheet, which registered its own pair the same way — and the two could never be
 * shared, because a variant owns everything inside its own stage and these answer with THIS
 * drawing's nodes, lanes, phases and edges. Which is why the round-6 verdict that deleted the
 * sheet cost the capability nothing: the drawing that TELLS the turn is the one that survived, and
 * `read_turn` / `set_turn` mount with it here.
 *
 * WHAT THIS ANSWER SAYS THAT THE ARCHIFY SHEET'S DID NOT. Three things, each a property of the
 * lane grid rather than of the turn: which LANE and which PHASE a stop happens in (so an agent can
 * ask for the phase and get a level change), which NODE it stands on after twelve stops were
 * folded into twelve boxes, and — the one worth having — whether an authored EDGE OF THIS DRAWING
 * carries the hop into the stop, with its role. Round 5's answer could say whether `data/edges.ts`
 * carried it; this one says whether the drawing does, which is the claim a reader can check.
 *
 * EVERY TOOL HERE IS AUTO: Atlas has no database, writes nothing and reaches nobody, so
 * `reversible: true` and `sideEffects: "none"` are the honest flags.
 */
import { useWebMCPTool } from "@athena/demo-kit/webmcp";

import { BEAT_VIEWS } from "./story";
import { playingNow, turnRead, turnTool, type StoryAction, type StoryState } from "./turn";

export { turnRead };

export function LanesTools({
  turn,
  dispatch,
  reduced,
}: {
  turn: StoryState;
  dispatch: (action: StoryAction) => void;
  reduced: boolean;
}) {
  useWebMCPTool({
    name: "read_turn",
    description:
      "The turn this machine runs, from README section 3.2, as the lane diagram draws it: every stop in order, the module it happens in, the NODE, LANE, COLUMN and PHASE it stands on, the README section it was read from, and whether a run of this drawing carries the hop into it and in which role (main, branch, async, return, error). The four lanes, the three phases with their nodes, and the four chapters come with it. Registered by the archify-lanes variant; call set_variant('archify-lanes') if it is missing.",
    parameters: [],
    reversible: true,
    sideEffects: "none",
    /* `playing` is whether the clock RUNS: reduced motion stops it, so it reads false then. */
    handler: () => turnRead(turn.stop, turn.story, playingNow(turn, { reduced })),
    deps: [turn, reduced],
  });

  useWebMCPTool({
    name: "set_turn",
    description:
      "Put the turn's step at one stop. The Story Trail lights that beat, the chapter strip moves with it, the camera follows to the phase the stop lives in, and everything off the beat dims. Reversible: call again with another stop. Pass tell=true to start telling the turn from that stop, or tell=false to put the trail away.",
    parameters: [
      {
        name: "stop",
        type: "number",
        required: true,
        description: `Which stop, 1 to ${BEAT_VIEWS.length}. read_turn lists them.`,
      },
      {
        name: "tell",
        type: "boolean",
        required: false,
        description: "Start (true) or stop (false) telling the turn. Omit to leave it as it is.",
      },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ stop: raw, tell }) => {
      /* One action through the story's reducer (turn.ts). The answer names the state the tool
         LEAVES the surface in — React has not re-rendered inside this handler, so reading the
         props back here would answer the previous one — and `turnTool` is the reducer's own
         `tool` transition, so the answer and the next read_turn cannot disagree. */
      const out = turnTool(turn, raw, tell);
      if (!out.ok) return out;
      const next = out.state;
      dispatch({ type: "tool", stop: raw, tell });
      return turnRead(next.stop, next.story, playingNow(next, { reduced }));
    },
    deps: [dispatch, turn, reduced],
  });

  return null;
}
