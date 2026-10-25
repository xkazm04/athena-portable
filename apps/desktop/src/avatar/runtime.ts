/**
 * The avatar runtime - ADR 0120 ("Athena has a face"); ADR 0089, 0092, 0094 for the loop.
 *
 * The lazy half of `<Avatar>`: `Avatar.tsx` imports this module with `import()`, so nothing of the
 * renderer, the driver or the shaders lands in a window's first paint. It loads the form, makes the
 * WebGL2 renderer, subscribes to the face source and draws.
 *
 * **One loop, and none when nothing moves.** Every avatar in a window draws from the window's one
 * frame clock (`lib/motion.ts`), so two faces are still one `requestAnimationFrame`. A face's
 * subscription ends when its driver has settled at rest and no signal changed, when its canvas is
 * scrolled away or hidden, and under Calm; a signal change, coming back into view or leaving Calm
 * starts it again. The clock itself stops while the document is hidden. Under Calm (`data-motion`
 * says calm, or with no attribute the system asks for reduced motion) the face is one still frame
 * at rest, eyes open, and stays so. A signal never causes a React render: it goes straight to the
 * driver.
 */
import { frames, systemPrefersReduced, type Clock } from "@/lib/motion";

import { createDriver, type Driver, type Pose } from "./driver";
import { createGlowRenderer, type GlowRenderer } from "./glow";
import { loadForm } from "./layers";
import type { FaceAvatarId, FaceSource } from "./types";

/** Whether the face must hold still: the root's `data-motion`, else the OS preference. */
export function calmNow(): boolean {
  if (typeof document === "undefined") return false;
  const mode = document.documentElement.getAttribute("data-motion");
  if (mode) return mode === "calm";
  return systemPrefersReduced();
}

export interface FaceLoop {
  /** A signal changed (or the face appeared): run until settled, or draw the still frame. */
  wake(): void;
  /** Visibility of the canvas (in view and displayed). */
  setVisible(visible: boolean): void;
  /** Calm turned on or off. */
  setCalm(calm: boolean): void;
  /** Whether a frame subscription is live. */
  readonly running: boolean;
  dispose(): void;
}

/**
 * The loop for one face, with its clock and drawing injected so a test can step it frame by frame.
 * `draw` receives the pose; `onState` hears "running" and "still" as the loop starts and stops.
 */
export function createFaceLoop(opts: {
  driver: Driver;
  draw: (pose: Pose) => void;
  clock: Clock;
  calm: boolean;
  onState?: (state: "running" | "still") => void;
}): FaceLoop {
  const { driver, draw, clock } = opts;
  let calm = opts.calm;
  let visible = true;
  let unsubscribe: (() => void) | null = null;
  let disposed = false;

  const state = (s: "running" | "still") => opts.onState?.(s);

  const stop = () => {
    if (unsubscribe) {
      const u = unsubscribe;
      unsubscribe = null;
      u();
    }
    state("still");
  };

  const tick = (_time: number, delta: number): boolean => {
    if (disposed || calm || !visible) {
      unsubscribe = null;
      state("still");
      return false;
    }
    draw(driver.step(delta / 1000));
    if (driver.settled) {
      unsubscribe = null;
      state("still");
      return false;
    }
    return true;
  };

  const wake = () => {
    if (disposed) return;
    if (calm) {
      draw(driver.rest());
      state("still");
      return;
    }
    if (!visible || unsubscribe) return;
    unsubscribe = clock.subscribe(tick);
    state("running");
  };

  return {
    wake,
    setVisible(v) {
      if (v === visible) return;
      visible = v;
      if (v) wake();
      else stop();
    },
    setCalm(c) {
      if (c === calm) return;
      calm = c;
      if (c) stop();
      wake();
    },
    get running() {
      return unsubscribe !== null;
    },
    dispose() {
      disposed = true;
      stop();
    },
  };
}

export interface FaceHandle {
  /** The box changed size, in CSS pixels. */
  resize(size: number): void;
  dispose(): void;
}

let warned = false;
function warnOnce(why: string) {
  if (warned) return;
  warned = true;
  console.warn(`[athena] her face is not drawn here: ${why}. The surface keeps its fallback.`);
}

/** Pixels behind each CSS pixel: the screen's, at most 2, and never past the art's own 1024. */
function backing(size: number): number {
  const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
  return Math.max(1, Math.min(1024, Math.round(size * dpr)));
}

/**
 * Start a face on `canvas`. `root` carries the state for anyone who needs to read it:
 * `data-face` = loading | ready | unavailable, `data-face-loop` = running | still.
 */
export function startFace(opts: {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  avatar: FaceAvatarId;
  source: FaceSource;
  size: number;
  clock?: Clock;
  /** Heard once when the face turns out not to draw here (no WebGL2, the form or its renderer failed). */
  onUnavailable?: () => void;
}): FaceHandle {
  const { root, canvas, avatar, source } = opts;
  let disposed = false;
  let renderer: GlowRenderer | null = null;
  let loop: FaceLoop | null = null;
  const cleanups: (() => void)[] = [];
  root.setAttribute("data-face", "loading");

  const fail = (why: string) => {
    root.setAttribute("data-face", "unavailable");
    canvas.style.visibility = "hidden";
    warnOnce(why);
    opts.onUnavailable?.();
  };

  const size = (s: number) => {
    const px = backing(s);
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }
  };
  size(opts.size);

  if (typeof WebGL2RenderingContext === "undefined") {
    fail("WebGL2 is unavailable");
    return { resize: () => {}, dispose: () => {} };
  }

  const driver = createDriver({ seed: 7 });
  let last: Pose = driver.rest();
  const draw = (pose: Pose) => {
    last = pose;
    renderer?.render(pose);
  };

  loadForm(avatar)
    .then(async (form) => {
      if (disposed) return null;
      try {
        return await createGlowRenderer(canvas, form, () => renderer?.render(last));
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
        return null;
      }
    })
    .then(
    (made) => {
      if (!made) return;
      if (disposed) {
        made.dispose();
        return;
      }
      renderer = made;
      loop = createFaceLoop({
        driver,
        draw,
        clock: opts.clock ?? frames(),
        calm: calmNow(),
        onState: (s) => root.setAttribute("data-face-loop", s),
      });
      const l = loop;

      // the first frame is the rest frame, so nothing pops in half-posed
      draw(driver.rest());
      canvas.style.visibility = "visible";
      root.setAttribute("data-face", "ready");

      cleanups.push(
        source.subscribe((signal) => {
          if (driver.setSignal(signal)) l.wake();
        }),
      );

      if (typeof IntersectionObserver !== "undefined") {
        const io = new IntersectionObserver((entries) => {
          const e = entries[entries.length - 1];
          if (e) l.setVisible(e.isIntersecting);
        });
        io.observe(canvas);
        cleanups.push(() => io.disconnect());
      }

      const recheck = () => l.setCalm(calmNow());
      const mo = new MutationObserver(recheck);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
      cleanups.push(() => mo.disconnect());
      const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
      mq?.addEventListener("change", recheck);
      cleanups.push(() => mq?.removeEventListener("change", recheck));

      l.wake();
    },
    (error: unknown) => {
      if (!disposed) fail(`the ${avatar} form did not load (${error instanceof Error ? error.message : String(error)})`);
    },
  );

  return {
    resize(s) {
      size(s);
      if (renderer) {
        renderer.resize();
        loop?.wake();
      }
    },
    dispose() {
      disposed = true;
      loop?.dispose();
      for (const c of cleanups.splice(0)) c();
      renderer?.dispose();
      renderer = null;
    },
  };
}
