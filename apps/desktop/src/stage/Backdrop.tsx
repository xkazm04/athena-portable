/**
 * The water behind every depth — README section 3.1, ADR 0087 and 0089.
 *
 * Four things, none of them a per-frame cost at rest. The colour of each depth is a stack of four
 * flat layers cross-faded by opacity (never an animated gradient). The light shafts are CSS
 * animations on `transform`, which the compositor runs without the main thread. The vignette is
 * static. The marine snow is the only thing drawn by script: one small canvas that drifts while a
 * move is playing and for a moment after, then **stops asking for frames**, so a settled scene
 * costs nothing. It runs on the window's one shared clock (`lib/motion.ts`), and under Calm it is
 * drawn once and never moves.
 */
import { useEffect, useRef } from "react";

import type { Move } from "@/depth/model";
import { frames } from "@/lib/motion";

const FLAKES = 70;
const MAX_DPR = 1.5;
/** Seconds the water drifts after a push, about a move long, then the canvas goes still. */
const COAST = 0.5;

interface Flake {
  x: number;
  y: number;
  r: number;
  v: number;
  a: number;
}

function seed(): Flake[] {
  // A fixed pattern, not Math.random: the same water every launch, and a test that can know it.
  return Array.from({ length: FLAKES }, (_, i) => ({
    x: (i * 0.6180339887) % 1,
    y: (i * 0.7548776662) % 1,
    r: 0.6 + ((i * 37) % 10) / 8,
    v: 0.4 + ((i * 53) % 10) / 14,
    a: 0.12 + ((i * 29) % 10) / 40,
  }));
}

export default function Backdrop({
  depth,
  move,
  seq,
  calm,
}: {
  depth: 0 | 1 | 2 | 3;
  move: Move;
  seq: number;
  calm: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const flakes = useRef<Flake[]>(seed());
  const drift = useRef({ dir: 0, left: 0 });
  const stop = useRef<(() => void) | null>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });

  // Paint the field once, at the current size. Also the whole of the Calm rendition.
  const paint = useRef(() => {});
  useEffect(() => {
    const cv = canvas.current;
    const cx = cv?.getContext("2d");
    if (!cv || !cx) return;
    // The snow is the accent token's colour: a canvas cannot read a variable, so it is asked once
    // per theme.
    let ink = "";
    paint.current = () => {
      const { w, h, dpr } = size.current;
      ink ||= getComputedStyle(cv).getPropertyValue("--accent").trim() || "#22d3ee";
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.clearRect(0, 0, w, h);
      for (const f of flakes.current) {
        cx.globalAlpha = f.a;
        cx.fillStyle = ink;
        cx.beginPath();
        cx.arc(f.x * w, f.y * h, f.r, 0, Math.PI * 2);
        cx.fill();
      }
      cx.globalAlpha = 1;
    };
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      size.current = { w, h, dpr };
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      paint.current();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);
    // The theme can change under the water (the settings resolve after the first paint, the bar
    // has a theme button), and a canvas is not repainted by CSS: ask for the accent again.
    const mo = new MutationObserver(() => {
      ink = "";
      paint.current();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mo.disconnect();
      ro.disconnect();
      stop.current?.();
      stop.current = null;
    };
  }, []);

  // A move gives the water a push; it coasts to a stop and the clock is let go of.
  useEffect(() => {
    if (seq === 0 || calm || move === "none") return;
    drift.current = { dir: move === "down" ? -1 : move === "up" ? 1 : 0.4, left: COAST };
    if (stop.current) return; // already running; the new push is picked up next frame
    stop.current = frames().subscribe((_t, dt) => {
      const d = drift.current;
      const s = Math.min(dt, 64) / 1000;
      d.left -= s;
      const k = Math.max(d.left, 0) / COAST; // 1 at the push, 0 at rest
      const { h } = size.current;
      for (const f of flakes.current) {
        f.y += (d.dir * k * f.v * 340 * s) / (h || 1);
        f.x += (Math.sin(f.y * 9 + f.r) * 0.01 * k * s) / 0.016;
        if (f.y < -0.02) f.y += 1.04;
        if (f.y > 1.02) f.y -= 1.04;
        if (f.x < 0) f.x += 1;
        if (f.x > 1) f.x -= 1;
      }
      paint.current();
      if (d.left <= 0) {
        stop.current = null;
        return false;
      }
    });
  }, [seq, move, calm]);

  return (
    <div className="backdrop" data-depth={depth} aria-hidden="true">
      <i className="backdrop__tone backdrop__tone--0" />
      <i className="backdrop__tone backdrop__tone--1" />
      <i className="backdrop__tone backdrop__tone--2" />
      <i className="backdrop__tone backdrop__tone--3" />
      <div className="backdrop__shafts">
        <i />
        <i />
        <i />
        <i />
      </div>
      <canvas ref={canvas} className="backdrop__snow" />
      <i className="backdrop__vignette" />
    </div>
  );
}
