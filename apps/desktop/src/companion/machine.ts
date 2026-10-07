/**
 * The companion's state machine — ADR 0026 ("Named states", "Hide means put away, not mute"),
 * README section 3.1; the behaviour is The Countersign's (`athena.js` of the winning entry).
 *
 * **Pure.** `reduce(state, event)` returns the next state and a list of effects; it reads no
 * clock, starts no timer and calls no command. A timer is an effect (`schedule`) whose `event`
 * comes back through `reduce` when it fires, and the runtime (`driver.ts`) is the only place a
 * real one exists. That is what lets every timing in the brief — the ten-second pulse, the 45
 * second dim, the 6 second peek, the 380ms shrink — be asserted in a test with a virtual clock.
 *
 * **The form is derived, not stored.** What she looks like is a function of the raw facts (cards
 * waiting, working, listening, docked, which mode the user chose) and `formOf` is that function,
 * in priority order. The winner wrote the same thing imperatively as a dozen `setState` calls;
 * deriving it makes "a card arrived while she was hidden" and "the slip was answered while she
 * was docked" the same rule rather than two paths that have to agree.
 *
 * **Sizes.** A form whose rectangle is at least as large as the last one asked for is requested
 * at once, before the paper unrolls; a smaller one is requested `SHRINK_MS` later, once the paper
 * has torn away, and only if she is still in that form by then. Nothing is sent on hover, because
 * nothing here listens to hover. While that smaller size waits, `leaving` names the form the window
 * is still sized for, so a collapse to the seal can be drawn as one motion inside the old rectangle
 * instead of an empty one.
 */
import { SIZES, type AthenaState, type Side, type Valign } from "@/lib/companion";

export type Dock = "left" | "right";
export type LedgerTab = "talk" | "record" | "origins";
/** `auto` is whatever the facts say; `ledger` and `welcome` are chosen and sticky. */
export type Mode = "auto" | "ledger" | "welcome";
export type By = "click" | "key" | "voice" | "chord";
export type Choice = "approve" | "decline";

/** The attention pulse on a new card, then a steady ring (ms). */
export const ATTN_MS = 10_000;
/** Rest before she dims to 55% (ms). */
export const QUIET_MS = 45_000;
/** How long a peek from the tab lasts when nothing is waiting (ms). */
export const PEEK_MS = 6_000;
/** The paper has torn away by now; a smaller rectangle may be asked for (ms). */
export const SHRINK_MS = 380;
/** The stamp has landed and the slip tears off (ms after the daemon took the answer). */
export const TEAR_MS = 900;
/** The slip is gone and she returns to whatever she was (ms after the daemon took the answer). */
export const SETTLE_MS = 1_500;
/** A turn that has just ended stays on the tape this long, so its last line can be read (ms). */
export const LINGER_MS = 2_500;

export interface Decided {
  kind: Choice;
  by: By;
  /**
   * The answer is on its way and the daemon has not said yes. The card is still the card: there is no
   * stamp, no "Approved", and the buttons read "Sending..." until `sent` arrives (UAT backlog B1).
   */
  sending: boolean;
  /** The slip has started to tear off the housing. */
  tearing: boolean;
  /** The store has already dropped the card; it is still drawn until the slip has torn away. */
  dropped: boolean;
}

export interface MachineState {
  ready: boolean;
  mode: Mode;
  hidden: boolean;
  docked: Dock | null;
  side: Side;
  valign: Valign;
  /** Cards the store holds. A card being stamped is counted through `decided.dropped`. */
  cards: number;
  /** The slip was put away (Esc) or arrived while she was hidden: waiting, but not open. */
  snoozed: boolean;
  working: boolean;
  listening: boolean;
  decided: Decided | null;
  /** Clicked out from the tab; tucks back after `PEEK_MS`. */
  peek: boolean;
  /** A turn has just ended and its last line is still on the tape. */
  lingering: boolean;
  /** The ten-second pulse after a card arrives. */
  attn: boolean;
  /** Resting for `QUIET_MS`: drawn at 55%. */
  quiet: boolean;
  pinned: boolean;
  tab: LedgerTab;
  /** Bumped when the paper should unroll again; the view keys the paper on it. */
  epoch: number;
  /** Bumped when she comes back from hidden; the view keys the figure on it. */
  arrive: number;
  /** The form last drawn, and the size name last asked for. */
  form: AthenaState;
  sized: AthenaState;
  /** The larger form the window still has while a shrink waits, with its paper's epoch; else null. */
  leaving: { form: AthenaState; epoch: number } | null;
  /** The last change of form grew her out of the seal (or the tab): the view unfolds it. */
  opened: boolean;
  /** What a screen reader is told, with a counter so the same sentence can be said twice. */
  say: { n: number; text: string };
}

export type Event =
  | { t: "init"; onboarded: boolean; cards: number; hidden?: boolean }
  | { t: "onboarded"; value: boolean }
  | { t: "cards"; n: number; hidden?: boolean }
  | { t: "work"; on: boolean }
  | { t: "listen"; on: boolean }
  | { t: "decide"; kind: Choice; by: By }
  /** The daemon's verdict on the answer. `text` is what a screen reader is told when it was refused. */
  | { t: "sent"; ok: boolean; text?: string }
  | { t: "seal" }
  | { t: "esc" }
  | { t: "expand" }
  | { t: "tab"; tab: LedgerTab }
  | { t: "summon" }
  | { t: "show" }
  | { t: "hide" }
  | { t: "snap"; docked: Dock | null }
  | { t: "orient"; side: Side; valign: Valign }
  | { t: "open" }
  | { t: "later" }
  | { t: "pin" }
  | { t: "poke" }
  // timers, scheduled by `reduce` and delivered back by the driver
  | { t: "tear" }
  | { t: "settle" }
  | { t: "attnEnd" }
  | { t: "quietStart" }
  | { t: "peekEnd"; focusIn: boolean }
  | { t: "lingerEnd" }
  | { t: "shrink"; name: AthenaState };

export type TimerKey = "tear" | "settle" | "attn" | "quiet" | "peek" | "linger" | "shrink";

export type Effect =
  | { type: "size"; name: AthenaState; side: Side; valign: Valign }
  | { type: "schedule"; key: TimerKey; ms: number; event: Event }
  | { type: "cancel"; key: TimerKey }
  | { type: "answer"; kind: Choice; by: By }
  /** `focus: false` shows her without taking the keyboard (a card arriving over someone's work). */
  | { type: "show"; focus?: boolean }
  | { type: "hide" }
  | { type: "pin"; on: boolean }
  | { type: "onboard" }
  | { type: "focus"; target: "approve" | "seal" };

export const INITIAL: MachineState = {
  ready: false,
  mode: "auto",
  hidden: false,
  docked: null,
  side: "left",
  valign: "down",
  cards: 0,
  snoozed: false,
  working: false,
  listening: false,
  decided: null,
  peek: false,
  lingering: false,
  attn: false,
  quiet: false,
  pinned: true,
  tab: "talk",
  epoch: 0,
  arrive: 0,
  form: "seal",
  sized: "seal",
  leaving: null,
  opened: false,
  say: { n: 0, text: "" },
};

/** Her quiet home form: a tab on a screen edge, a seal anywhere else. */
export function home(s: Pick<MachineState, "docked">): AthenaState {
  return s.docked ? "tab" : "seal";
}

/** Cards as the person sees them: one being stamped still counts until its slip has torn away. */
export function shown(s: Pick<MachineState, "cards" | "decided">): number {
  return s.cards + (s.decided?.dropped ? 1 : 0);
}

/**
 * What she looks like, in priority order. A stamp in progress outranks everything but a chosen
 * mode, so the slip is never pulled out from under the stamp; a card outranks a turn because the
 * turn can wait and the person cannot be asked twice.
 */
export function formOf(s: MachineState): AthenaState {
  if (s.mode === "welcome") return "welcome";
  if (s.mode === "ledger") return "ledger";
  if (s.decided) return "slip";
  const waiting = shown(s) > 0;
  if (waiting && !s.snoozed && !s.hidden) return "slip";
  if (s.listening && !waiting) return "hear";
  if (s.working || s.lingering) return "tape";
  if (s.peek && s.docked) return "seal";
  return home(s);
}

const area = (name: AthenaState): number => SIZES[name].w * SIZES[name].h;

/** The next state and the effects it asks for. */
export function reduce(prev: MachineState, event: Event): [MachineState, Effect[]] {
  const fx: Effect[] = [];
  const s: MachineState = { ...prev };
  step(s, prev, event, fx);
  finalize(s, prev, event, fx);
  return [s, fx];
}

function say(s: MachineState, text: string): void {
  s.say = { n: s.say.n + 1, text };
}

function schedule(fx: Effect[], key: TimerKey, ms: number, event: Event): void {
  fx.push({ type: "schedule", key, ms, event });
}

function step(s: MachineState, prev: MachineState, event: Event, fx: Effect[]): void {
  switch (event.t) {
    case "init": {
      s.ready = true;
      s.mode = event.onboarded ? "auto" : "welcome";
      s.cards = event.cards;
      s.hidden = event.hidden ?? false;
      if (event.cards > 0) {
        s.attn = true;
        schedule(fx, "attn", ATTN_MS, { t: "attnEnd" });
      }
      // A card already waiting when she starts is a quiet one: she does not open over the work.
      s.snoozed = event.cards > 0;
      return;
    }
    case "onboarded": {
      if (event.value && s.mode === "welcome") s.mode = "auto";
      return;
    }
    case "cards": {
      const arrived = event.n > prev.cards;
      const left = event.n < prev.cards;
      s.cards = event.n;
      if (left && s.decided) s.decided = { ...s.decided, dropped: true };
      if (arrived) {
        s.attn = true;
        s.quiet = false;
        s.peek = false;
        schedule(fx, "attn", ATTN_MS, { t: "attnEnd" });
        fx.push({ type: "cancel", key: "peek" });
        const wasHidden = event.hidden ?? s.hidden;
        if (wasHidden) {
          // Put away, not mute: she comes back as her quiet home form with a ring and a count.
          s.hidden = false;
          s.snoozed = true;
          s.arrive += 1;
          fx.push({ type: "show", focus: false });
          say(s, `A decision is waiting on you. Open her to answer.`);
        } else {
          if (!s.decided) s.snoozed = false;
          say(s, `A decision is waiting on you. Press A to approve, D to decline.`);
        }
      }
      if (event.n === 0) {
        s.attn = false;
        if (!s.decided) s.snoozed = false;
        fx.push({ type: "cancel", key: "attn" });
      }
      return;
    }
    case "work": {
      s.working = event.on;
      if (event.on) {
        s.lingering = false;
        s.quiet = false;
        fx.push({ type: "cancel", key: "linger" });
      } else if (prev.working) {
        s.lingering = true;
        schedule(fx, "linger", LINGER_MS, { t: "lingerEnd" });
      }
      return;
    }
    case "lingerEnd": {
      s.lingering = false;
      return;
    }
    case "listen": {
      s.listening = event.on;
      if (event.on) {
        s.quiet = false;
        // Speaking to a card that is put away brings the slip back, so the answer can be seen.
        if (shown(s) > 0) s.snoozed = false;
      }
      return;
    }
    case "decide": {
      if (s.decided || shown(s) === 0) return;
      // A chord answers only a card the person can see (UAT B9, mira-7): from a put-away or
      // snoozed state it brings the slip up and waits for a second press.
      if (event.by === "chord" && (s.hidden || s.snoozed)) {
        if (s.hidden) {
          s.hidden = false;
          s.arrive += 1;
          fx.push({ type: "show" });
        }
        s.snoozed = false;
        s.peek = false;
        if (s.mode === "ledger") s.tab = "talk";
        say(s, "A decision is waiting. Press the key again to answer it.");
        return;
      }
      if (s.hidden) {
        s.hidden = false;
        s.arrive += 1;
        fx.push({ type: "show" });
      }
      // An answer from the chord or the voice is made where the person can see the stamp.
      if (s.mode === "ledger") s.tab = "talk";
      s.snoozed = false;
      s.peek = false;
      // The answer goes out, but nothing is stamped: the daemon has not said yes yet.
      s.decided = { kind: event.kind, by: event.by, sending: true, tearing: false, dropped: false };
      fx.push({ type: "answer", kind: event.kind, by: event.by });
      say(s, "Sending your answer.");
      return;
    }
    case "sent": {
      if (!s.decided || !s.decided.sending) return;
      if (!event.ok) {
        // Refused: the card is still the card, the buttons come back, and the reason is said.
        const kind = s.decided.kind;
        s.decided = null;
        say(s, event.text ?? `That answer was refused. The decision is still waiting. (${kind})`);
        return;
      }
      s.decided = { ...s.decided, sending: false };
      schedule(fx, "tear", TEAR_MS, { t: "tear" });
      schedule(fx, "settle", SETTLE_MS, { t: "settle" });
      say(
        s,
        s.decided.kind === "approve"
          ? "Approved. Stamped and sent to the record."
          : "Declined. Nothing was sent.",
      );
      return;
    }
    case "tear": {
      if (s.decided) s.decided = { ...s.decided, tearing: true };
      return;
    }
    case "settle": {
      if (!s.decided) return;
      s.decided = null;
      // The next card's slip unrolls fresh; from the ledger the paper is left as it is.
      if (s.mode === "auto") s.epoch += 1;
      if (s.cards === 0) s.snoozed = false;
      return;
    }
    case "seal": {
      const form = prev.form;
      if (form === "tab") {
        s.peek = true;
        if (shown(s) === 0) schedule(fx, "peek", PEEK_MS, { t: "peekEnd", focusIn: false });
      } else if (form === "ledger") {
        s.mode = "auto";
      } else if (form === "slip") {
        s.mode = "ledger";
        s.tab = "talk";
      } else if (form === "welcome") {
        // the seal is not a way out of the first-launch page
      } else if (shown(s) > 0) {
        s.snoozed = false;
        s.peek = false;
      } else {
        s.mode = "ledger";
      }
      return;
    }
    case "esc": {
      const form = prev.form;
      if (form === "welcome") {
        s.mode = "auto";
      } else if (form === "slip") {
        if (s.decided) return;
        s.snoozed = true;
        say(s, "The decision is still waiting. Open her again when you are ready.");
      } else if (form === "ledger") {
        s.mode = "auto";
      } else if (form === "seal" && s.docked) {
        s.peek = false;
      }
      return;
    }
    case "expand": {
      if (s.hidden) {
        s.hidden = false;
        s.arrive += 1;
        fx.push({ type: "show" });
      }
      if (s.mode !== "welcome") s.mode = "ledger";
      return;
    }
    case "tab": {
      s.tab = event.tab;
      return;
    }
    case "summon": {
      if (s.hidden) {
        s.hidden = false;
        s.arrive += 1;
        fx.push({ type: "show" });
      }
      if (s.mode === "welcome") {
        fx.push({ type: "focus", target: "seal" });
        return;
      }
      if (prev.form === "tab" && shown(s) === 0) {
        s.peek = true;
        schedule(fx, "peek", PEEK_MS, { t: "peekEnd", focusIn: false });
      }
      if (shown(s) > 0) {
        s.snoozed = false;
        s.peek = false;
        s.mode = "auto";
        fx.push({ type: "focus", target: "approve" });
      } else {
        fx.push({ type: "focus", target: "seal" });
      }
      return;
    }
    case "show": {
      s.hidden = false;
      s.arrive += 1;
      fx.push({ type: "show" });
      return;
    }
    case "hide": {
      if (s.hidden) return;
      s.hidden = true;
      fx.push({ type: "hide" });
      return;
    }
    case "snap": {
      s.docked = event.docked;
      if (!event.docked) s.peek = false;
      return;
    }
    case "orient": {
      s.side = event.side;
      s.valign = event.valign;
      return;
    }
    case "open": {
      if (s.mode !== "welcome") return;
      s.mode = "auto";
      fx.push({ type: "onboard" });
      return;
    }
    case "later": {
      if (s.mode === "welcome") s.mode = "auto";
      return;
    }
    case "pin": {
      s.pinned = !s.pinned;
      fx.push({ type: "pin", on: s.pinned });
      return;
    }
    case "poke": {
      s.quiet = false;
      return;
    }
    case "attnEnd": {
      s.attn = false;
      return;
    }
    case "quietStart": {
      if ((s.form === "seal" || s.form === "tab") && shown(s) === 0) s.quiet = true;
      return;
    }
    case "peekEnd": {
      if (s.form === "seal" && s.docked && !event.focusIn && shown(s) === 0) s.peek = false;
      return;
    }
    case "shrink": {
      if (s.form === event.name) {
        s.leaving = null;
        fx.push({ type: "size", name: event.name, side: s.side, valign: s.valign });
      }
      return;
    }
  }
}

/** What follows from the new facts: the form, the size it asks for, the dim, the paper's epoch. */
function finalize(s: MachineState, prev: MachineState, event: Event, fx: Effect[]): void {
  if (!s.ready) return;
  const form = formOf(s);
  const changed = form !== prev.form || !prev.ready;
  s.form = form;

  if (form !== "seal" && s.peek) s.peek = false;

  if (changed) {
    if (s.epoch === prev.epoch) s.epoch += 1;
    const grow = !prev.ready || area(form) >= area(prev.sized);
    const home = (f: AthenaState) => f === "seal" || f === "tab";
    s.opened = prev.ready && grow && home(prev.form) && !home(form);
    if (grow) {
      s.leaving = null;
      fx.push({ type: "cancel", key: "shrink" });
      fx.push({ type: "size", name: form, side: s.side, valign: s.valign });
    } else {
      // The window keeps the rectangle it actually has: the first form of a chain of shrinks.
      s.leaving ??= { form: prev.sized, epoch: prev.epoch };
      schedule(fx, "shrink", SHRINK_MS, { t: "shrink", name: form });
    }
    s.sized = form;
  } else if (s.arrive !== prev.arrive) {
    // She comes back from hidden: the window may be any size it was left at, so say it again.
    fx.push({ type: "size", name: form, side: s.side, valign: s.valign });
  }

  // The dim: resting for 45 seconds in a home form with nothing waiting.
  const wasResting = (prev.form === "seal" || prev.form === "tab") && shown(prev) === 0 && prev.ready;
  const resting = (form === "seal" || form === "tab") && shown(s) === 0;
  if (!resting) {
    if (s.quiet) s.quiet = false;
    if (wasResting) fx.push({ type: "cancel", key: "quiet" });
  } else if (!wasResting || event.t === "poke") {
    schedule(fx, "quiet", QUIET_MS, { t: "quietStart" });
  }
}
