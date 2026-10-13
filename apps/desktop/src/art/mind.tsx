/**
 * One drawing per instrument of the Mind depth — README section 3.1, ADR 0087.
 *
 * Stylised key art in the family of `glyphs.tsx`: strokes in the app's tokens, a slow float that is
 * CSS and stops under Calm. Decorative; the name beside each is its accessible name. A drawing, not a
 * screenshot of anything.
 */
import type { ReactElement } from "react";

import "./glyphs.css";

export type Instrument = "engine" | "brain" | "look" | "data" | "mic";

const ART: Record<Instrument, ReactElement> = {
  engine: (
    <g className="glyph__float">
      <path d="M60 8 L86 26 L80 62 L60 78 L40 62 L34 26 Z" fill="color-mix(in srgb, var(--accent) 10%, transparent)" stroke="var(--focus)" strokeWidth="2" />
      <path d="M60 8 L60 78 M34 26 L86 26 M40 62 L80 62 M34 26 L60 46 L86 26 M40 62 L60 46 L80 62" stroke="var(--accent)" strokeOpacity=".45" fill="none" />
      <circle cx="60" cy="46" r="6" fill="var(--foreground)" />
    </g>
  ),
  brain: (
    <g className="glyph__float" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="22" y="20" width="62" height="48" rx="6" fill="color-mix(in srgb, var(--accent) 6%, transparent)" stroke="var(--muted)" strokeWidth="1.5" />
      <rect x="32" y="12" width="62" height="48" rx="6" fill="color-mix(in srgb, var(--accent) 9%, transparent)" stroke="var(--muted-foreground)" strokeWidth="1.5" />
      <rect x="42" y="4" width="62" height="48" rx="6" fill="var(--card-bg)" stroke="var(--accent)" strokeWidth="2" />
      <path d="M52 18h38M52 26h30M52 34h34M52 42h20" stroke="var(--foreground)" strokeWidth="2" strokeOpacity=".7" />
      <circle cx="96" cy="64" r="7" fill="color-mix(in srgb, var(--status-success) 28%, transparent)" stroke="var(--status-success)" strokeWidth="1.8" />
    </g>
  ),
  look: (
    <g className="glyph__float" fill="none" strokeLinecap="round">
      <circle cx="60" cy="42" r="28" fill="color-mix(in srgb, var(--accent) 10%, transparent)" stroke="var(--focus)" strokeWidth="2" />
      <path d="M60 14 A28 28 0 0 1 60 70 Z" fill="var(--card-bg)" stroke="var(--accent)" strokeWidth="2" />
      <path d="M60 4v6M60 74v6M18 42h6M96 42h6M30 12l4 4M86 68l4 4M90 12l-4 4M34 68l-4 4" stroke="var(--accent)" strokeOpacity=".6" strokeWidth="2" />
    </g>
  ),
  data: (
    <g className="glyph__float" fill="none">
      <ellipse cx="60" cy="20" rx="34" ry="10" fill="color-mix(in srgb, var(--accent) 14%, transparent)" stroke="var(--focus)" strokeWidth="2" />
      <path d="M26 20v42c0 6 15 11 34 11s34-5 34-11V20" stroke="var(--accent)" strokeWidth="2" />
      <path d="M26 41c0 6 15 11 34 11s34-5 34-11M26 62c0 6 15 11 34 11" stroke="var(--accent)" strokeOpacity=".5" strokeWidth="1.6" />
      <circle cx="88" cy="58" r="3" fill="var(--status-success)" />
    </g>
  ),
  mic: (
    <g className="glyph__float" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="48" y="8" width="24" height="42" rx="12" fill="color-mix(in srgb, var(--accent) 16%, transparent)" stroke="var(--focus)" strokeWidth="2" />
      <path d="M36 38c0 14 10 22 24 22s24-8 24-22M60 60v14M46 76h28" stroke="var(--accent)" strokeWidth="2.4" />
      <path d="M94 28c4 4 4 12 0 16M100 22c8 8 8 22 0 30" stroke="var(--accent)" strokeOpacity=".5" strokeWidth="2" />
    </g>
  ),
};

export default function InstrumentArt({ item, size = 120 }: { item: Instrument; size?: number }) {
  return (
    <svg className="glyph" viewBox="0 0 120 90" width={size} height={(size * 90) / 120} aria-hidden="true" focusable="false">
      {ART[item]}
    </svg>
  );
}
