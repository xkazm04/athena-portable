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
 * `set_turn` while a variant without a story is mounted gets "no such tool", which is the truth,
 * rather than a tool that silently does nothing.
 *
 * ROUND 6 MOVED THESE TWO HERE. They were the round-5 blueprint variant's, and the blueprint was
 * deleted after the owner's verdict; the archify variant tells the same twelve-stop turn as four
 * chapters, so the capability survives its first home rather than disappearing with it. It answers
 * one thing more than the blueprint's did, because this drawing knows one thing more: **whether an
 * authored module edge actually carries the hop into a stop**, which is the distinction the Story
 * Trail draws dotted and the chapter bar counts.
 *
 * EVERY TOOL HERE IS AUTO, for the same reason every tool in the shell is: Atlas has no database,
 * writes nothing and reaches nobody, so `reversible: true` and `sideEffects: "none"` are the honest
 * flags and `reversible && side_effects !== "external"` makes them AUTO.
 */
import { bounded, useWebMCPTool } from "@athena/demo-kit/webmcp";

import { componentById } from "@/data";
import { READ_CAP } from "@/lib/constants";

import { BEATS, CHAPTERS, TRAIL_COUNTS, beatState, chapterOf, deltaOf } from "./story";

/** The stop that waits, and the stop the gate is decided at — derived, never typed twice. */
const GATE_STOP = BEATS.findIndex((b) => b.kind === "gate");
const WAIT_STOP = BEATS.findIndex((b) => b.kind === "wait");

/** The turn, as an agent reads it. Bounded like every list in this repository, and it says so. */
export function turnRead(at: number, telling: boolean, playing: boolean) {
  const cut = bounded(BEATS, READ_CAP, (b: (typeof BEATS)[number]) => ({
    stop: b.index + 1,
    label: b.label,
    kind: b.kind,
    component: b.part,
    system: b.system,
    layer: b.layer,
    file: componentById(b.part)?.file ?? null,
    source: b.cite,
    waitsHere: b.kind === "wait",
    /* The hop INTO this stop: true when `data/edges.ts` carries it, false when only README does. */
    authoredHop: b.index === 0 ? null : b.authored,
    chapter: CHAPTERS[chapterOf(b.index)]?.id ?? null,
    beat: telling ? beatState(b.index, at) : null,
  }));
  const chapter = chapterOf(at);
  return {
    ...cut,
    footer: `(showing ${cut.showing} of ${cut.of})`,
    at: at + 1,
    of: BEATS.length,
    here: BEATS[at]?.label ?? null,
    gate: GATE_STOP + 1,
    waits: WAIT_STOP + 1,
    chapters: CHAPTERS.map((c, i) => ({
      id: c.id,
      label: c.label,
      note: c.note,
      from: c.beats[0]!.index + 1,
      to: c.beats[c.beats.length - 1]!.index + 1,
      delta: deltaOf(i),
      current: i === chapter,
    })),
    hops: TRAIL_COUNTS,
    telling,
    playing,
    note: "The turn is drawn all at once as a Story Trail over the sheet, in four chapters; the step lights one stop at a time and telling the story dims everything off the beat. Of the eleven hops, five are authored module edges and six are only asserted by README — those are drawn dotted. The turn WAITS at the approval stop until a decision resolves it. set_turn moves the step; set_variant reads which drawing is mounted.",
  };
}

export function ArchifyTools({
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
      "The turn this machine runs, from README section 3.2: every stop in order, the module it happens in, the system and layer it belongs to, the one label the sheet shows there, the README section it was read from, and whether an authored module edge carries the hop into it or README alone asserts it. The four chapters carry their own enter/stay/leave delta. When the story is being told, each stop also carries its beat (past, active, next). Registered by the archify variant; call set_variant('archify') if it is missing.",
    parameters: [],
    reversible: true,
    sideEffects: "none",
    handler: () => turnRead(stop, story, playing),
    deps: [stop, story, playing],
  });

  useWebMCPTool({
    name: "set_turn",
    description:
      "Put the turn's step at one stop. The Story Trail lights that beat, the chapter strip moves with it, and everything off the beat dims. Reversible: call again with another stop. Pass tell=true to start telling the story from that stop, or tell=false to put the trail away.",
    parameters: [
      {
        name: "stop",
        type: "number",
        required: true,
        description: `Which stop, 1 to ${BEATS.length}. read_turn lists them.`,
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
      if (!Number.isFinite(n) || n < 1 || n > BEATS.length) {
        return {
          ok: false as const,
          error: `No stop ${String(asked)}. The turn has ${BEATS.length} stops, numbered from 1.`,
        };
      }
      setStop(n - 1);
      /* The answer names the state the tool is LEAVING the surface in — React has not re-rendered
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
