/**
 * The layers of a depth move — README section 3.1, ADR 0087 and 0089.
 *
 * A move is two layers on screen at once: the place you left, playing out, and the place you
 * arrived at, playing in. Which layers exist and what each is doing is a small state machine, kept
 * pure so an interrupted move, a calm move and a stuck animation are tested without a DOM. The
 * stage only draws what this says; CSS does the moving, on `transform` and `opacity` alone.
 *
 * A move during a move is the normal case, not an error: the layer that was arriving starts
 * leaving from wherever it got to, the ones already leaving are kept (at most two) and the newest
 * arrives. Under calm there is nothing to play, so a move is one layer at rest.
 */
import type { Move, Path } from "@/depth/model";

export type Phase =
  | "rest"
  | "enter-down"
  | "enter-up"
  | "enter-across"
  | "leave-down"
  | "leave-up"
  | "leave-across";

export interface Layer {
  /** The move's `seq`, which is unique, so it is the React key. */
  key: number;
  path: Path;
  phase: Phase;
}

/** Leaving layers kept while a newer move starts. More than two would be a pile of ghosts. */
const MAX_LEAVING = 2;

export type LayerAction =
  | { type: "move"; seq: number; path: Path; move: Move; calm: boolean }
  | { type: "ended"; key: number }
  | { type: "flush" };

export function initLayers(path: Path, seq = 0): Layer[] {
  return [{ key: seq, path, phase: "rest" }];
}

const isEnter = (p: Phase) => p.startsWith("enter-");
const isLeave = (p: Phase) => p.startsWith("leave-");

export function reduceLayers(layers: Layer[], action: LayerAction): Layer[] {
  switch (action.type) {
    case "move": {
      if (action.calm || action.move === "none") {
        return [{ key: action.seq, path: action.path, phase: "rest" }];
      }
      const leave = `leave-${action.move}` as Phase;
      const enter = `enter-${action.move}` as Phase;
      const leaving = layers
        .map((l) => ({ ...l, phase: leave }))
        .slice(-MAX_LEAVING);
      return [...leaving, { key: action.seq, path: action.path, phase: enter }];
    }
    case "ended":
      return layers.flatMap((l) => {
        if (l.key !== action.key) return [l];
        if (isLeave(l.phase)) return [];
        return [isEnter(l.phase) ? { ...l, phase: "rest" as Phase } : l];
      });
    case "flush":
      return layers.flatMap((l) =>
        isLeave(l.phase) ? [] : [isEnter(l.phase) ? { ...l, phase: "rest" as Phase } : l],
      );
  }
}

/**
 * True for the one layer whose scene is live: the arriving or resting one. A leaving layer is a
 * still of the place it was (ADR 0193), so at most one scene runs at any moment.
 */
export function isLive(layer: Layer): boolean {
  return !isLeave(layer.phase);
}

/** True when nothing is playing: one layer, at rest. */
export function isSettled(layers: Layer[]): boolean {
  return layers.length === 1 && layers[0]!.phase === "rest";
}
