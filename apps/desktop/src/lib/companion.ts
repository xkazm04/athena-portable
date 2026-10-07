/**
 * Athena's own window, typed once — ADR 0026 ("The IPC contract"), README section 3.1.
 *
 * Everything the `athena` webview says to Rust and hears from it is here, and goes through
 * `lib/ipc.ts`'s `call` and `on`, so the two rules of that file hold: `undefined` never reaches
 * the wire and a command called without a shell rejects with a sentence.
 *
 * **Rust owns the size table** (`src-tauri/src/companion.rs`). The page never sends a size, only
 * a *name*, because a size the page can choose is a size a foreign page's script could ask for
 * through a bug. `SIZES` below is a mirror, kept for the page's own layout arithmetic and pinned
 * by `companion.test.ts` to the ADR's table; it is never put on the wire.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";

import { PTT_EVENT, type PttPayload } from "@/lib/halo-signal";
import { call, hasShell, on } from "@/lib/ipc";
import { emitTo, type UnlistenFn } from "@tauri-apps/api/event";

/** The seven named states, in the ADR's order. */
export const ATHENA_STATES = ["seal", "tape", "hear", "slip", "welcome", "ledger", "tab"] as const;

export type AthenaState = (typeof ATHENA_STATES)[number];

export function isAthenaState(value: unknown): value is AthenaState {
  return typeof value === "string" && (ATHENA_STATES as readonly string[]).includes(value);
}

export interface Size {
  w: number;
  h: number;
}

/** The window rectangle of each state in CSS px at 100%, exactly as ADR 0026's table. */
export const SIZES: Readonly<Record<AthenaState, Size>> = {
  seal: { w: 92, h: 92 },
  tape: { w: 440, h: 92 },
  hear: { w: 440, h: 92 },
  slip: { w: 488, h: 316 },
  welcome: { w: 488, h: 432 },
  ledger: { w: 488, h: 656 },
  tab: { w: 28, h: 96 },
};

/** Transparent margin around the drawing, for her shadow. `tab` has none. */
export const MARGIN = 8;

/** The housing column and the seal square. */
export const HOUSE = 76;

/** Which window edge the seal sits on. `left`: seal top-left at window (8, 8). */
export type Side = "left" | "right";

/** Which vertical edge. `down`: the seal is at the top and the paper runs down. */
export type Valign = "down" | "up";

export interface Orient {
  side: Side;
  valign: Valign;
}

/** Where a drop landed, as Rust decided it. `docked` is the screen edge a `tab` hangs on. */
export interface Snap {
  to: "main.right" | "main.left" | "main.corner" | "screen.left" | "screen.right" | "free";
  docked: "left" | "right" | null;
}

export interface Summon {
  cards: number;
}

export interface Chord {
  kind: "approve" | "decline";
}

// -- commands ----------------------------------------------------------------------------------

/** Ask Rust to resize around the seal. Growth is sent at once, shrinking 380ms later (the page's
 *  timing, not Rust's). Rust answers a changed orientation with `athena:orient`. */
export const athenaSetSize = (name: AthenaState, side: Side, valign: Valign) =>
  call<void>("athena_set_size", { name, side, valign });

/**
 * Show her window. Main imports this: the status pill summons her with it.
 * `focus: false` shows her without taking the keyboard from the app the person is in (ADR 0026,
 * "Hide means put away, not mute"); omitted, Rust's default (focus) applies.
 */
export const athenaShow = (focus?: boolean) =>
  call<void>("athena_show", focus === undefined ? {} : { focus });

/** Bring Main forward: the welcome's "Later" leaves her ledger a way back to it. */
export const athenaOpenMain = () => call<void>("athena_open_main");

/** Put her away. Hide stops drawing, not listening (ADR 0026). */
export const athenaHide = () => call<void>("athena_hide");

/** Always on top, or not. */
export const athenaPin = (on: boolean) => call<void>("athena_pin", { on });

/** What she is doing, for the tray dot, the chords and Main's status pill. */
export const athenaReport = (state: AthenaState, cards: number, line: string) =>
  call<void>("athena_report", { state, cards, line });

// -- events ------------------------------------------------------------------------------------

export const onOrient = (f: (orient: Orient) => void): Promise<UnlistenFn> =>
  on<Orient>("athena:orient", f);

export const onSnap = (f: (snap: Snap) => void): Promise<UnlistenFn> => on<Snap>("athena:snap", f);

export const onSummon = (f: (summon: Summon) => void): Promise<UnlistenFn> =>
  on<Summon>("athena:summon", f);

export const onChord = (f: (chord: Chord) => void): Promise<UnlistenFn> =>
  on<Chord>("athena:chord", f);

/** The summon chord held past 250 ms, and its release (ADR 0027, decision 5). */
export const onPtt = (f: (ptt: PttPayload) => void): Promise<UnlistenFn> => on<PttPayload>(PTT_EVENT, f);

// -- an offered command ------------------------------------------------------------------------

/** Main hands her a command to consider: a playbook's, from the Playbooks module (ADR 0040). */
export const OFFER_EVENT = "athena:offer";

export interface Offer {
  text: string;
  /** When the command is a playbook's, which one: it becomes her active project (ADR 0044). */
  playbook?: { id: string; title: string };
}

/**
 * Put `text` in her composer and bring her up. Nothing is sent: the person reads it in her
 * window and presses send, so the turn starts with their act, not Main's. Without a shell this
 * rejects like every other command (`lib/ipc.ts`).
 */
export async function athenaOffer(text: string, playbook?: Offer["playbook"]): Promise<void> {
  if (!hasShell()) throw new Error("Athena's window is only there in the app.");
  await emitTo("athena", OFFER_EVENT, (playbook ? { text, playbook } : { text }) satisfies Offer);
  await athenaShow();
}

export const onOffer = (f: (offer: Offer) => void): Promise<UnlistenFn> =>
  on<Offer>(OFFER_EVENT, f);

// -- the global push-to-talk ---------------------------------------------------------------------

export interface PttDeps {
  /** `useVoice.available`: is there a voice backend to talk to? */
  available: () => boolean;
  press: () => Promise<void>;
  release: () => void;
  /** Is her window on screen? Asked on every press; the tray may have hidden her silently. */
  visible: () => Promise<boolean>;
  /**
   * A voice turn is starting with her window hidden, or has ended (`false`). While it is on, the
   * page keeps her form where it was: the turn runs on the halo, not in her window.
   */
  ambient: (on: boolean) => void;
  /** No voice backend, production: bring her window up so the person sees why. */
  summon: () => void;
  /** No voice backend, development: the rehearsal (`lib/halo-rehearsal.ts`), or `null`. */
  rehearsal: { down: () => void; up: () => void } | null;
}

/**
 * `athena:ptt` to the voice store's `press`/`release`, the pair ADR 0020 named (ADR 0027, 5–6).
 *
 * With a voice backend the chord never shows her window: a hidden window stays hidden and the
 * turn is the halo's. The release waits for its own press to settle, because `press` awaits the
 * manifest and the socket before it is listening, and a `release` that lands first would leave
 * the microphone open with nothing to close it.
 *
 * With none, a development build rehearses the halo and a production build summons her window —
 * the voice-less fallback, where the slip says why nothing is listening.
 */
export function pttHandler(deps: PttDeps): (ptt: PttPayload) => void {
  let pressing: Promise<void> | null = null;
  let rehearsing = false;
  return ({ down }) => {
    if (down) {
      if (pressing) return;
      if (deps.available()) {
        pressing = (async () => {
          const shown = await deps.visible().catch(() => true);
          deps.ambient(!shown);
          await deps.press();
        })().catch((error: unknown) => console.error(`[athena] push-to-talk: ${String(error)}`));
      } else if (deps.rehearsal) {
        rehearsing = true;
        deps.rehearsal.down();
      } else {
        deps.summon();
      }
      return;
    }
    if (pressing) {
      const settled = pressing;
      pressing = null;
      void settled.then(() => deps.release());
    } else if (rehearsing) {
      rehearsing = false;
      deps.rehearsal?.up();
    }
  };
}

// -- dragging ----------------------------------------------------------------------------------

/** How far the pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD = 4;

/** How long a swallowed click may still arrive. After this the next click is a real one. */
const CLICK_WINDOW_MS = 400;

/** Has a press at `from` travelled far enough to be a drag? Pure, for the test. */
export function dragged(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_THRESHOLD;
}

export interface DragDeps {
  /** The OS drag. Defaults to the window's own `startDragging`. */
  start: () => void | Promise<unknown>;
  doc: Pick<Document, "addEventListener" | "removeEventListener">;
  win: Pick<Window, "setTimeout" | "clearTimeout">;
}

/**
 * Begin a drag gesture from a pointer press on the housing or the seal.
 *
 * The rule is the winner's: nothing happens until the pointer has moved 4px, because a press that
 * never moves is a click on the seal. Once it has, the OS takes the mouse through `startDragging`
 * and the trailing click is swallowed, because a drag region can swallow the click in WebView2
 * and a release over the seal must not also open the ledger. Rust watches `Moved` and decides the
 * snap; the page hears about it as `athena:snap`.
 */
export function beginDrag(
  press: { clientX: number; clientY: number; button: number },
  deps: DragDeps = liveDrag(),
): () => void {
  if (press.button !== 0) return () => {};
  const from = { x: press.clientX, y: press.clientY };
  const { doc, win } = deps;

  const stop = () => {
    doc.removeEventListener("pointermove", move as EventListener);
    doc.removeEventListener("pointerup", stop);
    doc.removeEventListener("pointercancel", stop);
  };
  const move = (e: PointerEvent) => {
    if (!dragged(from, { x: e.clientX, y: e.clientY })) return;
    stop();
    const swallow = (click: Event) => {
      click.stopPropagation();
      click.preventDefault();
      release();
    };
    const timer = win.setTimeout(() => release(), CLICK_WINDOW_MS);
    const release = () => {
      doc.removeEventListener("click", swallow, true);
      win.clearTimeout(timer);
    };
    doc.addEventListener("click", swallow, true);
    void Promise.resolve(deps.start()).catch((error: unknown) => {
      console.error(`[athena] startDragging: ${String(error)}`);
    });
  };
  doc.addEventListener("pointermove", move as EventListener);
  doc.addEventListener("pointerup", stop);
  doc.addEventListener("pointercancel", stop);
  return stop;
}

function liveDrag(): DragDeps {
  return {
    start: () => (hasShell() ? getCurrentWindow().startDragging() : undefined),
    doc: document,
    win: window,
  };
}
