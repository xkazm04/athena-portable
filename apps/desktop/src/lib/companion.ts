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

import { call, hasShell, on } from "@/lib/ipc";
import type { UnlistenFn } from "@tauri-apps/api/event";

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

/** Show her window. Main imports this: the status pill summons her with it. */
export const athenaShow = () => call<void>("athena_show");

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
