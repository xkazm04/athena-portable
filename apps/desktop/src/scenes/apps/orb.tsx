/**
 * An app drawn as a window of light — README section 3.1, ADR 0087.
 *
 * Stylised art, drawn for this scene: a window frame with the app's initial in it and its standing
 * as a mark in the corner. The standing is told by **shape and word, never by colour alone**: a
 * filled dot is ready, a dashed ring is reading, a half dot is read only, an empty ring is not
 * opened, a slash is not acting. A drawing, not a screenshot of the app, and not its logo.
 *
 * Moves only on the compositor (a dashed ring that turns while it is reading, a slow float) and
 * stops under Calm.
 */
import type { ReactElement } from "react";

import type { AppStanding } from "@/modules/browser/model";

const STANDING_MARK: Record<AppStanding, (c: string) => ReactElement> = {
  ready: (c) => <circle cx="0" cy="0" r="6" fill={c} />,
  reading: (c) => (
    <circle className="orb__spin" cx="0" cy="0" r="6.5" fill="none" stroke={c} strokeWidth="2" strokeDasharray="3 3" />
  ),
  readonly: (c) => (
    <>
      <circle cx="0" cy="0" r="6.5" fill="none" stroke={c} strokeWidth="2" />
      <path d="M0 -6.5 A6.5 6.5 0 0 1 0 6.5 Z" fill={c} />
    </>
  ),
  closed: (c) => <circle cx="0" cy="0" r="6.5" fill="none" stroke={c} strokeWidth="2" />,
  disabled: (c) => (
    <>
      <circle cx="0" cy="0" r="6.5" fill="none" stroke={c} strokeWidth="2" />
      <path d="M-4.6 4.6 L4.6 -4.6" stroke={c} strokeWidth="2" strokeLinecap="round" />
    </>
  ),
};

const MARK_COLOUR: Record<AppStanding, string> = {
  ready: "var(--status-success)",
  reading: "var(--status-pending)",
  readonly: "var(--status-info)",
  closed: "var(--muted)",
  disabled: "var(--status-warning)",
};

export default function AppOrb({
  monogram,
  standing,
  size = 120,
}: {
  monogram: string;
  standing: AppStanding;
  size?: number;
}) {
  const lit = standing === "ready" || standing === "reading" || standing === "readonly";
  return (
    <svg className="orb" viewBox="0 0 120 120" width={size} height={size} aria-hidden="true" focusable="false">
      <g className="orb__float">
        <rect
          x="12"
          y="22"
          width="96"
          height="76"
          rx="10"
          fill="color-mix(in srgb, var(--card-bg) 90%, transparent)"
          stroke={lit ? "var(--accent)" : "var(--muted)"}
          strokeWidth={lit ? 2.4 : 1.6}
        />
        <path d="M12 38h96" stroke={lit ? "var(--accent)" : "var(--muted)"} strokeOpacity=".5" />
        <circle cx="23" cy="30" r="2.4" fill={lit ? "var(--accent)" : "var(--muted)"} />
        <circle cx="31" cy="30" r="2.4" fill={lit ? "var(--accent)" : "var(--muted)"} fillOpacity=".55" />
        <text
          x="60"
          y="78"
          textAnchor="middle"
          fontSize="34"
          fontWeight="300"
          fill={lit ? "var(--foreground)" : "var(--muted-foreground)"}
        >
          {monogram}
        </text>
        <g transform="translate(94 84)">{STANDING_MARK[standing](MARK_COLOUR[standing])}</g>
      </g>
    </svg>
  );
}
