/**
 * The Wavefront field, Wavefront's water — README section 3.1, ADR 0142 (and 0089 for its gate).
 *
 * One canvas under the vignette: a lattice of points, one per accelerator of the cluster, through
 * which her bell's tideline travels as a wave (`wavefront.ts`). The field at rest is drawn once into
 * a buffer of its own; a moving frame copies it and lights only the band each front is crossing.
 *
 * It runs on the window's one shared clock and only while a wave is on the field: three waves as the
 * stage arrives, one per move, one when the pointer comes to the bell or a depth's light, and one per
 * beat while she works, hears, asks or speaks. When the last wave has crossed, the field is drawn at
 * rest and the clock is let go of, so a settled scene asks for no frames. Under Calm it is a standing
 * wave, drawn once.
 */
import { useEffect, useRef } from "react";

import type { Pose } from "@/bell/pose";
import type { Move } from "@/depth/model";
import { frames } from "@/lib/motion";

import { ARRIVAL, BEAT, alive, band, front, lattice, light, rgba, standing, type Field, type Wave } from "./wavefront";

const MAX_DPR = 1.5;
/** The pointer can ring the field at most this often, ms. */
const HOVER_GATE = 900;
/** What the pointer rings: the bell, a depth's light, and her place in the dock. */
const RINGERS = ".surface__bell, .surface__light, .stage__dock-athena";
/** Where a wave leaves from: the bell's dome, else her place in the dock or the brand. */
const SOURCES = [".surface__bell", ".stage__dock-athena", ".stage__brand"];

type Rgba = [number, number, number, number];

const busy = (pose: Pose) => pose !== "resting";

export default function WavefrontField({ pose, move, seq, calm }: { pose: Pose; move: Move; seq: number; calm: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ pose, calm });
  const api = useRef<{ ring: (gain: number, delay?: number) => void; still: () => void; beat: () => void; idle: () => void }>({
    ring: () => {},
    still: () => {},
    beat: () => {},
    idle: () => {},
  });

  // What the running clock reads each frame; kept in step after every render, before the effects below.
  useEffect(() => {
    live.current = { pose, calm };
  }, [pose, calm]);

  useEffect(() => {
    const cv = canvas.current;
    const cx = cv?.getContext("2d");
    if (!cv || !cx) return;

    let size = { w: 0, h: 0, dpr: 1 };
    let field: Field = lattice(0, 0, 0, 0);
    let src = { x: 0, y: 0 };
    let ink: { dot: Rgba; crest: Rgba } = { dot: [168, 224, 58, 0.2], crest: [230, 255, 170, 1] };
    let waves: Wave[] = [];
    /** The field's own clock, ms: advanced only by frames, so a test and a hidden window agree. */
    let now = 0;
    let lastBeat = -Infinity;
    let stop: (() => void) | null = null;
    /** Per-point light for the frame being drawn; only the touched entries are ever non-zero. */
    let lit = new Float32Array(0);

    const rest = document.createElement("canvas");
    const rx = rest.getContext("2d");

    const readInk = () => {
      const style = getComputedStyle(cv);
      ink = {
        dot: rgba(style.getPropertyValue("--wave-dot").trim(), [168, 224, 58, 0.2]),
        crest: rgba(style.getPropertyValue("--wave-crest").trim(), [230, 255, 170, 1]),
      };
    };

    const source = () => {
      const r0 = cv.getBoundingClientRect();
      for (const sel of SOURCES) {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        if (r && r.width > 0) return { x: r.left - r0.left + r.width / 2, y: r.top - r0.top + r.height * (sel === ".surface__bell" ? 0.3 : 0.5) };
      }
      return { x: size.w * 0.2, y: size.h * 0.3 };
    };

    /** The field at rest, drawn once into its buffer. */
    const printRest = () => {
      if (!rx) return;
      const { w, h, dpr } = size;
      rest.width = cv.width;
      rest.height = cv.height;
      rx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rx.clearRect(0, 0, w, h);
      const [r, g, b, a] = ink.dot;
      for (let i = 0; i < field.d.length; i++) {
        rx.fillStyle = `rgba(${r},${g},${b},${a * field.fall[i]!})`;
        rx.fillRect(field.x[i]! - 0.7, field.y[i]! - 0.7, 1.4, 1.4);
      }
    };

    /** Lay the field out again when the stage or the wave's source has moved. */
    const relayout = (force = false) => {
      const s = source();
      if (!force && Math.abs(s.x - src.x) < 4 && Math.abs(s.y - src.y) < 4) return;
      src = s;
      field = lattice(size.w, size.h, src.x, src.y);
      lit = new Float32Array(field.d.length);
      printRest();
    };

    /** One picture of the field with `ws` crossing it at time `t`. */
    const paint = (ws: Wave[], t: number) => {
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.clearRect(0, 0, cv.width, cv.height);
      cx.drawImage(rest, 0, 0);
      if (!ws.length) return;
      cx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      const touched: number[] = [];
      for (const wave of ws) {
        const f = front(wave, t);
        const [from, to] = band(field, f);
        for (let i = from; i < to; i++) {
          const l = light(field.d[i]!, f, wave.gain, field.maxD);
          if (l <= lit[i]!) continue;
          if (lit[i] === 0) touched.push(i);
          lit[i] = l;
        }
      }
      const [r0, g0, b0, a0] = ink.dot;
      const [r1, g1, b1, a1] = ink.crest;
      for (const i of touched) {
        const l = lit[i]!;
        lit[i] = 0;
        if (l <= 0.02) continue;
        const a = Math.min(1, a0 * field.fall[i]! + l * 0.85 * a1);
        cx.fillStyle = `rgba(${(r0 + (r1 - r0) * l) | 0},${(g0 + (g1 - g0) * l) | 0},${(b0 + (b1 - b0) * l) | 0},${a})`;
        const sz = 1.4 + l * 1.8;
        cx.fillRect(field.x[i]! - sz / 2, field.y[i]! - sz / 2, sz, sz);
      }
    };

    const start = () => {
      if (stop || live.current.calm) return;
      stop = frames().subscribe((_t, dt) => {
        now += Math.min(dt, 50);
        if (busy(live.current.pose) && now - lastBeat >= BEAT) {
          lastBeat = now;
          waves.push({ t0: now, gain: 0.8 });
        }
        waves = waves.filter((w) => alive(w, now, field.maxD));
        paint(waves, now);
        if (waves.length || busy(live.current.pose)) return;
        stop = null;
        return false;
      });
    };

    const ring = (gain: number, delay = 0) => {
      if (live.current.calm) return;
      if (!waves.length) relayout();
      waves.push({ t0: now + delay, gain });
      start();
    };
    const still = () => {
      stop?.();
      stop = null;
      waves = [];
      paint(standing(now), now);
    };
    const beat = () => {
      if (live.current.calm) return;
      relayout();
      start();
    };
    const idle = () => {
      if (!stop) paint([], now);
    };
    api.current = { ring, still, beat, idle };

    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      size = { w: cv.clientWidth, h: cv.clientHeight, dpr };
      cv.width = Math.round(size.w * dpr);
      cv.height = Math.round(size.h * dpr);
      readInk();
      relayout(true);
      if (live.current.calm) still();
      else if (!stop) paint([], now);
    };
    fit();
    if (!live.current.calm) for (const [delay, gain] of ARRIVAL) ring(gain, delay);

    const ro = new ResizeObserver(fit);
    ro.observe(cv);
    // The theme can change under the water, and a canvas is not repainted by CSS.
    const mo = new MutationObserver(() => {
      readInk();
      printRest();
      if (live.current.calm) still();
      else if (!stop) paint([], now);
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-skin"] });
    let gate = -Infinity;
    const onOver = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target.closest(RINGERS) : null;
      if (!t || performance.now() < gate) return;
      gate = performance.now() + HOVER_GATE;
      ring(0.7);
    };
    document.addEventListener("pointerover", onOver);
    return () => {
      document.removeEventListener("pointerover", onOver);
      mo.disconnect();
      ro.disconnect();
      stop?.();
      stop = null;
    };
  }, []);

  // A move brings a new scene: one wave greets it.
  useEffect(() => {
    if (seq === 0 || calm || move === "none") return;
    api.current.ring(1);
  }, [seq, move, calm]);

  // A busy pose rings a wave per beat; Calm stills the field at once, as a standing wave.
  useEffect(() => {
    if (calm) api.current.still();
    else if (busy(pose)) api.current.beat();
    else api.current.idle();
  }, [pose, calm]);

  return <canvas ref={canvas} className="backdrop__wavefront" aria-hidden="true" />;
}
