"use client";

/**
 * THE TOOLS THAT ONLY THIS VARIANT CAN ANSWER.
 *
 * The shell registers what is true of the whole app — the level verbs, the lens, the model reads,
 * `set_variant`, and a `set_view` that delegates to whatever is mounted. The turn is a different
 * kind of fact: README §3.2 is a fact about the REPOSITORY, but *where the turn is being told and
 * what beat it is on* is a fact about this drawing, and a tool registered by the shell would have
 * to reach into a variant's state to answer it.
 *
 * So the variant registers its own, and the same rule applies to every variant: a capability that
 * only one drawing can honour belongs to that drawing, and unmounts with it. An agent that calls
 * `set_turn` while the archify variant is mounted gets "no such tool", which is the truth, rather
 * than a tool that silently does nothing.
 *
 * EVERY TOOL HERE IS AUTO, for the same reason every tool in the shell is: Atlas has no database,
 * writes nothing and reaches nobody, so `reversible: true` and `sideEffects: "none"` are the honest
 * flags and `reversible && side_effects !== "external"` makes them AUTO.
 */
import { useWebMCPTool } from "@athena/demo-kit/webmcp";
import { bounded } from "@athena/demo-kit/webmcp";

import { componentById } from "@/data";
import { READ_CAP } from "@/lib/constants";

import { GATE_STOP, TURN } from "./turn";
import type { Story } from "./story";

/** The turn, as an agent reads it. Bounded like every list in this repository, and it says so. */
export function turnRead(at: number, story: Story) {
  const cut = bounded(
    TURN,
    READ_CAP,
    (s: (typeof TURN)[number]) => ({
      stop: s.index + 1,
      label: s.label,
      kind: s.kind,
      component: s.part,
      system: s.block,
      layer: s.layer,
      file: componentById(s.part)?.file ?? null,
      source: s.cite,
      waitsHere: s.kind === "wait",
      revisit: s.revisit,
      beat: story.on ? (s.index === at ? "active" : s.index < at ? "past" : s.index === at + 1 ? "next" : "off") : null,
    }),
  );
  return {
    ...cut,
    footer: `(showing ${cut.showing} of ${cut.of})`,
    at: at + 1,
    of: TURN.length,
    here: TURN[at]?.label ?? null,
    gate: GATE_STOP + 1,
    telling: story.on,
    playing: story.playing,
    note: "The path is drawn all at once in the turn view; the step control lights one stop at a time, and telling the story dims everything off the beat. The turn WAITS at the gate until a decision resolves it. set_turn moves the step; set_view('turn') puts the path on the sheet.",
  };
}

export function BlueprintTools({
  stop,
  setStop,
  story,
}: {
  stop: number;
  setStop: (index: number) => void;
  story: Story;
}) {
  useWebMCPTool({
    name: "read_turn",
    description:
      "The turn this machine runs, from README section 3.2: every stop in order, the module it happens in, the system and layer it belongs to, the one label the sheet shows there, and the README section it was read from. The gate's stop is the one that waits. When the story is being told, each stop also carries its beat (past, active, next, off). Registered by the blueprint variant; call set_variant('blueprint') if it is missing.",
    parameters: [],
    reversible: true,
    sideEffects: "none",
    handler: () => turnRead(stop, story),
    deps: [stop, story.on, story.playing],
  });

  useWebMCPTool({
    name: "set_turn",
    description:
      "Put the turn's step at one stop. The sheet lights that module's block and the read-out shows its label; if the story is being told, everything off the beat dims. Reversible: call again with another stop. Pass tell=true to start telling the story from that stop, or tell=false to go back to scrubbing.",
    parameters: [
      {
        name: "stop",
        type: "number",
        required: true,
        description: `Which stop, 1 to ${TURN.length}. read_turn lists them.`,
      },
      {
        name: "tell",
        type: "boolean",
        required: false,
        description: "Start (true) or stop (false) telling the story. Omit to leave it as it is.",
      },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ stop: asked, tell }) => {
      const n = Number(asked);
      if (!Number.isFinite(n) || n < 1 || n > TURN.length) {
        return {
          ok: false as const,
          error: `No stop ${String(asked)}. The turn has ${TURN.length} stops, numbered from 1.`,
        };
      }
      setStop(n - 1);
      if (tell === true) story.start();
      if (tell === false) story.stop();
      return turnRead(n - 1, story);
    },
    deps: [setStop, story],
  });

  return null;
}
