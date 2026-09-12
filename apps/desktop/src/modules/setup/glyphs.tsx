/**
 * The Setup module's glyphs — one drawing per fact, and the hero above the letter.
 *
 * Every stroke is `currentColor` so the hue is the caller's: the muted tier at rest, the primary
 * hue when the fact stands "done". The hero's lit parts are `var(--primary)` by name, because a
 * lit page is the one thing in it that has a colour of its own. Nothing here is a hex value, and
 * nothing here moves.
 *
 * A glyph says which fact a passage or a row is about at a glance, which a word beside it also
 * says; the drawing is a second channel, never the only one, so every glyph is `aria-hidden`.
 */
import type { ReactNode } from "react";

export type GlyphName = "engine" | "page" | "microphone" | "brain" | "theme" | "voice" | "data";

function Glyph({ size = 22, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      className="setup-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** A terminal prompt: the engine is a CLI the daemon runs a turn on. */
export function EngineGlyph({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M7 9.5l3 2.5-3 2.5" />
      <path d="M12.5 14.5H17" />
    </Glyph>
  );
}

/** A window with a tab and a page under it. */
export function PageGlyph({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 9h18" />
      <path d="M6 6.5h4.5" />
      <path d="M7 13h10M7 16h6" />
    </Glyph>
  );
}

export function MicrophoneGlyph({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3M9 21h6" />
    </Glyph>
  );
}

/** Three sheets, stacked: the episodes, facts and playbooks a brain is. */
export function BrainGlyph({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M8 4h8.5L20 7.5V16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M16.5 4v3.5H20" />
      <path d="M4 8v10.5A2.5 2.5 0 0 0 6.5 21H16" />
      <path d="M9 11h7M9 14h5" />
    </Glyph>
  );
}

/** A circle half filled: the theme is one of two paints, or whichever the system asks for. */
export function ThemeGlyph({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17A8.5 8.5 0 0 0 12 3.5z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function VoiceGlyph({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M3.5 12h1.5M6.5 9v6M9.5 6v12M12.5 9.5v5M15.5 4.5v15M18.5 8.5v7M21 12h-1" />
    </Glyph>
  );
}

/** One file, the SQLite store, with its corner folded. */
export function DataGlyph({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M14 3v5h5" />
      <ellipse cx="12" cy="13" rx="3.5" ry="1.4" />
      <path d="M8.5 13v3c0 .8 1.6 1.4 3.5 1.4s3.5-.6 3.5-1.4v-3" />
    </Glyph>
  );
}

export const GLYPHS: Record<GlyphName, (props: { size?: number }) => ReactNode> = {
  engine: EngineGlyph,
  page: PageGlyph,
  microphone: MicrophoneGlyph,
  brain: BrainGlyph,
  theme: ThemeGlyph,
  voice: VoiceGlyph,
  data: DataGlyph,
};

/**
 * The hero above the letter: the window Athena works in, one page lit, and her mark beside it.
 * The frame is `currentColor` (the muted tier); the lit page and the mark are the primary hue.
 */
export function HeroIllustration() {
  return (
    <svg
      className="setup-hero"
      viewBox="0 0 200 120"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* the window */}
      <rect x="14" y="14" width="140" height="92" rx="6" />
      <path d="M14 32h140" />
      <rect x="22" y="20" width="26" height="8" rx="2" />
      <rect x="52" y="20" width="26" height="8" rx="2" stroke="var(--primary)" />
      <circle cx="141" cy="24" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="147" cy="24" r="1.6" fill="currentColor" stroke="none" />
      {/* the lit page */}
      <rect x="28" y="44" width="52" height="7" rx="2" stroke="var(--primary)" />
      <path d="M28 60h112" />
      <path d="M28 70h40M76 70h64M28 80h30M66 80h44M28 90h52" />
      <rect x="112" y="86" width="30" height="10" rx="3" stroke="var(--primary)" strokeDasharray="3 2" />
      {/* the mark */}
      <path
        d="M176 44l13 14-13 14-13-14z"
        stroke="var(--primary)"
        fill="var(--primary)"
        fillOpacity={0.18}
      />
      <path d="M176 74v22" stroke="var(--primary)" strokeDasharray="2 3" />
    </svg>
  );
}
