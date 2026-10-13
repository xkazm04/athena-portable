/**
 * The Voice depth's drawings — README section 3.1, ADR 0087 and 0089.
 *
 * One stylised SVG per engine she can speak or listen through (Kokoro, Whisper, OpenAI) and one
 * for each place under the Voice depth (the studio, settings). They are drawings made for this
 * app in its tokens, never a literal colour, and none is the engine's own logo: the scene says so
 * wherever one is large enough to be mistaken for it. The only motion is the shared slow float
 * (`glyphs.css`, compositor only, off under Calm); an install's ring is a stroke length set from
 * real progress, so it changes when the poll answers and never per frame.
 */
import type { ReactElement } from "react";

import "./glyphs.css";

export type VoiceArtKind = "kokoro" | "whisper" | "openai" | "studio" | "settings";

const STROKE = "var(--muted-foreground)";
/** Circumference of the progress ring (r = 62). */
const RING = 2 * Math.PI * 62;

const ART: Record<VoiceArtKind, ReactElement> = {
  kokoro: (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M80 116 C32 84 24 52 46 36 C62 24 77 31 80 45 C83 31 98 24 114 36 C136 52 128 84 80 116 Z"
        fill="color-mix(in srgb, var(--accent) 16%, transparent)"
        stroke="var(--focus)"
        strokeWidth="2.2"
      />
      <path
        d="M62 62 V78 M71 54 V86 M80 48 V92 M89 54 V86 M98 62 V78"
        stroke="var(--accent)"
        strokeWidth="3.2"
      />
      <path d="M26 54 C18 62 18 78 26 86 M16 46 C4 58 4 82 16 94" stroke="var(--accent)" strokeOpacity=".5" strokeWidth="2" />
      <path d="M134 54 C142 62 142 78 134 86 M144 46 C156 58 156 82 144 94" stroke="var(--accent)" strokeOpacity=".5" strokeWidth="2" />
    </g>
  ),
  whisper: (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect
        x="64"
        y="30"
        width="32"
        height="54"
        rx="16"
        fill="color-mix(in srgb, var(--accent) 14%, transparent)"
        stroke="var(--focus)"
        strokeWidth="2.2"
      />
      <path d="M72 46 H88 M72 54 H88 M72 62 H88" stroke="var(--accent)" strokeOpacity=".7" strokeWidth="2" />
      <path d="M50 66 C50 86 66 96 80 96 C94 96 110 86 110 66" stroke="var(--foreground)" strokeOpacity=".75" strokeWidth="2.4" />
      <path d="M80 96 V112 M64 112 H96" stroke="var(--foreground)" strokeOpacity=".75" strokeWidth="2.4" />
      <path d="M30 50 C24 58 24 72 30 80 M118 28 C130 40 130 60 118 72" stroke="var(--accent)" strokeOpacity=".45" strokeWidth="2" strokeDasharray="2 5" />
    </g>
  ),
  openai: (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M44 98 C24 98 18 76 34 68 C32 46 58 38 68 56 C76 34 108 38 110 62 C132 62 138 98 114 98 Z"
        fill="color-mix(in srgb, var(--role-external) 14%, transparent)"
        stroke="var(--role-external)"
        strokeWidth="2.2"
      />
      <path d="M80 88 V58 M68 70 L80 58 L92 70" stroke="var(--foreground)" strokeOpacity=".8" strokeWidth="2.8" />
      <path d="M52 112 H108" stroke={STROKE} strokeOpacity=".6" strokeWidth="2" strokeDasharray="2 5" />
    </g>
  ),
  studio: (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect
        x="60"
        y="22"
        width="40"
        height="62"
        rx="20"
        fill="color-mix(in srgb, var(--accent) 16%, transparent)"
        stroke="var(--focus)"
        strokeWidth="2.2"
      />
      <path d="M60 50 H100 M60 60 H100" stroke="var(--accent)" strokeOpacity=".55" />
      <path d="M44 62 C44 88 62 100 80 100 C98 100 116 88 116 62" stroke="var(--foreground)" strokeOpacity=".75" strokeWidth="2.4" />
      <path d="M80 100 V116 M62 116 H98" stroke="var(--foreground)" strokeOpacity=".75" strokeWidth="2.4" />
      <path d="M26 52 C20 62 20 78 26 88 M14 44 C2 58 2 82 14 96" stroke="var(--accent)" strokeOpacity=".5" strokeWidth="2" />
      <path d="M134 52 C140 62 140 78 134 88 M146 44 C158 58 158 82 146 96" stroke="var(--accent)" strokeOpacity=".5" strokeWidth="2" />
    </g>
  ),
  settings: (
    <g fill="none" strokeLinecap="round">
      <path d="M36 34 H124 M36 70 H124 M36 106 H124" stroke={STROKE} strokeOpacity=".55" strokeWidth="2.4" />
      <path d="M36 34 H66 M36 70 H100 M36 106 H82" stroke="var(--accent)" strokeWidth="3" />
      <circle cx="66" cy="34" r="9" fill="var(--card-bg)" stroke="var(--focus)" strokeWidth="2.2" />
      <circle cx="100" cy="70" r="9" fill="var(--card-bg)" stroke="var(--focus)" strokeWidth="2.2" />
      <circle cx="82" cy="106" r="9" fill="var(--card-bg)" stroke="var(--focus)" strokeWidth="2.2" />
    </g>
  ),
};

/**
 * A voice drawing. `ring` (0..1), when given, draws an install's real progress round the art.
 * Decorative: the heading beside it is the accessible name.
 */
export default function VoiceArt({
  kind,
  size = 160,
  ring,
  speaking = false,
}: {
  kind: VoiceArtKind;
  size?: number;
  ring?: number;
  /** Her voice is playing: the art glows. A data attribute; the glow itself is the scene's CSS. */
  speaking?: boolean;
}) {
  const progress = ring === undefined ? null : Math.max(0, Math.min(1, ring));
  return (
    <svg
      className="voice-art"
      data-kind={kind}
      data-speaking={speaking ? "true" : "false"}
      viewBox="0 0 160 140"
      width={size}
      height={(size * 140) / 160}
      aria-hidden="true"
      focusable="false"
    >
      {progress !== null && (
        <g transform="rotate(-90 80 70)">
          <circle cx="80" cy="70" r="62" fill="none" stroke="var(--line)" strokeWidth="3" />
          <circle
            cx="80"
            cy="70"
            r="62"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(progress * RING).toFixed(1)} ${RING.toFixed(1)}`}
          />
        </g>
      )}
      <g className="glyph__float">{ART[kind]}</g>
    </svg>
  );
}
