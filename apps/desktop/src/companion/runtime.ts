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
 * **Answering.** The answer goes to the run store at once, when the person presses, and the slip
 * stays on screen for the stamp. The store drops the card immediately (`run.answer` filters it
 * before the daemon replies), so the runtime keeps the card it answered (`held`) until the slip
 * has torn away, and the view-model draws it from there.
 */
import type { AthenaState, Side, Valign } from "@/lib/companion";
import type { DecisionRequested } from "@/lib/events";

import { createDriver, REAL_CLOCK, type Clock, type Driver } from "./driver";
import { INITIAL, type Choice, type Effect, type Event, type MachineState } from "./machine";
import type { LedgerSnapshot, SessionDecision } from "./model";

export interface RuntimeDeps {
  clock?: Clock;
  size: (name: AthenaState, side: Side, valign: Valign) => void;
  show: () => void;
  hide: () => void;
  pin: (on: boolean) => void;
  /** The run store's waiting cards, now. */
  cards: () => readonly DecisionRequested[];
  answer: (id: string, choice: string) => void;
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
  decisions: readonly SessionDecision[];
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
  let decisions: SessionDecision[] = [];
  let ledger: LedgerSnapshot | null = null;
  let snapshot: Snapshot = { machine: INITIAL, held, decisions, ledger };
  let chain: Promise<void> = Promise.resolve();

  const publish = (machine: MachineState) => {
    snapshot = { machine, held, decisions, ledger };
    listeners.forEach((l) => l());
  };

  const run = (effect: Exclude<Effect, { type: "schedule" | "cancel" }>): void => {
    switch (effect.type) {
      case "size":
        deps.size(effect.name, effect.side, effect.valign);
        break;
      case "show":
        deps.show();
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
        if (!card) break;
        held = card;
        decisions = [
          { id: card.id, action: card.action, result: effect.kind === "approve" ? "approved" : "user_denied" },
          ...decisions,
        ];
        deps.answer(card.id, choiceFor(card, effect.kind));
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
export function lineOf(form: AthenaState, step: { app: string; what: string } | null): string {
  if (form === "hear") return "listening";
  if (form !== "tape" || !step) return "";
  const text = `${step.app}: ${step.what}`;
  return text.length > LINE_MAX ? `${text.slice(0, LINE_MAX)} (showing ${LINE_MAX} of ${text.length})` : text;
}

export const LINE_MAX = 80;
