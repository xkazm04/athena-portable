/**
 * ADR 0028 (Athena's voice is set up in a studio), README section 3.1 — the three live meters.
 *
 * Her waveform, her orb's glow and the microphone's level all move at the audio's rate, and none of
 * them is React state: each reads a meter function from the view-model on its own animation frame
 * and writes a style property through a ref. A fixture's meters return silence, and
 * `renderToStaticMarkup` never runs an effect, so the preview harness and the registry test see
 * the resting shape and nothing else.
 *
 * The waveform is Personas' AthenaWaveform, re-derived: 28 bars mirrored round the centre so the
 * loudest (lowest) bins sit mid-row, the lowest 48 frequency bins only (speech lives there; the
 * top of the FFT is noise), `v^0.8` so a quiet voice still moves, and one 80 ms height transition
 * in CSS so a reduced-motion setting never has to snap anything.
 */
import { useEffect, useRef } from "react";

const MIN_PX = 3;
const USEFUL_BINS = 48;

/** The bin a bar reads: mirrored, so bar 0 and bar n-1 both read the highest useful bin. */
export function binFor(bar: number, bars: number, usable: number): number {
  const half = (bars - 1) / 2 || 1;
  const dist = Math.abs(bar - (bars - 1) / 2) / half;
  return Math.min(usable - 1, Math.floor(dist * usable));
}

/** A bar's height for a 0..255 bin value inside a row `max` pixels tall. */
export function barHeight(value: number, max: number): number {
  const v = Math.max(0, Math.min(255, value)) / 255;
  return Math.round(MIN_PX + Math.pow(v, 0.8) * (Math.max(max, MIN_PX) - MIN_PX));
}

/** Run `tick` every animation frame while `active`; `rest` once when it stops. */
function useFrame(active: boolean, tick: () => void, rest: () => void): void {
  const tickRef = useRef(tick);
  const restRef = useRef(rest);
  useEffect(() => {
    tickRef.current = tick;
    restRef.current = rest;
  });
  useEffect(() => {
    if (!active || typeof requestAnimationFrame === "undefined") {
      restRef.current();
      return;
    }
    let frame = 0;
    const loop = () => {
      tickRef.current();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      restRef.current();
    };
  }, [active]);
}

export function Waveform({
  active,
  read,
  bars = 28,
}: {
  active: boolean;
  /** Byte frequency bins of her playback, or `null` when nothing plays. */
  read: () => Uint8Array | null;
  bars?: number;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const flatten = () => {
    for (const bar of root.current?.querySelectorAll<HTMLSpanElement>("[data-bar]") ?? []) {
      bar.style.height = `${MIN_PX}px`;
    }
  };
  useFrame(
    active,
    () => {
      const el = root.current;
      const bins = read();
      if (!el || !bins || bins.length === 0) return flatten();
      const spans = el.querySelectorAll<HTMLSpanElement>("[data-bar]");
      const usable = Math.min(bins.length, USEFUL_BINS);
      const max = el.clientHeight || MIN_PX;
      spans.forEach((span, i) => {
        span.style.height = `${barHeight(bins[binFor(i, spans.length, usable)] ?? 0, max)}px`;
      });
    },
    flatten,
  );
  return (
    <div ref={root} className="vs-wave" data-active={active ? "true" : "false"} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} data-bar="" style={{ height: MIN_PX }} />
      ))}
    </div>
  );
}

/**
 * Her orb: a conic ring that is real install progress (`ring`, 0..1, a prop because it moves at
 * the poll's 250 ms, not the audio's rate) and a glow that breathes with her playback level,
 * written to `--lvl` per frame while she speaks.
 */
export function Orb({ ring, speaking, level }: { ring: number; speaking: boolean; level: () => number }) {
  const root = useRef<HTMLDivElement | null>(null);
  useFrame(
    speaking,
    () => root.current?.style.setProperty("--lvl", level().toFixed(3)),
    () => root.current?.style.setProperty("--lvl", "0"),
  );
  return (
    <div
      ref={root}
      className="vs-orb"
      data-speaking={speaking ? "true" : "false"}
      style={{ ["--progress" as string]: Math.max(0, Math.min(1, ring)) }}
      aria-hidden="true"
    >
      <span className="vs-orb__ring" />
      <span className="vs-orb__glow" />
      <span className="vs-orb__face" />
    </div>
  );
}

/** The microphone's level while a take records: the one debugging tool a silent mic leaves you. */
export function MicMeter({ active, read }: { active: boolean; read: () => number }) {
  const fill = useRef<HTMLSpanElement | null>(null);
  useFrame(
    active,
    () => {
      if (fill.current) fill.current.style.transform = `scaleX(${Math.max(0, Math.min(1, read())).toFixed(3)})`;
    },
    () => {
      if (fill.current) fill.current.style.transform = "scaleX(0)";
    },
  );
  return (
    <span className="vs-meter" aria-hidden="true">
      <span ref={fill} className="vs-meter__fill" />
    </span>
  );
}
