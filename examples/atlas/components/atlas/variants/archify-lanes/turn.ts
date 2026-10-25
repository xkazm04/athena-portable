/**
 * WHAT `read_turn` ANSWERS — the turn, as THIS drawing draws it.
 *
 * It is a pure module beside the hook that registers it, for one reason that is not taste:
 * `node --test` strips TypeScript and does not understand JSX, so a rule that can be wrong has to
 * be reachable from a `.ts` file. `test/lanes.poses.test.ts` calls this directly.
 *
 * WHAT IT SAYS THAT ROUND 5'S DID NOT. Three things, each a property of the lane grid rather than
 * of the turn: which LANE and which PHASE a stop happens in (so an agent can ask for a phase and
 * get a level change), which NODE it stands on after nineteen systems were folded into twelve
 * boxes, and — the one worth having — whether an authored RUN OF THIS DRAWING carries the hop into
 * the stop, and in which role. The archify variant could say whether `data/edges.ts` carried a
 * hop; this says whether the drawing does, which is the claim a reader can check by looking.
 */
import { bounded } from "@athena/demo-kit/webmcp";

import { componentById } from "@/data";
import { READ_CAP } from "@/lib/constants";

import { planOf } from "./geometry";
import { selectRun } from "./inspect";
import { BEAT_VIEWS, CHAPTER_VIEWS, HOPS, TRAIL_COUNTS, beatState, chapterOf } from "./story";
import { EDGE_BY_ID, LANES, PHASES } from "./workflow";

const GATE_STOP = BEAT_VIEWS.findIndex((b) => b.kind === "gate");
const WAIT_STOP = BEAT_VIEWS.findIndex((b) => b.kind === "wait");

const HOP_INTO = new Map(HOPS.map((h) => [h.index, h]));

/**
 * What `set_turn` makes of the stop it was asked for: a whole stop from 1 to the last, as a 0-based
 * index, or a refusal that says what the turn has. Pure, so the refusal is pinned by a test rather
 * than living only inside the hook that registers the tool.
 */
export function askStop(
  asked: unknown,
): { ok: true; stop: number } | { ok: false; error: string } {
  const n = Number(asked);
  /* `Number.isInteger` and not `isFinite`: the schema says `number`, a fraction satisfies it, and
     a fractional index reads back as no beat at all. */
  if (!Number.isInteger(n) || n < 1 || n > BEAT_VIEWS.length) {
    return {
      ok: false,
      error: `No stop ${String(asked)}. The turn has ${BEAT_VIEWS.length} stops, numbered from 1.`,
    };
  }
  return { ok: true, stop: n - 1 };
}

export interface TurnState {
  stop: number;
  story: boolean;
  playing: boolean;
}

/**
 * The state `set_turn` leaves the drawing in. `tell` turns the story on or off, or leaves it.
 *
 * Putting the trail away stops the clock, which is the rule the TURN toggle and the view switch
 * already keep; the tool is the third door onto the same state and has to keep it too.
 */
export function turnAfter(
  stop: number,
  tell: unknown,
  now: { story: boolean; playing: boolean },
): TurnState {
  const story = tell === true ? true : tell === false ? false : now.story;
  return { stop, story, playing: story ? now.playing : false };
}

/**
 * THE STORY IS ONE REDUCER WITH EIGHT DOORS. The TURN toggle, the view bus, `set_turn`, the story
 * bar's play / step / chapter, the editorial script rail, an opened run and the clock's tick each
 * used to write three `useState`s by hand and re-state the rules at the write site. Here the rules
 * are stated once, so they cannot drift door by door (ADR 0160; client-state/status-fsms):
 *
 *   - `0 <= stop < BEAT_VIEWS.length`, always: every door wraps or refuses.
 *   - `playing` implies `story`: putting the trail away stops the clock.
 *   - every hand action bumps `epoch`, and a tick carries the epoch it was armed under, so a tick
 *     from before a manual move is dropped (client-state/async-race-guards). The drawing arms one
 *     timeout per `[epoch, stop]`, so the stop a reader picked gets a full beat.
 *   - under reduced motion the clock does not run: play steps once instead, and `playingNow` reads
 *     false, so `read_turn` never reports a clock that nothing moves.
 */
export interface StoryState extends TurnState {
  epoch: number;
}

export interface StoryEnv {
  reduced: boolean;
}

export type StoryAction =
  | { type: "toggle" }
  | { type: "view"; id: string }
  | { type: "tool"; stop: unknown; tell?: unknown }
  | { type: "play" }
  | { type: "step"; to: number }
  | { type: "chapter"; index: number }
  | { type: "pick"; index: number }
  | { type: "run"; id: string }
  | { type: "tick"; epoch: number };

export const STORY_START: StoryState = { stop: 0, story: false, playing: false, epoch: 0 };

const wrap = (to: number): number => {
  const n = Number.isFinite(to) ? Math.trunc(to) : 0;
  return ((n % BEAT_VIEWS.length) + BEAT_VIEWS.length) % BEAT_VIEWS.length;
};

/** Whether the clock is actually running: the state says playing AND motion is allowed. */
export const playingNow = (s: TurnState, env: StoryEnv): boolean =>
  s.playing && s.story && !env.reduced;

/**
 * What `set_turn` makes of the state: the refusal `askStop` gives, or the state it leaves. The
 * tool answers from this, and dispatches the same action, so its answer IS the next state.
 */
export function turnTool(
  s: StoryState,
  stop: unknown,
  tell: unknown,
): { ok: true; state: StoryState } | { ok: false; error: string } {
  const asked = askStop(stop);
  if (!asked.ok) return asked;
  return { ok: true, state: { ...turnAfter(asked.stop, tell, s), epoch: s.epoch + 1 } };
}

/** The story's one transition authority. Pure; a refused or stale action returns `s` itself. */
export function turnReduce(s: StoryState, a: StoryAction, env: StoryEnv): StoryState {
  const hand = (next: TurnState): StoryState => ({
    stop: wrap(next.stop),
    story: next.story,
    playing: next.story && next.playing,
    epoch: s.epoch + 1,
  });
  switch (a.type) {
    case "toggle":
      return hand({ stop: s.stop, story: !s.story, playing: false });
    case "view": {
      const story = a.id === "turn";
      return hand({ stop: s.stop, story, playing: story && s.playing });
    }
    case "tool": {
      const out = turnTool(s, a.stop, a.tell);
      return out.ok ? out.state : s;
    }
    case "play":
      if (env.reduced) return hand({ stop: s.stop + 1, story: true, playing: false });
      return hand({ stop: s.stop, story: true, playing: !s.playing });
    case "step":
      return hand({ ...s, stop: a.to });
    case "chapter":
      return hand({ ...s, stop: CHAPTER_VIEWS[a.index]?.from ?? 0 });
    case "pick":
      return hand({ ...s, story: true, stop: a.index });
    case "run": {
      if (!EDGE_BY_ID.has(a.id)) return s;
      return hand({ ...s, stop: selectRun(s, a.id).stop });
    }
    case "tick":
      if (a.epoch !== s.epoch || !playingNow(s, env)) return s;
      return { ...s, stop: wrap(s.stop + 1) };
  }
}

/** The turn, as an agent reads it. Bounded like every list in this repository, and it says so. */
export function turnRead(at: number, telling: boolean, playing: boolean) {
  const plan = planOf(null);
  const cut = bounded(BEAT_VIEWS, READ_CAP, (b: (typeof BEAT_VIEWS)[number]) => {
    const boxed = plan.byId.get(b.node);
    const hop = HOP_INTO.get(b.index);
    return {
      stop: b.index + 1,
      label: b.label,
      kind: b.kind,
      component: b.part,
      system: b.system,
      file: componentById(b.part)?.file ?? null,
      source: b.cite,
      node: b.node,
      nodeLabel: b.nodeLabel,
      lane: boxed?.lane ?? null,
      col: boxed?.col ?? null,
      phase: boxed?.phase ?? null,
      waitsHere: b.kind === "wait",
      /* The hop INTO this stop: which run of THIS drawing carries it, and in what role. */
      hopEdge: b.index === 0 ? null : (hop?.edge ?? null),
      hopRole: b.index === 0 ? null : (hop?.role ?? null),
      hopDrawn: b.index === 0 ? null : hop ? "a run" : "inside one node",
      chapter: CHAPTER_VIEWS[chapterOf(b.index)]?.id ?? null,
      beat: telling ? beatState(b.index, at) : null,
    };
  });

  const here = BEAT_VIEWS[at];
  return {
    ...cut,
    footer: `(showing ${cut.showing} of ${cut.of})`,
    at: at + 1,
    of: BEAT_VIEWS.length,
    here: here?.label ?? null,
    hereNode: here?.node ?? null,
    herePhase: here ? (plan.byId.get(here.node)?.phase ?? null) : null,
    gate: GATE_STOP + 1,
    waits: WAIT_STOP + 1,
    lanes: LANES.map((l) => ({ id: l.id, label: l.label, variant: l.variant, note: l.note })),
    phases: PHASES.map((p) => ({
      id: p.id,
      label: p.label,
      cols: [p.fromCol, p.toCol],
      variant: p.variant,
      note: p.note,
      nodes: plan.nodes.filter((n) => n.phase === p.id).map((n) => n.id),
    })),
    chapters: CHAPTER_VIEWS.map((c, i) => ({
      id: c.id,
      label: c.label,
      note: c.note,
      from: c.from + 1,
      to: c.to + 1,
      nodes: c.focus,
      current: i === chapterOf(at),
    })),
    hops: TRAIL_COUNTS,
    /* A run's note and cite ride beside its label, so an agent reads what the readout shows. */
    edges: HOPS.filter((h) => h.edge !== null)
      .slice(0, READ_CAP)
      .map((h) => {
        const e = EDGE_BY_ID.get(h.edge!);
        return {
          hop: h.index,
          edge: h.edge,
          role: h.role,
          label: e?.label ?? null,
          note: e?.note ?? null,
          cite: e?.cite ?? null,
        };
      }),
    telling,
    playing,
    note: "The drawing IS the turn: a node's lane says who owns the step and its column says when it happens, so the twelve stops read left to right down the stack with no overlay. Eight of the ten drawn hops are runs of this drawing; two are asserted by README alone and the Story Trail draws those dotted. Opening a phase (set_level group=arrive|compose|record) is the L1 move. set_turn moves the step; set_variant reads which drawing is mounted.",
  };
}

