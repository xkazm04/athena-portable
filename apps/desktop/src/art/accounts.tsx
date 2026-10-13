/**
 * One drawing per account, and one mark per standing — README sections 3.1 and 4, ADR 0087.
 *
 * Stylised key art drawn for this app, in its tokens (no literal colour). Gmail and Notion are
 * other people's brands: what is drawn here is a generic envelope and a generic page, never either
 * company's mark, and the scenes say so where the drawing could pass for the product. An account
 * the app has no drawing for gets the generic plug. The art is inked (accent) only while the
 * account is in use; otherwise it is the muted outline, so a connected account reads before its
 * word is read. Colour is never the only carrier of a standing: `StandingMark` gives each one its
 * own shape, and the word always stands beside it.
 *
 * Motion is the shared float in `glyphs.css` (CSS on `transform`, off under Calm); no script.
 */
import type { ReactElement } from "react";

import "./glyphs.css";

export type AccountStanding =
  | "not-connected"
  | "connected"
  | "needs-reauth"
  | "off"
  | "broken"
  | "unconfirmed";

const INK = (lit: boolean) => (lit ? "var(--accent)" : "var(--muted-foreground)");
const WASH = (lit: boolean) => `color-mix(in srgb, var(--accent) ${lit ? 14 : 5}%, transparent)`;

/** The plinth under every drawing: a ring that fills when the account is in use. */
function Plinth({ lit }: { lit: boolean }) {
  return (
    <g>
      <ellipse
        cx="80"
        cy="108"
        rx="46"
        ry="7"
        fill={`color-mix(in srgb, var(--accent) ${lit ? 22 : 0}%, transparent)`}
        stroke={lit ? "var(--accent)" : "var(--muted)"}
        strokeWidth="1.5"
        strokeDasharray={lit ? undefined : "3 5"}
      />
    </g>
  );
}

function Envelope({ lit }: { lit: boolean }) {
  const ink = INK(lit);
  return (
    <g className="glyph__float" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="28" y="34" width="104" height="64" rx="8" fill={WASH(lit)} stroke={ink} strokeWidth="2.5" />
      <path d="M32 40 L80 74 L128 40" stroke={ink} strokeWidth="2.5" />
      <path d="M32 94 L66 64 M128 94 L94 64" stroke={ink} strokeOpacity=".5" strokeWidth="1.5" />
      <path d="M104 22 L124 14 L116 34 L110 27 Z" fill="var(--card-bg)" stroke="var(--focus)" strokeWidth="2" />
      <path d="M110 27 L124 14" stroke="var(--focus)" strokeWidth="1.5" />
    </g>
  );
}

function Page({ lit }: { lit: boolean }) {
  const ink = INK(lit);
  return (
    <g className="glyph__float" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M46 18 H98 L118 38 V98 a6 6 0 0 1 -6 6 H46 a6 6 0 0 1 -6 -6 V24 a6 6 0 0 1 6 -6 Z" fill={WASH(lit)} stroke={ink} strokeWidth="2.5" />
      <path d="M98 18 V38 H118" stroke={ink} strokeWidth="2" />
      <rect x="52" y="48" width="12" height="12" rx="3" stroke="var(--focus)" strokeWidth="2" />
      <path d="M72 54 H104" stroke={ink} strokeWidth="2.5" />
      <rect x="52" y="68" width="12" height="12" rx="3" stroke={ink} strokeWidth="2" />
      <path d="M72 74 H98" stroke={ink} strokeWidth="2.5" />
      <path d="M52 92 H92" stroke={ink} strokeOpacity=".5" strokeWidth="2" />
    </g>
  );
}

function Plug({ lit }: { lit: boolean }) {
  const ink = INK(lit);
  return (
    <g className="glyph__float" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="52" y="40" width="56" height="38" rx="10" fill={WASH(lit)} stroke={ink} strokeWidth="2.5" />
      <path d="M66 40 V24 M94 40 V24" stroke="var(--focus)" strokeWidth="3" />
      <path d="M80 78 V96" stroke={ink} strokeWidth="3" />
      <circle cx="80" cy="59" r="5" fill={`color-mix(in srgb, var(--accent) ${lit ? 100 : 0}%, transparent)`} stroke={ink} strokeWidth="2" />
    </g>
  );
}

const ART: Record<string, (props: { lit: boolean }) => ReactElement> = {
  gmail: Envelope,
  notion: Page,
};

/** The drawing for an account. Decorative: the account's name beside it is the accessible name. */
export function AccountArt({ id, lit, size = 160 }: { id: string; lit: boolean; size?: number }) {
  const Art = ART[id] ?? Plug;
  return (
    <svg
      className="glyph account-art"
      viewBox="0 0 160 120"
      width={size}
      height={(size * 120) / 160}
      aria-hidden="true"
      focusable="false"
      data-lit={lit}
    >
      <Plinth lit={lit} />
      <Art lit={lit} />
    </svg>
  );
}

/**
 * The standing as a shape: a filled disc with a tick (connected), a triangle (needs reconnecting),
 * a ring with a bar (switched off), a square with a cross (broken), a diamond with a question
 * (unconfirmed), a dashed ring (not connected). Tone rides the stroke, but no two share a shape.
 */
export function StandingMark({ standing, size = 18 }: { standing: AccountStanding; size?: number }) {
  const tone: Record<AccountStanding, string> = {
    connected: "var(--status-success)",
    "needs-reauth": "var(--status-warning)",
    off: "var(--muted-foreground)",
    broken: "var(--status-error)",
    unconfirmed: "var(--status-warning)",
    "not-connected": "var(--muted-foreground)",
  };
  const c = tone[standing];
  return (
    <svg
      className="standing-mark"
      viewBox="0 0 20 20"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-standing={standing}
      fill="none"
      stroke={c}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {standing === "connected" && (
        <>
          <circle cx="10" cy="10" r="8" fill={c} />
          <path d="M6 10.4 L9 13.2 L14.2 7.2" stroke="var(--card-bg)" strokeWidth="2" />
        </>
      )}
      {standing === "needs-reauth" && (
        <>
          <path d="M10 2.5 L18 16.5 H2 Z" />
          <path d="M10 8 V11.6 M10 14 V14.2" />
        </>
      )}
      {standing === "off" && (
        <>
          <circle cx="10" cy="10" r="8" />
          <path d="M6 10 H14" />
        </>
      )}
      {standing === "broken" && (
        <>
          <rect x="2.5" y="2.5" width="15" height="15" rx="2.5" />
          <path d="M7 7 L13 13 M13 7 L7 13" />
        </>
      )}
      {standing === "unconfirmed" && (
        <>
          <path d="M10 1.8 L18.2 10 L10 18.2 L1.8 10 Z" />
          <path d="M8 8.2 a2 2 0 1 1 3 1.7 c-.7.4 -1 .8 -1 1.6 M10 14 V14.2" />
        </>
      )}
      {standing === "not-connected" && <circle cx="10" cy="10" r="8" strokeDasharray="2.6 3" />}
    </svg>
  );
}
