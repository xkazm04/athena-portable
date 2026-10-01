/**
 * The companion's drawing kit — ADR 0026 ("Identity"), README section 3.1.
 *
 * The mark, the icon sprite, the stamp impression, the ring and the sketch of a page capture,
 * ported from The Countersign (`shared.js` and `athena.js` of the winning entry). All of it is
 * pure markup: nothing here knows a store, and nothing is an image file, so it renders the same
 * in a static-markup test, in the preview harness and in her window.
 *
 * The mark is a stamp face: a rounded field with an A cut out of it, the crossbar a tick.
 */
import type { ReactNode } from "react";

import type { By, Choice } from "./machine";

/** The mark. `field` and `cut` come from the caller so it can sit on teal, on paper or in ink. */
export function Mark({ className = "mk", field = "var(--mk-field)", cut = "var(--mk-cut)" }: {
  className?: string;
  field?: string;
  cut?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill={field} />
      <g fill="none" stroke={cut} strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8.6 24.4 16 7.4l7.4 17" />
        <path d="M11.9 19.2l3.2 3 5.2-6.2" strokeWidth="2.3" />
      </g>
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  pin: <path d="M9 3.5h6l-1 5.2 3 3.3H7l3-3.3ZM12 12v8.5" />,
  down: <path d="M6 9.5l6 6 6-6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  talk: <path d="M4 5.5h16v10.5H10l-4.5 3.5V16H4Z" />,
  record: (
    <>
      <path d="M6 3.5h12v17H6Z" />
      <path d="M9 8h6M9 12h6M9 16h3.5" />
    </>
  ),
  origin: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5V8M12 16v4.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  send: <path d="M4 12h15M13 6l6 6-6 6" />,
  warn: (
    <>
      <path d="M12 4 3.5 19h17Z" />
      <path d="M12 10v4M12 16.6v.4" />
    </>
  ),
  wait: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
};

export type IconName = keyof typeof ICONS;

/** One of the eleven icons on a 24 grid, drawn inline so a static render shows it too. */
export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg className={`ic ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  );
}

/** The ink-bleed filter the stamp impression uses. Rendered once per window. */
export function Defs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <filter id="aw-bleed" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="3.4" />
          <feGaussianBlur stdDeviation=".9" />
        </filter>
      </defs>
    </svg>
  );
}

function StampBody({ word, sub, len }: { word: string; sub: string; len: number }) {
  return (
    <g fill="none" stroke="currentColor">
      <rect x="4" y="4" width="232" height="104" rx="10" strokeWidth="5" />
      <rect x="12" y="12" width="216" height="88" rx="6" strokeWidth="1.6" />
      <g transform="translate(24 30) scale(1.5)">
        <path d="M2 20 9 4l7 16" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 15.5l2.8 2.6 4.6-5.4" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text x="140" y="60" textAnchor="middle" fontSize="33" fontWeight="800" fill="currentColor" stroke="none" textLength={len} lengthAdjust="spacingAndGlyphs">
        {word}
      </text>
      <line x1="66" y1="70" x2="214" y2="70" strokeWidth="1.5" />
      <text x="140" y="90" textAnchor="middle" fontSize="12.5" fontWeight="700" fill="currentColor" stroke="none" textLength={Math.min(148, sub.length * 7.3)} lengthAdjust="spacing">
        {sub}
      </text>
    </g>
  );
}

/** The impression: the word, what it means, and a blurred twin that bleeds under it. */
export function Stamp({ kind, by = "click" }: { kind: Choice | "welcome"; by?: By }) {
  const word = kind === "approve" ? "APPROVED" : kind === "decline" ? "DECLINED" : "ASKS FIRST";
  const sub =
    kind === "approve"
      ? by === "voice"
        ? "COUNTERSIGNED BY VOICE"
        : "COUNTERSIGNED BY YOU"
      : kind === "decline"
        ? "NOTHING WAS SENT"
        : "THEN SHE ACTS";
  return (
    <svg viewBox="0 0 240 112" aria-hidden="true">
      <g className="bleed" filter="url(#aw-bleed)">
        <StampBody word={word} sub={sub} len={168} />
      </g>
      <g>
        <StampBody word={word} sub={sub} len={168} />
      </g>
    </svg>
  );
}

/** Twelve dots round the seal. `lit` of them are on; in the working tone the next one breathes. */
export function Ring({ lit, working }: { lit: number; working: boolean }) {
  return (
    <svg className="aw-ring" viewBox="0 0 76 76" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * 30 - 90) * (Math.PI / 180);
        return (
          <circle
            key={i}
            cx={(38 + 25 * Math.cos(a)).toFixed(2)}
            cy={(31 + 25 * Math.sin(a)).toFixed(2)}
            r="1.9"
            className={i < lit ? "on" : i === lit && working ? "next" : ""}
          />
        );
      })}
    </svg>
  );
}

/** A stand-in for the page capture, labelled as one wherever it is shown. */
export function Sketch() {
  return (
    <svg viewBox="0 0 116 66" aria-hidden="true">
      <rect x=".75" y=".75" width="114.5" height="64.5" rx="4" fill="#fff" stroke="var(--paper-rule)" />
      <rect x="1" y="1" width="114" height="11" rx="3" fill="var(--paper-3)" />
      <circle cx="7" cy="6.5" r="1.8" fill="var(--paper-ink-2)" />
      <circle cx="13" cy="6.5" r="1.8" fill="var(--paper-ink-2)" />
      <rect x="8" y="18" width="46" height="4" rx="2" fill="var(--paper-ink)" opacity=".75" />
      <rect x="8" y="27" width="98" height="3" rx="1.5" fill="var(--paper-ink-2)" opacity=".5" />
      <rect x="8" y="34" width="90" height="3" rx="1.5" fill="var(--paper-ink-2)" opacity=".5" />
      <rect x="8" y="41" width="70" height="3" rx="1.5" fill="var(--paper-stamp)" opacity=".8" />
      <rect x="8" y="49" width="34" height="10" rx="3" fill="none" stroke="var(--paper-stamp)" strokeWidth="1.2" />
    </svg>
  );
}

/** A gate class, as a word in a box: never colour alone. */
export function Chip({ cls }: { cls: "READ" | "AUTO" | "GATED" }) {
  return <span className={`chip chip-${cls.toLowerCase()}`}>{cls}</span>;
}
