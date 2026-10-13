/**
 * One drawing per depth — README section 3.1, ADR 0087.
 *
 * Stylised key art, drawn for this app: an SVG per depth in the brand's strokes and the app's own
 * tokens (never a literal colour), so a light on the seabed reads as a thing before its word is
 * read. They are drawings, not screenshots of anything, and are labelled so wherever one could be
 * mistaken for the product. Each is a 120x90 scene with a slow float that is CSS on `transform`
 * and stops under Calm; none runs script.
 */
import type { ReactElement } from "react";

import type { Root } from "@/depth/model";

import "./glyphs.css";

const STROKE = "var(--muted-foreground)";

const ART: Record<Root, ReactElement> = {
  apps: (
    <g className="glyph__float">
      <rect x="16" y="14" width="56" height="40" rx="6" fill="color-mix(in srgb, var(--accent) 6%, transparent)" stroke="var(--muted)" strokeWidth="1.5" />
      <rect x="32" y="24" width="56" height="40" rx="6" fill="color-mix(in srgb, var(--accent) 9%, transparent)" stroke={STROKE} strokeWidth="1.5" />
      <rect x="48" y="34" width="56" height="40" rx="6" fill="var(--card-bg)" stroke="var(--accent)" strokeWidth="2" />
      <path d="M48 43h56" stroke="var(--accent)" strokeOpacity=".6" />
      <circle cx="54" cy="38.5" r="1.6" fill="var(--accent)" />
      <circle cx="59" cy="38.5" r="1.6" fill="var(--accent)" fillOpacity=".6" />
      <path d="M56 52h28M56 58h38M56 64h20" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" strokeOpacity=".75" />
    </g>
  ),
  chores: (
    <g className="glyph__float">
      <path d="M16 68 L40 46 L62 54 L90 22" fill="none" stroke="var(--accent)" strokeOpacity=".45" strokeDasharray="2 4" />
      <circle cx="16" cy="68" r="5" fill="var(--btn-primary)" stroke="var(--accent)" />
      <circle cx="40" cy="46" r="8" fill="color-mix(in srgb, var(--role-agent) 25%, transparent)" stroke="var(--role-agent)" strokeWidth="1.5" />
      <circle cx="62" cy="54" r="6" fill="color-mix(in srgb, var(--role-external) 20%, transparent)" stroke="var(--role-external)" strokeWidth="1.5" />
      <circle cx="90" cy="22" r="15" fill="color-mix(in srgb, var(--accent) 18%, transparent)" stroke="var(--focus)" strokeWidth="2" />
      <circle cx="90" cy="22" r="6" fill="var(--foreground)" />
      <circle cx="102" cy="60" r="4" fill="color-mix(in srgb, var(--status-success) 30%, transparent)" stroke="var(--status-success)" />
    </g>
  ),
  accounts: (
    <g className="glyph__float">
      <circle cx="46" cy="42" r="20" fill="none" stroke={STROKE} strokeWidth="3" />
      <circle cx="72" cy="42" r="20" fill="none" stroke="var(--accent)" strokeWidth="3" />
      <path d="M80 60 l10 16 M86 70 l6-4 M90 76 l6-4" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="38" cy="26" r="4.5" fill="var(--status-warning)" />
    </g>
  ),
  voice: (
    <g className="glyph__float" fill="none" strokeLinecap="round">
      <path d="M44 30 C44 22 54 18 60 18 C66 18 76 22 76 30 L76 40 C76 44 74 46 70 46 L50 46 C46 46 44 44 44 40 Z" fill="color-mix(in srgb, var(--accent) 18%, transparent)" stroke="var(--focus)" strokeWidth="2" />
      <path d="M52 46 C50 56 54 62 52 72 M60 46 C62 58 58 64 60 76 M68 46 C66 56 70 62 68 72" stroke="var(--accent)" strokeOpacity=".7" strokeWidth="1.6" />
      <path d="M86 22 C92 28 92 38 86 44 M94 16 C104 26 104 40 94 50" stroke="var(--accent)" strokeWidth="2" />
      <path d="M34 22 C28 28 28 38 34 44 M26 16 C16 26 16 40 26 50" stroke="var(--accent)" strokeWidth="2" strokeOpacity=".5" />
    </g>
  ),
  mind: (
    <g className="glyph__float">
      <path d="M60 8 L86 26 L80 62 L60 78 L40 62 L34 26 Z" fill="color-mix(in srgb, var(--accent) 10%, transparent)" stroke="var(--focus)" strokeWidth="2" />
      <path d="M60 8 L60 78 M34 26 L86 26 M40 62 L80 62 M34 26 L60 46 L86 26 M40 62 L60 46 L80 62" stroke="var(--accent)" strokeOpacity=".45" fill="none" />
      <circle cx="60" cy="46" r="6" fill="var(--foreground)" />
    </g>
  ),
};

/** The drawing for a depth. Decorative: the label next to it is the accessible name. */
export default function Glyph({ root, size = 120 }: { root: Root; size?: number }) {
  return (
    <svg
      className="glyph"
      viewBox="0 0 120 90"
      width={size}
      height={(size * 90) / 120}
      aria-hidden="true"
      focusable="false"
    >
      {ART[root]}
    </svg>
  );
}
