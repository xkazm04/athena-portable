/**
 * One drawing per chore — README section 3.1, ADR 0040 and 0087.
 *
 * Stylised art drawn from the chore's own facts, so two chores never wear the same picture: its
 * portals are the windows (how many, in what order), Athena's route runs through them to the seal
 * where she stops for a signature (one notch per gate), the diamonds beside the route are the
 * traps the world held, the coins stack with the chore's value and a home chore is under a roof
 * where a business's is among ledgers. The picture is seeded by the chore's id and nothing else,
 * so it is the same on every render and every machine. Tokens only, no literal colour; the seal's
 * ring says the bench's verdict in line style as well as hue (solid, dotted, dashed), so colour is
 * never the only carrier.
 *
 * It is a drawing, not a screenshot of any portal, and every place that shows one says so. It is
 * decorative (`aria-hidden`); the chore's name beside it is the accessible name. Static: the only
 * motion is the hero's optional float, CSS on `transform`, off under Calm.
 */
import type { ReactElement } from "react";

import "./chore.css";

export type ChoreVerdict = "exceeds" | "meets" | "short" | "unbenched";

export interface ChoreArtFacts {
  id: string;
  /** How many portals it spans. */
  portals: number;
  gates: number;
  traps: number;
  audience: "home" | "work";
  /** 0 to 1: the chore's value against the largest in the set. */
  weight: number;
  verdict: ChoreVerdict;
}

/** FNV-1a: a small, stable hash of the id. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: the same sequence for the same seed, everywhere. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TINTS = ["--role-external", "--role-agent", "--role-highlight", "--accent"] as const;

const RING: Record<ChoreVerdict, { color: string; dash: string; width: number }> = {
  exceeds: { color: "var(--status-success)", dash: "none", width: 2.6 },
  meets: { color: "var(--status-info)", dash: "1 3.4", width: 2.6 },
  short: { color: "var(--status-warning)", dash: "7 3.5", width: 2.6 },
  unbenched: { color: "var(--status-neutral)", dash: "2 4", width: 1.6 },
};

/** The windows shown: a chore with more portals than this ends in a count, not a crowd. */
export const MAX_WINDOWS = 6;

interface Win {
  x: number;
  y: number;
  w: number;
  h: number;
  tint: string;
  lines: number[];
}

export function windowsFor(facts: ChoreArtFacts): Win[] {
  const r = rng(seedOf(facts.id));
  const n = Math.max(1, Math.min(MAX_WINDOWS, facts.portals));
  const out: Win[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const w = 38 + r() * 14;
    const h = 27 + r() * 9;
    out.push({
      x: 14 + t * (132 - (w - 38)) + (r() - 0.5) * 6,
      y: 96 - t * 46 + (r() - 0.5) * 20,
      w,
      h,
      tint: TINTS[Math.floor(r() * TINTS.length)]!,
      lines: [0.55 + r() * 0.4, 0.3 + r() * 0.5, 0.2 + r() * 0.4],
    });
  }
  return out;
}

export function ChoreArtBody({ facts }: { facts: ChoreArtFacts }): ReactElement {
  const r = rng(seedOf(facts.id) ^ 0x9e3779b9);
  const wins = windowsFor(facts);
  const ring = RING[facts.verdict];
  const sealX = 205;
  const sealY = 52;
  const centres = wins.map((w) => [w.x + w.w / 2, w.y + w.h / 2] as const);
  const route =
    centres.map(([x, y], i) => (i === 0 ? `M${x} ${y}` : `L${x} ${y}`)).join(" ") +
    ` Q${(centres[centres.length - 1]![0] + sealX) / 2} ${sealY + 30} ${sealX - 16} ${sealY + 4}`;
  const gates = Math.min(4, Math.max(0, facts.gates));
  const traps = Math.min(5, Math.max(0, facts.traps));
  const coins = 1 + Math.round(facts.weight * 3);
  const more = facts.portals - MAX_WINDOWS;

  return (
    <>
      {/* the setting: a roof for a household's chore, ledgers for a business's */}
      {facts.audience === "home" ? (
        <path
          d="M20 78 L88 26 L156 78 M36 70 V122 H140 V70"
          fill="color-mix(in srgb, var(--accent) 5%, transparent)"
          stroke="color-mix(in srgb, var(--muted) 45%, transparent)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      ) : (
        <g fill="color-mix(in srgb, var(--accent) 5%, transparent)" stroke="color-mix(in srgb, var(--muted) 45%, transparent)" strokeWidth="1.5">
          <rect x="22" y="58" width="30" height="64" rx="3" />
          <rect x="56" y="34" width="38" height="88" rx="3" />
          <rect x="98" y="66" width="34" height="56" rx="3" />
        </g>
      )}
      <path d="M12 134 H228" stroke="color-mix(in srgb, var(--muted) 40%, transparent)" strokeWidth="1.5" strokeLinecap="round" />

      {/* Athena's route through the portals to the seal */}
      <path d={route} fill="none" stroke="var(--accent)" strokeOpacity=".7" strokeWidth="1.8" strokeDasharray="3 4" strokeLinecap="round" />

      {wins.map((w, i) => (
        <g key={i}>
          <rect x={w.x} y={w.y} width={w.w} height={w.h} rx="4" fill="var(--card-bg)" stroke={`var(${w.tint})`} strokeWidth="1.6" />
          <path d={`M${w.x} ${w.y + 7}H${w.x + w.w}`} stroke={`var(${w.tint})`} strokeOpacity=".55" />
          <circle cx={w.x + 5} cy={w.y + 3.6} r="1.3" fill={`var(${w.tint})`} />
          <circle cx={w.x + 10} cy={w.y + 3.6} r="1.3" fill={`var(${w.tint})`} fillOpacity=".55" />
          {w.lines.map((len, k) => (
            <path
              key={k}
              d={`M${w.x + 5} ${w.y + 13 + k * 5.2}h${(w.w - 10) * len}`}
              stroke="var(--foreground)"
              strokeOpacity=".5"
              strokeWidth="2"
              strokeLinecap="round"
            />
          ))}
        </g>
      ))}
      {more > 0 ? (
        <g>
          <circle cx={wins[wins.length - 1]!.x + wins[wins.length - 1]!.w} cy={wins[wins.length - 1]!.y} r="7" fill="var(--card-raised)" stroke="var(--accent)" />
          <path d="M-3 0h6M0 -3v6" transform={`translate(${wins[wins.length - 1]!.x + wins[wins.length - 1]!.w} ${wins[wins.length - 1]!.y})`} stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      ) : null}

      {/* the traps the world held, beside the route and not on it */}
      {Array.from({ length: traps }, (_, i) => {
        const w = wins[i % wins.length]!;
        const x = w.x + w.w * (0.25 + 0.5 * r());
        const y = Math.min(128, w.y + w.h + 10 + 4 * r());
        return <rect key={i} x={x - 3.4} y={y - 3.4} width="6.8" height="6.8" transform={`rotate(45 ${x} ${y})`} fill="none" stroke="var(--status-warning)" strokeWidth="1.5" />;
      })}

      {/* the seal: where she stops for the person's signature */}
      <g>
        <circle cx={sealX} cy={sealY} r="19" fill="color-mix(in srgb, var(--card-raised) 80%, transparent)" />
        <circle cx={sealX} cy={sealY} r="15.5" fill="none" stroke={ring.color} strokeWidth={ring.width} strokeDasharray={ring.dash === "none" ? undefined : ring.dash} strokeLinecap="round" />
        <path d={`M${sealX - 6} ${sealY + 0.5} l4.2 4.4 l8 -9`} fill="none" stroke="var(--foreground)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {Array.from({ length: gates }, (_, i) => (
          <path key={i} d={`M${sealX} ${sealY - 19.5} v4.5`} transform={`rotate(${(i - (gates - 1) / 2) * 24} ${sealX} ${sealY})`} stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" />
        ))}
      </g>

      {/* the value: a stack of coins, taller for a chore worth more */}
      {Array.from({ length: coins }, (_, i) => (
        <ellipse key={i} cx={200} cy={126 - i * 6} rx="15" ry="5.2" fill="color-mix(in srgb, var(--status-success) 22%, var(--card-bg))" stroke="var(--status-success)" strokeWidth="1.4" />
      ))}
    </>
  );
}

/** A chore's drawing. `float` is the hero's slow drift; the cards hold still. */
export default function ChoreArt({
  facts,
  size = 240,
  float = false,
}: {
  facts: ChoreArtFacts;
  size?: number;
  float?: boolean;
}) {
  return (
    <svg
      className="chore-art"
      viewBox="0 0 240 160"
      width={size}
      height={(size * 160) / 240}
      aria-hidden="true"
      focusable="false"
      data-chore-art={facts.id}
    >
      <g className={float ? "chore-art__float" : undefined}>
        <ChoreArtBody facts={facts} />
      </g>
    </svg>
  );
}
