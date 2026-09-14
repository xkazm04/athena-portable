/**
 * THE TURN — README §3.2, walked through the machine as a light.
 *
 * This is the hero of the round. Atlas's argument is that an architecture is a machine, and the
 * proof that a drawing of a machine is a drawing of a MACHINE rather than a diagram is that
 * something can run through it. So a real turn — the six numbered steps of README §3.2, plus the
 * gate of §3.3 and the ledger of invariant 6 — is scripted here as an ordered list of stops, each
 * naming a component that exists in `@/data`, and the renderers move a light along the legs
 * between them.
 *
 * EVERY STOP IS A REAL PART. `test/turn.test.ts` fails if a stop names a component the model does
 * not have, and fails again if the stops do not touch all six strata. That test is the thing that
 * keeps the turn honest: an animation whose stops drifted away from the extracted model would be
 * a decorative loop with an architectural theme, which is exactly what the owner's correction is
 * about.
 *
 * THE LEGS ARE THE PIPES. A leg is routed by `route()` — the same function that draws the static
 * plumbing — so the light travels ON the machine rather than over it. Where a real system edge
 * exists between two consecutive stops the light rides that pipe exactly; where it does not (the
 * turn crosses a stratum the extracted edges do not model) the leg is routed the same way and
 * marked `onPipe: false`, so the surface can draw it as the turn's own path and the reader is not
 * told a pipe exists that does not.
 *
 * ONE SHORT LABEL PER STOP. The brief is explicit: each stop lights the block and shows ONE short
 * label. Prose lives at L2 and nowhere else. Every `label` below is under sixty characters and
 * every `cite` names the section it was read from, because that is this app's one content rule.
 */
import { componentById } from "@/data";

import { ARRIVE, DWELL, TRAVEL, WAIT } from "./beats";
import { blockAt, measure, pointOn, route, type Flow, type Vec3 } from "./layout";
import { SCENE } from "./layout";

/** What kind of moment a stop is — the surface colours the light by it. */
export type StopKind = "enter" | "compose" | "run" | "gate" | "wait" | "write" | "return";

export interface TurnStop {
  /** The component the light stops on. Must exist in the model. */
  part: string;
  /** Its system — the block that lights. Derived, never typed. */
  block: string;
  /** The one label, under sixty characters. */
  label: string;
  kind: StopKind;
  /** Where in README the step was read from. */
  cite: string;
  /** Beats spent travelling to this stop. The first stop uses `ARRIVE`. */
  travel: number;
  /** Beats spent lit at this stop. */
  dwell: number;
}

/**
 * The script. Eleven stops, read straight off README §3.2 in order, with §3.3's gate expanded
 * into the two moments it actually is (the class is decided in the catalog; the row is written
 * in approvals and the turn STOPS) and invariant 6's ledger row added because a turn that never
 * costs anything is not this repository's turn.
 */
const SCRIPT: readonly Omit<TurnStop, "block">[] = [
  {
    part: "cmp-mod-panel",
    label: "a message, with host_state, fenced",
    kind: "enter",
    cite: "README §3.2.1",
    travel: ARRIVE,
    dwell: DWELL,
  },
  {
    part: "cmp-daemon-routes",
    label: "POST /run — the stream opens",
    kind: "enter",
    cite: "README §3.1 channels, §3.2.1",
    travel: TRAVEL,
    dwell: DWELL,
  },
  {
    part: "cmp-lane",
    label: "one turn, streamed",
    kind: "run",
    cite: "README §3.1 lane",
    travel: TRAVEL,
    dwell: DWELL,
  },
  {
    part: "cmp-prompt",
    label: "static blocks, and a turn frame",
    kind: "compose",
    cite: "README §3.2.2",
    travel: TRAVEL,
    dwell: DWELL + 0.4,
  },
  {
    part: "cmp-cli-harness",
    label: "up to eight rounds — one turn",
    kind: "run",
    cite: "README §3.2.3",
    travel: TRAVEL,
    dwell: DWELL,
  },
  {
    part: "cmp-hooks",
    label: "every tool call passes the gate",
    kind: "gate",
    cite: "README §3.2.4",
    travel: TRAVEL,
    dwell: DWELL,
  },
  {
    part: "cmp-catalog",
    label: "reversible? external? → GATED",
    kind: "gate",
    cite: "README §3.3",
    travel: TRAVEL * 0.7,
    dwell: DWELL,
  },
  {
    part: "cmp-c-manifest",
    label: "the manifest's own flags decide the class",
    kind: "gate",
    cite: "README §3.3",
    travel: TRAVEL,
    dwell: DWELL,
  },
  {
    part: "cmp-approvals",
    label: "an approval row. The turn waits.",
    kind: "wait",
    cite: "README §3.2.4, §3.2.6",
    travel: TRAVEL * 0.7,
    dwell: WAIT,
  },
  {
    part: "cmp-ledger",
    label: "one row, failures included",
    kind: "write",
    cite: "README §2, invariant 6",
    travel: TRAVEL * 0.7,
    dwell: DWELL,
  },
  {
    part: "cmp-daemon-sessions",
    label: "the stream carries it up",
    kind: "return",
    cite: "README §3.1 channels",
    travel: TRAVEL,
    dwell: DWELL,
  },
  {
    part: "cmp-mod-panel",
    label: "back where it started",
    kind: "return",
    cite: "README §3.2.6",
    travel: TRAVEL,
    dwell: DWELL,
  },
];

/** One leg: the routed path from the previous stop's block to this one's. */
export interface TurnLeg {
  points: readonly Vec3[];
  length: number;
  flow: Flow;
  /** True when a real system edge runs this way — the light is riding the drawn plumbing. */
  onPipe: boolean;
}

export interface TurnBeatStop extends TurnStop {
  index: number;
  /** The beat the light starts travelling toward this stop. */
  start: number;
  /** The beat the light arrives. */
  arrive: number;
  /** The beat it leaves again. `end - arrive` is the dwell. */
  end: number;
  /** Null for the first stop: there is nowhere it came from. */
  leg: TurnLeg | null;
}

function legBetween(fromBlock: string, toBlock: string): TurnLeg | null {
  const a = blockAt(fromBlock);
  const b = blockAt(toBlock);
  if (!a || !b) return null;
  if (a.id === b.id) {
    /* Two consecutive stops inside one system — approvals and the ledger both live in
       `sys-record`. The light hops part to part along the block's lid rather than leaving it. */
    return { points: [], length: 0, flow: "across", onPipe: true };
  }
  const { points, flow } = route(a, b);
  const onPipe = SCENE.pipes.some(
    (p) => (p.from === a.id && p.to === b.id) || (p.from === b.id && p.to === a.id),
  );
  return { points, length: measure(points).length, flow, onPipe };
}

function build(): TurnBeatStop[] {
  const out: TurnBeatStop[] = [];
  let clock = 0;
  SCRIPT.forEach((s, index) => {
    const component = componentById(s.part);
    /* A stop that names a component the model does not have is a broken turn, not a missing
       label. `test/turn.test.ts` asserts this never happens; the fallback keeps a dev build
       from exploding while somebody is editing the model. */
    const block = component?.system ?? "sys-lane";
    const previous = out[index - 1];
    const leg = previous ? legBetween(previous.block, block) : null;
    const start = clock;
    const arrive = start + (index === 0 ? s.travel : leg && leg.length > 0 ? s.travel : s.travel * 0.4);
    const end = arrive + s.dwell;
    clock = end;
    out.push({ ...s, block, index, start, arrive, end, leg });
  });
  return out;
}

/** The scripted turn, with its clock resolved. A constant. */
export const TURN: readonly TurnBeatStop[] = build();

/** The whole turn, in beats. The transport's scrub runs 0 → this. */
export const TURN_BEATS: number = TURN[TURN.length - 1]?.end ?? 0;

/** Where the light is, and what is lit, at a given beat. The one function all three renderers ask. */
export interface TurnFrame {
  /** The stop the light is at or travelling toward. Never null — the turn always has a subject. */
  stop: TurnBeatStop;
  /** World position of the light. */
  at: Vec3;
  /** Which way it is heading, for a renderer that orients a marker. */
  dir: Vec3;
  /** True while the light is parked on a stop rather than travelling. */
  parked: boolean;
  /** True only at the gate's wait — the surface may pulse rather than glide. */
  waiting: boolean;
  /** 0..1 along the current leg. 1 whenever parked. */
  t: number;
}

export function turnAt(beat: number): TurnFrame {
  const b = Math.min(TURN_BEATS, Math.max(0, beat));
  const stop = TURN.find((s) => b <= s.end) ?? TURN[TURN.length - 1]!;
  const centre = partAtOr(stop.part);
  const travelling = b < stop.arrive;
  if (!travelling || !stop.leg || stop.leg.points.length < 2) {
    return {
      stop,
      at: centre,
      dir: { x: 0, y: 1, z: 0 },
      parked: !travelling,
      waiting: !travelling && stop.kind === "wait",
      t: 1,
    };
  }
  const span = stop.arrive - stop.start;
  const t = span <= 0 ? 1 : (b - stop.start) / span;
  const { at, dir } = pointOn(stop.leg.points, t);
  return { stop, at, dir, parked: false, waiting: false, t };
}

/** The lid of the part a stop names — the light sits on top of the part, not inside it. */
function partAtOr(id: string): Vec3 {
  for (const block of SCENE.blocks) {
    for (const p of block.parts) {
      if (p.id === id) return { x: p.x, y: p.y + p.h, z: p.z };
    }
  }
  return { x: 0, y: 0, z: 0 };
}

/** The beat a stop is best read at — mid-dwell, which is what the transport's steps snap to. */
export const beatOfStop = (index: number): number => {
  const s = TURN[Math.min(TURN.length - 1, Math.max(0, index))]!;
  return s.arrive + (s.end - s.arrive) / 2;
};

/** Which stop a beat belongs to, for the transport's read-out. */
export const stopAtBeat = (beat: number): TurnBeatStop => turnAt(beat).stop;

/** Every part the turn touches, for the scene's "on the path" weight. */
export const TURN_PARTS: ReadonlySet<string> = new Set(TURN.map((s) => s.part));
export const TURN_BLOCKS: ReadonlySet<string> = new Set(TURN.map((s) => s.block));
