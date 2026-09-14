/**
 * THE TURN — README §3.2, as an ordered path across the sheet.
 *
 * This is round 3's script, kept, with the scene arithmetic taken out of it. Round 3 spent the
 * turn as a light travelling routed pipes through a 3D machine; the owner's verdict retired the
 * machine, and what survived is the part that was never about 3D at all: **twelve stops, in
 * order, each naming a real module, each carrying the README section it was read from.** That is
 * an argument about this repository, and it reads better as a numbered path on a drawing than as
 * a glow in a volume — a reader can see all twelve at once and still be told which one is current.
 *
 * EVERY STOP IS A REAL PART. `test/plan.test.ts` fails if a stop names a component the model does
 * not have, and fails again if the stops do not touch all six layers. That test is what keeps the
 * turn honest: a path whose stops drifted away from the extracted model would be a decorative
 * loop with an architectural theme.
 *
 * ONE SHORT LABEL PER STOP, under sixty characters. Prose lives at L2 and nowhere else.
 *
 * NO CLOCK. Round 3 scored the turn in beats because a light had to travel; a path that is drawn
 * all at once has nothing to interpolate, so the transport is gone with it and the Turn view has a
 * STEP control instead — twelve discrete stops, one lit at a time, `←`/`→` and a slider. Reduced
 * motion therefore needs no special branch here at all, which is the round-4 form of the round-3
 * finding that a *sequence a reader is reading* is not a transition.
 */
import { componentById, systemById } from "@/data";

/** What kind of moment a stop is — the drawing marks the gate and the ledger. */
export type StopKind = "enter" | "compose" | "run" | "gate" | "wait" | "write" | "return";

export interface TurnStop {
  /** The component the stop happens in. Must exist in the model. */
  part: string;
  /** The one label, under sixty characters. */
  label: string;
  kind: StopKind;
  /** Where in README the step was read from. This app's one content rule. */
  cite: string;
}

/**
 * The script. Twelve stops, read straight off README §3.2 in order, with §3.3's gate expanded
 * into the three moments it actually is (the hook fires, the class is decided in the catalog, the
 * manifest's flags answer) and invariant 6's ledger row added, because a turn that never costs
 * anything is not this repository's turn.
 */
const SCRIPT: readonly TurnStop[] = [
  {
    part: "cmp-mod-panel",
    label: "a message, with host_state, fenced",
    kind: "enter",
    cite: "README §3.2.1",
  },
  {
    part: "cmp-daemon-routes",
    label: "POST /run — the stream opens",
    kind: "enter",
    cite: "README §3.1 channels, §3.2.1",
  },
  { part: "cmp-lane", label: "one turn, streamed", kind: "run", cite: "README §3.1 lane" },
  {
    part: "cmp-prompt",
    label: "static blocks, and a turn frame",
    kind: "compose",
    cite: "README §3.2.2",
  },
  {
    part: "cmp-cli-harness",
    label: "up to eight rounds — one turn",
    kind: "run",
    cite: "README §3.2.3",
  },
  {
    part: "cmp-hooks",
    label: "every tool call passes the gate",
    kind: "gate",
    cite: "README §3.2.4",
  },
  { part: "cmp-catalog", label: "reversible? external? → GATED", kind: "gate", cite: "README §3.3" },
  {
    part: "cmp-c-manifest",
    label: "the manifest's own flags decide the class",
    kind: "gate",
    cite: "README §3.3",
  },
  {
    part: "cmp-approvals",
    label: "an approval row. The turn waits.",
    kind: "wait",
    cite: "README §3.2.4, §3.2.6",
  },
  {
    part: "cmp-ledger",
    label: "one row, failures included",
    kind: "write",
    cite: "README §2, invariant 6",
  },
  {
    part: "cmp-daemon-sessions",
    label: "the stream carries it up",
    kind: "return",
    cite: "README §3.1 channels",
  },
  { part: "cmp-mod-panel", label: "back where it started", kind: "return", cite: "README §3.2.6" },
];

export interface TurnPoint extends TurnStop {
  /** 0-based. The reader is shown `index + 1`. */
  index: number;
  /** The system the stop's component belongs to — the block that lights. Derived, never typed. */
  block: string;
  /** The layer that system sits in. */
  layer: string;
  /** True when this stop returns to a block an earlier stop already visited. */
  revisit: boolean;
}

function build(): TurnPoint[] {
  const seen = new Set<string>();
  return SCRIPT.map((s, index) => {
    const component = componentById(s.part);
    /* A stop that names a component the model does not have is a broken turn, not a missing
       label. The test asserts this never happens; the fallback keeps a dev build from exploding
       while somebody is editing the model. */
    const block = component?.system ?? "sys-lane";
    const layer = systemById(block)?.layer ?? "lane";
    const revisit = seen.has(block);
    seen.add(block);
    return { ...s, index, block, layer, revisit };
  });
}

/** The scripted turn. A constant. */
export const TURN: readonly TurnPoint[] = build();

/** The blocks the turn visits, in first-visit order — the Turn view's own reading order. */
export const TURN_BLOCKS: readonly string[] = [...new Set(TURN.map((s) => s.block))];

/** Every part the turn touches, for the "on the path" weight. */
export const TURN_PARTS: ReadonlySet<string> = new Set(TURN.map((s) => s.part));

/** The one stop the turn waits at. There is exactly one, and the test says so. */
export const GATE_STOP: number = TURN.findIndex((s) => s.kind === "wait");

/** The stop that writes the ledger row. */
export const LEDGER_STOP: number = TURN.findIndex((s) => s.kind === "write");

export const stopAt = (index: number): TurnPoint =>
  TURN[Math.min(TURN.length - 1, Math.max(0, index))]!;
