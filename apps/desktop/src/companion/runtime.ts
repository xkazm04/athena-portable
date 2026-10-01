/**
 * The companion's runtime — ADR 0026 ("The IPC contract", "Hide means put away, not mute"),
 * README section 3.1.
 *
 * This is the seam between the pure machine and everything that is not pure: Rust, the run store
 * and the clock. Every one of them is an argument (`RuntimeDeps`), so the tests here drive the
 * whole thing — a card arriving while she is hidden, an answer, the size requests that follow —
 * with fakes and a virtual clock, and `live.tsx` is the one file that passes the real ones.
 *
 * It is a small external store (`subscribe` / `getSnapshot`) rather than React state, because the
 * machine's timers fire outside React and a snapshot that is replaced on change is exactly what
 * `useSyncExternalStore` wants.
 *
 * **Answering.** The answer goes to the run store at once, when the person presses, but nothing is
 * stamped until the daemon has taken it: the store calls `settled` with its verdict and the runtime
 * turns that into the machine's `sent` event (UAT backlog B1). A refusal keeps the card and clears
 * the `sending` state; a success starts the stamp. The store drops the card when the daemon says
 * yes, so the runtime keeps the card it answered (`held`) until the slip has torn away, and the
 * view-model draws it from there.
 */
import type { AthenaState, Side, Valign } from "@/lib/companion";
import type { DecisionRequested } from "@/lib/events";
import type { Settled } from "@/stores/run";

import { createDriver, REAL_CLOCK, type Clock, type Driver } from "./driver";
import { INITIAL, type Choice, type Effect, type Event, type MachineState } from "./machine";
import type { LedgerSnapshot } from "./model";

export interface RuntimeDeps {
  clock?: Clock;
  size: (name: AthenaState, side: Side, valign: Valign) => void;
  /** `focus: false` shows her without taking the keyboard from the app the person is in. */
  show: (focus?: boolean) => void;
  hide: () => void;
  pin: (on: boolean) => void;
  /** The run store's waiting cards, now. */
  cards: () => readonly DecisionRequested[];
  /** Send the answer. `settled` is called once, when the daemon has taken it or refused it. */
  answer: (id: string, choice: string, settled: (result: Settled) => void) => void;
  onboard: () => void;
  focus: (target: "approve" | "seal") => void;
  /** Is her window on screen? The page may have put her away, but the tray may have too. */
  visible: () => Promise<boolean>;
  /** Is the keyboard focus inside her? A peek stays open while it is. */
  focusIn: () => boolean;
}

export interface Snapshot {
  machine: MachineState;
  /** The card being stamped, once the store has dropped it. */
  held: DecisionRequested | null;
  ledger: LedgerSnapshot | null;
}

export interface Runtime {
  dispatch: (event: Event) => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => Snapshot;
  /** The run store's cards changed. Ordered: an arrival waits for the window's visibility. */
  cardsChanged: (cards: readonly DecisionRequested[]) => void;
  setLedger: (ledger: LedgerSnapshot | null) => void;
  /** Settled once every queued card change has been applied. For tests. */
  idle: () => Promise<void>;
  dispose: () => void;
}

export function createRuntime(deps: RuntimeDeps): Runtime {
  const listeners = new Set<() => void>();
  let held: DecisionRequested | null = null;
  let ledger: LedgerSnapshot | null = null;
  let snapshot: Snapshot = { machine: INITIAL, held, ledger };
  let chain: Promise<void> = Promise.resolve();

  const publish = (machine: MachineState) => {
    snapshot = { machine, held, ledger };
    listeners.forEach((l) => l());
  };

  const run = (effect: Exclude<Effect, { type: "schedule" | "cancel" }>): void => {
    switch (effect.type) {
      case "size":
        deps.size(effect.name, effect.side, effect.valign);
        break;
      case "show":
        deps.show(effect.focus);
        break;
      case "hide":
        deps.hide();
        break;
      case "pin":
        deps.pin(effect.on);
        break;
      case "onboard":
        deps.onboard();
        break;
      case "focus":
        deps.focus(effect.target);
        break;
      case "answer": {
        const card = deps.cards()[0];
        // The machine's `sent` is delivered on a later turn of the loop, never inside the effect.
        const settle = (r: Settled) =>
          void Promise.resolve().then(() =>
            driver.dispatch({ t: "sent", ok: r.ok, text: r.ok ? undefined : r.sentence }),
          );
        if (!card) {
          settle({ ok: false, sentence: "That decision is no longer waiting." });
          break;
        }
        held = card;
        deps.answer(card.id, choiceFor(card, effect.kind), settle);
        break;
      }
    }
  };

  const driver: Driver = createDriver({
    clock: deps.clock ?? REAL_CLOCK,
    run,
    // A peek stays open while the keyboard is inside her; only the window knows that.
    decorate: (event) => (event.t === "peekEnd" ? { ...event, focusIn: deps.focusIn() } : event),
    onState: (machine, previous) => {
      if (previous.decided && !machine.decided) held = null;
      publish(machine);
    },
  });

  return {
    dispatch: driver.dispatch,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    cardsChanged: (cards) => {
      chain = chain.then(async () => {
        const n = cards.length;
        if (n > driver.get().cards) {
          let visible = true;
          try {
            visible = await deps.visible();
          } catch {
            // No window to ask (a plain browser): she is where the page is.
          }
          driver.dispatch({ t: "cards", n, hidden: !visible });
        } else {
          driver.dispatch({ t: "cards", n });
        }
      });
    },
    setLedger: (next) => {
      ledger = next;
      publish(driver.get());
    },
    idle: () => chain,
    dispose: () => driver.dispose(),
  };
}

/** The option id the daemon knows the choice by; the card's own options are the authority. */
export function choiceFor(card: DecisionRequested, kind: Choice): string {
  return card.options.find((o) => o.id === kind)?.id ?? kind;
}

/** One line for the tray and Main's status pill: what she is doing, bounded and saying so. */
export function lineOf(
  form: AthenaState,
  step: { app: string; what: string } | null,
  running = false,
): string {
  if (form === "hear") return "listening";
  // The tape is work on its own; any other form is work only while a turn is running (UAT backlog B8),
  // and then it says so, so Main's pill never reads "working" over an idle ledger.
  if ((form !== "tape" && !running) || !step) return "";
  const text = `${step.app}: ${step.what}`;
  return text.length > LINE_MAX ? `${text.slice(0, LINE_MAX)} (showing ${LINE_MAX} of ${text.length})` : text;
}

export const LINE_MAX = 80;
