/**
 * Telling Rust which shape the window is in — README section 3.5, ADR 0088 and 0215.
 *
 * The depth path decides the shape (`shapeOf`); Rust owns the rectangles. This is the one seam:
 * when the shape changes, the shell is sent `layout_select` with the shape's id, and Rust re-lays
 * the window and hides or shows the focused page. The ids are Rust's (`layout.rs` `PAGE_SHAPE` and
 * `SCENE_SHAPE`), and a test reads that file to keep the two spellings equal.
 *
 * The depth is the one authority (ADR 0215), so the seam is a channel, not a fire-and-forget push:
 * - at most one select is in flight, because `layout_select` is an async command and two invokes
 *   in flight have no order between them;
 * - a shape wanted while one is in flight waits in one slot, and only the latest is kept;
 * - every select Rust accepts is announced back (`layout:changed`), so each send owes one echo, and
 *   an owed echo is consumed, never acted on: it describes the depth as it was, not as it is;
 * - a refused select leaves Rust's shape unknown, so the next want is sent even if it is equal;
 * - an announcement nobody is owed that disagrees with the depth re-sends the depth's shape.
 *   Nothing in a layout event ever moves the depth.
 *
 * Started by the app root once the stage replaces the module bar. With no shell it does nothing.
 */
import { hasShell, layoutSelect } from "@/lib/ipc";

import { shapeOf, type Shape } from "./model";
import { useDepth } from "./store";

export const SHAPE_ID: Readonly<Record<Shape, string>> = { page: "page", scene: "scene" };

export interface ShapeSyncState {
  /** Nothing in flight or waiting, and Rust last accepted the shape the depth wants. */
  synced: boolean;
  /** Announcements still owed for selects sent. */
  owed: number;
}

interface Channel {
  want(shape: Shape, force?: boolean): void;
  heard(shape: string): void;
  state(): ShapeSyncState;
  stop(): void;
}

function channel(send: (id: string) => Promise<void>, current: () => Shape): Channel {
  let inFlight: Shape | null = null;
  let pending: Shape | null = null;
  /** What Rust last accepted; null when unknown (nothing yet, or a select was refused). */
  let delivered: Shape | null = null;
  let owed = 0;
  let stopped = false;

  const deliver = (shape: Shape) => {
    inFlight = shape;
    owed += 1;
    void send(SHAPE_ID[shape])
      .then(
        () => {
          delivered = shape;
        },
        (e: unknown) => {
          // A refusal is logged, not thrown: the stage must not break because a re-lay did not
          // land. Rust announces only what it selected, so a refused select owes no echo.
          owed = Math.max(0, owed - 1);
          delivered = null;
          console.error("[athena] layout_select", e);
        },
      )
      .finally(() => {
        inFlight = null;
        const next = pending;
        pending = null;
        if (next !== null && !stopped) want(next);
      });
  };

  function want(shape: Shape, force = false) {
    if (stopped) return;
    if (force) delivered = null;
    if (inFlight !== null) {
      pending = shape;
      return;
    }
    if (shape === delivered) return;
    deliver(shape);
  }

  return {
    want,
    heard(shape) {
      if (owed > 0) {
        owed -= 1;
        return;
      }
      const now = current();
      if (shape !== SHAPE_ID[now]) want(now, true);
    },
    state: () => ({
      synced: inFlight === null && pending === null && delivered !== null && delivered === current(),
      owed,
    }),
    stop() {
      stopped = true;
    },
  };
}

let active: Channel | null = null;

/** Send the shape whenever it changes, and once at the start. Returns the stop function. */
export function startShapeSync(send: (id: string) => Promise<void> = layoutSelect): () => void {
  if (send === layoutSelect && !hasShell()) return () => {};
  const current = () => shapeOf(useDepth.getState().path);
  const ch = channel(send, current);
  active = ch;
  ch.want(current());
  // Every move is offered, not only a change of shape: an equal shape costs nothing, and after a
  // refusal the next move is what re-sends it.
  const stop = useDepth.subscribe((s, prev) => {
    if (s.path !== prev.path) ch.want(shapeOf(s.path));
  });
  return () => {
    stop();
    ch.stop();
    if (active === ch) active = null;
  };
}

/** Rust announced a shape (`layout:changed`): consume an owed echo, or reconcile Rust to the depth. */
export function heardLayout(shape: string): void {
  active?.heard(shape);
}

/** Where the channel stands, for tests and a diagnostic. With no channel running, nothing is owed. */
export function shapeSyncState(): ShapeSyncState {
  return active?.state() ?? { synced: false, owed: 0 };
}
