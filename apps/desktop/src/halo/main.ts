/**
 * The halo page — ADR 0027 (Athena is ambient), README section 3.1.
 *
 * One copy runs per monitor, in a click-through overlay, so it is plain TypeScript with no React
 * and no store: it listens for `halo:signal`, keeps the latest frame, and writes three things to
 * the DOM — `data-phase` on the root, a smoothed `--level`, and the caption when it changes. The
 * look is `halo.css`; every rule about timing is `model.ts`.
 *
 * Rest costs nothing (ADR 0027, decision 7): the animation frame loop runs only while the drawn
 * level is still chasing the signalled one, and `frame` stops it the moment they agree. Thinking
 * and the gate are CSS animations, which need no frames from here.
 */
import { HALO_EVENT, IDLE_SIGNAL, type HaloPhase, type HaloSignal } from "@/lib/halo-signal";
import { hasShell, on } from "@/lib/ipc";

import {
  CAPTION_START,
  captionHideAt,
  captionView,
  parseSignal,
  settled,
  smooth,
  stepCaption,
  type CaptionState,
} from "./model";

import "./halo.css";

const root = document.getElementById("halo")!;
const captionEl = document.getElementById("halo-caption")!;
const whoEl = document.getElementById("halo-who")!;
const textEl = document.getElementById("halo-text")!;

const still = window.matchMedia("(prefers-reduced-motion: reduce)");

let signal: HaloSignal = IDLE_SIGNAL;
let drawn = 0;
let lastFrame: number | null = null;
let raf: number | null = null;
let caption: CaptionState = CAPTION_START;
let hideTimer: number | null = null;
let shown = { who: null as string | null, text: "", visible: false };

// -- the level ---------------------------------------------------------------------------------

function writeLevel(level: number) {
  root.style.setProperty("--level", level.toFixed(3));
}

function frame(now: number) {
  const dt = lastFrame === null ? 16 : Math.min(100, now - lastFrame);
  lastFrame = now;
  drawn = smooth(drawn, signal.level, dt);
  writeLevel(drawn);
  if (settled(drawn, signal.level)) {
    // At rest: no frame is requested, so an idle overlay costs nothing until the next signal.
    raf = null;
    lastFrame = null;
    return;
  }
  raf = requestAnimationFrame(frame);
}

function chase() {
  if (still.matches) {
    // Reduced motion draws a fixed depth (halo.css); the level is written once, unsmoothed.
    drawn = signal.level;
    writeLevel(drawn);
    return;
  }
  if (raf === null && !settled(drawn, signal.level)) raf = requestAnimationFrame(frame);
}

// -- the caption -------------------------------------------------------------------------------

function paintCaption(now: number) {
  const view = captionView(caption, now);
  if (view.text !== shown.text || view.who !== shown.who) {
    whoEl.textContent = view.who === "you" ? "You" : view.who === "athena" ? "Athena" : "";
    textEl.textContent = view.text;
  }
  if (view.visible !== shown.visible) captionEl.dataset.visible = view.visible ? "1" : "0";
  shown = view;

  if (hideTimer !== null) clearTimeout(hideTimer);
  hideTimer = null;
  const hideAt = captionHideAt(caption);
  if (view.visible && hideAt !== null) {
    hideTimer = window.setTimeout(() => paintCaption(Date.now()), Math.max(0, hideAt - now));
  }
}

// -- the signal --------------------------------------------------------------------------------

function receive(raw: unknown) {
  const next = parseSignal(raw);
  if (!next) return;
  const now = Date.now();
  if (next.phase !== signal.phase) root.dataset.phase = next.phase;
  signal = next;
  caption = stepCaption(caption, next, now);
  paintCaption(now);
  chase();
}

root.dataset.phase = "idle";
writeLevel(0);

if (hasShell()) {
  void on<unknown>(HALO_EVENT, receive);
} else if (new URLSearchParams(window.location.search).has("demo")) {
  demo();
}

/**
 * `halo.html?demo` in a plain browser (`pnpm dev`): the phases in turn with a fake level and a
 * line of caption each, so the look can be tuned without a shell. Never runs inside Tauri.
 */
function demo() {
  document.documentElement.classList.add("halo-demo");
  const script: [HaloPhase, HaloSignal["caption"]][] = [
    ["listening", { who: "you", text: "Which invoices are overdue, and who do I chase first?" }],
    ["thinking", null],
    ["speaking", { who: "athena", text: "Two are overdue. Acme's is 40 days late, so start there." }],
    ["idle", null],
    ["gate", null],
    ["idle", null],
  ];
  let step = 0;
  let phase: HaloPhase = "idle";
  let words: HaloSignal["caption"] = null;
  const advance = () => {
    [phase, words] = script[step % script.length];
    step += 1;
  };
  advance();
  window.setInterval(advance, 3500);
  window.setInterval(() => {
    const t = Date.now() / 1000;
    const voiced = phase === "listening" || phase === "speaking";
    const level = voiced ? Math.max(0, 0.45 + 0.4 * Math.sin(t * 7) * Math.sin(t * 2.3)) : 0;
    receive({ phase, level, cards: phase === "gate" ? 1 : 0, caption: words });
  }, 50);
}
