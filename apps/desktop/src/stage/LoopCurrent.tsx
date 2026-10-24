/**
 * The loop current, Loop Tide's water — README section 3.1, ADR 0142 (and 0089 for its gate).
 *
 * One canvas under the vignette whose motes circulate on the three loops of `loop-current.ts`. It
 * runs on the window's one shared clock, and only while there is a reason to: while she works,
 * hears or asks (at the bell's pace for that pose), and for a moment after the water is pushed by a
 * move. Then the current slows, settles into its long exposure (a photograph of the current, drawn
 * once into a buffer) and the clock is let go of, so a settled scene asks for no frames and always
 * looks the same. Under Calm the exposure is all there is.
 */
import { useEffect, useRef } from "react";

import type { Pose } from "@/bell/pose";
import type { Move } from "@/depth/model";
import { frames } from "@/lib/motion";

import { POSE_SPEED, ease, flowsAtRest, moteCount, place, seedMotes, type Mote } from "./loop-current";

const MAX_DPR = 1.5;
/** Seconds the current keeps flowing after a move pushes the water. */
const COAST = 1.6;
/** Below this speed a stopping current is still and settles into its exposure. */
const STILL = 0.02;
/** Seconds the moving motes take to cross-fade into the exposure. */
const SETTLE = 0.5;

export default function LoopCurrent({ pose, move, seq, calm }: { pose: Pose; move: Move; seq: number; calm: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const motes = useRef<Mote[]>([]);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const ink = useRef({ colour: "", light: false });
  /** `settle` is -1 while flowing, then 0..1 across the cross-fade into the exposure. */
  const run = useRef({ speed: 0, coast: 0, settle: -1 });
  const stop = useRef<(() => void) | null>(null);
  const live = useRef({ pose, calm });
  const draw = useRef({ still: () => {}, start: () => {} });

  // What the running clock reads each frame; kept in step after every render, before the effects below.
  useEffect(() => {
    live.current = { pose, calm };
  }, [pose, calm]);

  useEffect(() => {
    const cv = canvas.current;
    const cx = cv?.getContext("2d");
    if (!cv || !cx) return;

    const readInk = () => {
      ink.current = {
        colour: getComputedStyle(cv).getPropertyValue("--lt-current").trim() || "#4aa3ff",
        light: document.documentElement.getAttribute("data-theme") === "light",
      };
    };
    const dot = (x: number, y: number, r: number, a: number) => {
      cx.globalAlpha = a;
      cx.beginPath();
      cx.arc(x, y, r, 0, Math.PI * 2);
      cx.fill();
    };

    // The exposure: every mote's path for a long moment, a photograph of the current, drawn once
    // into a buffer of its own so the still and the cross-fade into it cost one copy a frame.
    const print = document.createElement("canvas");
    const px = print.getContext("2d");
    const expose = () => {
      if (!px) return;
      const { w, h, dpr } = size.current;
      const { colour, light } = ink.current;
      print.width = cv.width;
      print.height = cv.height;
      px.setTransform(dpr, 0, 0, dpr, 0, 0);
      px.clearRect(0, 0, w, h);
      px.fillStyle = colour;
      px.globalCompositeOperation = light ? "source-over" : "lighter";
      const k = light ? 0.5 : 1;
      const spot = (x: number, y: number, r: number, a: number) => {
        px.globalAlpha = a;
        px.beginPath();
        px.arc(x, y, r, 0, Math.PI * 2);
        px.fill();
      };
      // Each mote's path for a long moment as faint dots fading behind it: a field of particles,
      // never a drawn line, so the loop shows only as the way the water moves.
      for (const m of motes.current) {
        const span = 0.9 + m.w * 6;
        for (let i = 0; i < 40; i++) {
          const [x, y] = place(m, m.th - (span * i) / 40, w, h);
          spot(x, y, m.r * 0.7, m.a * 0.05 * k * (1 - i / 40));
        }
        const [x, y] = place(m, m.th, w, h);
        spot(x, y, m.r, m.a * 0.7 * k);
      }
      px.globalAlpha = 1;
      px.globalCompositeOperation = "source-over";
    };
    // The last moving frame, kept while it cross-fades into the exposure.
    const held = document.createElement("canvas");
    const hx = held.getContext("2d");
    const hold = () => {
      held.width = cv.width;
      held.height = cv.height;
      hx?.drawImage(cv, 0, 0);
    };
    /** The exposure on screen at `alpha`, over what was held at `1 - alpha`. */
    const showPrint = (alpha: number) => {
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.clearRect(0, 0, cv.width, cv.height);
      if (alpha < 1) {
        cx.globalAlpha = 1 - alpha;
        cx.drawImage(held, 0, 0);
      }
      cx.globalAlpha = alpha;
      cx.drawImage(print, 0, 0);
      cx.globalAlpha = 1;
    };
    const still = () => {
      expose();
      showPrint(1);
    };

    // One step of the flowing current: the old frame fades, each mote moves on its loop.
    const frame = (dt: number) => {
      const { w, h, dpr } = size.current;
      const { colour, light } = ink.current;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.globalCompositeOperation = "destination-out";
      cx.globalAlpha = 1;
      cx.fillStyle = "rgba(0,0,0,0.12)";
      cx.fillRect(0, 0, w, h);
      cx.globalCompositeOperation = light ? "source-over" : "lighter";
      cx.fillStyle = colour;
      const k = light ? 0.85 : 1;
      const speed = run.current.speed;
      for (const m of motes.current) {
        m.th += m.w * speed * dt;
        const [x, y] = place(m, m.th, w, h);
        dot(x, y, m.r, m.a * k);
      }
      cx.globalAlpha = 1;
      cx.globalCompositeOperation = "source-over";
    };

    // Ask the clock for frames until the current has a reason to stop and has slowed to a stop.
    const start = () => {
      if (stop.current || live.current.calm) return;
      stop.current = frames().subscribe((_t, delta) => {
        const dt = Math.min(delta, 50) / 1000;
        const r = run.current;
        r.coast = Math.max(0, r.coast - dt);
        const { pose: p, calm: c } = live.current;
        const flowing = !c && (flowsAtRest(p) || r.coast > 0);
        if (flowing) r.settle = -1;
        r.speed = ease(r.speed, flowing ? POSE_SPEED[p] : 0, dt);
        if (flowing || r.speed >= STILL) {
          frame(dt);
          return;
        }
        // Slowed to a stop: cross-fade the motes into the exposure, then let the clock go.
        if (r.settle < 0) {
          r.speed = 0;
          r.settle = 0;
          hold();
          expose();
        }
        r.settle = Math.min(1, r.settle + dt / SETTLE);
        showPrint(r.settle);
        if (r.settle >= 1) {
          r.settle = -1;
          stop.current = null;
          return false;
        }
      });
    };
    draw.current = { still, start };

    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      size.current = { w, h, dpr };
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      if (motes.current.length !== moteCount(w, h)) motes.current = seedMotes(moteCount(w, h));
      readInk();
      still();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);
    // The theme can change under the water, and a canvas is not repainted by CSS.
    const mo = new MutationObserver(() => {
      readInk();
      if (!stop.current) still();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-skin"] });
    return () => {
      mo.disconnect();
      ro.disconnect();
      stop.current?.();
      stop.current = null;
    };
  }, []);

  // A move pushes the water: the current coasts on it.
  useEffect(() => {
    if (seq === 0 || calm || move === "none") return;
    run.current.coast = COAST;
    draw.current.start();
  }, [seq, move, calm]);

  // A busy pose keeps the current flowing; Calm stills it at once, as a long exposure.
  useEffect(() => {
    if (calm) {
      stop.current?.();
      stop.current = null;
      run.current.speed = 0;
      draw.current.still();
      return;
    }
    if (flowsAtRest(pose)) draw.current.start();
  }, [pose, calm]);

  return <canvas ref={canvas} className="backdrop__current" aria-hidden="true" />;
}
