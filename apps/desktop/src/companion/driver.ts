/**
 * The machine's runtime — ADR 0026 ("Named states"), README section 3.1.
 *
 * `machine.ts` is pure and asks for things; this is the one place that does them. The clock is an
 * argument: the window passes `setTimeout`, the test passes a virtual one, and so a ten-second
 * pulse and a 380ms shrink are asserted without waiting for either.
 *
 * One timer per `TimerKey`. Scheduling a key that is already pending replaces it, which is the
 * winner's `clearTimeout(S.attnT)` and is why a second card restarts the pulse instead of
 * stacking a second one.
 */
import { INITIAL, reduce, type Effect, type Event, type MachineState, type TimerKey } from "./machine";

export interface Clock {
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

export const REAL_CLOCK: Clock = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface Driver {
  dispatch: (event: Event) => void;
  get: () => MachineState;
  /** Stop every pending timer. The window is closing. */
  dispose: () => void;
}

export interface DriverOptions {
  clock?: Clock;
  /** Everything that is not a timer: a size to ask Rust for, an answer to send. */
  run: (effect: Exclude<Effect, { type: "schedule" | "cancel" }>) => void;
  /** Hear every new state. */
  onState?: (state: MachineState, previous: MachineState) => void;
  /** A timer's event may need a fact only the window knows (is focus inside her?) at fire time. */
  decorate?: (event: Event) => Event;
  initial?: MachineState;
}

export function createDriver(options: DriverOptions): Driver {
  const clock = options.clock ?? REAL_CLOCK;
  const pending = new Map<TimerKey, unknown>();
  let state = options.initial ?? INITIAL;

  const dispatch = (event: Event): void => {
    const previous = state;
    const [next, effects] = reduce(state, event);
    state = next;
    for (const effect of effects) {
      if (effect.type === "schedule") {
        const held = pending.get(effect.key);
        if (held !== undefined) clock.clear(held);
        pending.set(
          effect.key,
          clock.set(() => {
            pending.delete(effect.key);
            dispatch(options.decorate ? options.decorate(effect.event) : effect.event);
          }, effect.ms),
        );
      } else if (effect.type === "cancel") {
        const held = pending.get(effect.key);
        if (held !== undefined) clock.clear(held);
        pending.delete(effect.key);
      } else {
        options.run(effect);
      }
    }
    if (state !== previous) options.onState?.(state, previous);
  };

  return {
    dispatch,
    get: () => state,
    dispose: () => {
      for (const held of pending.values()) clock.clear(held);
      pending.clear();
    },
  };
}
