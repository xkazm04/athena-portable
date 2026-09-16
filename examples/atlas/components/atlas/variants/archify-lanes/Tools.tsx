"use client";

/**
 * `read_turn` / `set_turn` — the two capabilities only a drawing that TELLS the turn can answer.
 *
 * The shell registers what is true of the whole app; the turn's position is a fact about this
 * drawing, so the drawing registers it and it unmounts with the drawing. That rule is the archify
 * variant's (`variants/archify/Tools.tsx`) and it holds here for the same reason — but the two
 * tools cannot be imported from there, because a variant owns everything inside its own stage and
 * these two answer with THIS drawing's nodes, lanes, phases and edges. An agent that calls
 * `set_turn` while a variant without a story is mounted gets "no such tool", which is the truth.
 *
 * WHAT THIS ANSWER SAYS THAT THE ARCHIFY VARIANT'S DID NOT. Three things, each a property of the
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
import { turnRead } from "./turn";

export { turnRead };

export function LanesTools({
  stop,
  setStop,
  story,
  setStory,
  playing,
}: {
  stop: number;
  setStop: (index: number) => void;
  story: boolean;
  setStory: (on: boolean) => void;
  playing: boolean;
}) {
  useWebMCPTool({
    name: "read_turn",
    description:
      "The turn this machine runs, from README section 3.2, as the lane diagram draws it: every stop in order, the module it happens in, the NODE, LANE, COLUMN and PHASE it stands on, the README section it was read from, and whether a run of this drawing carries the hop into it and in which role (main, branch, async, return, error). The four lanes, the three phases with their nodes, and the four chapters come with it. Registered by the archify-lanes variant; call set_variant('archify-lanes') if it is missing.",
    parameters: [],
    reversible: true,
    sideEffects: "none",
    handler: () => turnRead(stop, story, playing),
    deps: [stop, story, playing],
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
    handler: ({ stop: asked, tell }) => {
      const n = Number(asked);
      if (!Number.isFinite(n) || n < 1 || n > BEAT_VIEWS.length) {
        return {
          ok: false as const,
          error: `No stop ${String(asked)}. The turn has ${BEAT_VIEWS.length} stops, numbered from 1.`,
        };
      }
      setStop(n - 1);
      /* The answer names the state the tool LEAVES the surface in — React has not re-rendered
         inside this handler, so reading the props back here would answer the previous one. */
      const telling = tell === true ? true : tell === false ? false : story;
      if (tell === true) setStory(true);
      if (tell === false) setStory(false);
      return turnRead(n - 1, telling, telling ? playing : false);
    },
    deps: [setStop, setStory, story, playing],
  });

  return null;
}
