/**
 * Athena drawn — README section 3.1 (surfaces), ADR 0087 and 0089.
 *
 * A bell of light with one tendril for each thing she may touch. It is a pure SVG view of a pose,
 * the things she reaches and where the person is looking, and it **never runs script per frame**:
 * the pulse, the sway of every tendril, the ripples and the lean toward what is hovered are CSS on
 * `transform`, `rotate` and `opacity`, which the compositor plays without the main thread. That is
 * what lets her stay alive on screen while the window costs nothing at rest, and why a pose change
 * is one attribute and not a render per frame. Under Calm every animation is off and she is a
 * drawing.
 *
 * Colour is the app's tokens through `--bell-core`, set per pose in `bell.css`. The art is
 * stylised: it is a drawing of her, not a screenshot of anything.
 */
import { useId } from "react";

import { POSE_WORDS, type Pose } from "./pose";
import "./bell.css";

export interface Reach {
  id: string;
  /** Lit when the thing is switched on (an app she may touch, an account she may reach). */
  lit: boolean;
}

export interface BellProps {
  pose: Pose;
  reach: readonly Reach[];
  /** Where the person is looking, -1 (left) to 1 (right); tendrils lean toward it. */
  lean?: number;
  /** Rendered width in CSS px; the height keeps the drawing's proportion. */
  size?: number;
  /** A screen-reader name; omit when the caller's own text already names her. */
  label?: string;
}

const W = 400;
const H = 420;
const ROOT_Y = 206;
const SPREAD_FROM = 96;
const SPREAD_TO = 304;

/** Where tendril `i` of `n` is rooted along the skirt of the bell. */
export function rootX(i: number, n: number): number {
  if (n <= 1) return W / 2;
  return SPREAD_FROM + ((SPREAD_TO - SPREAD_FROM) * i) / (n - 1);
}

export default function Bell({ pose, reach, lean = 0, size = 360, label }: BellProps) {
  // Gradient ids are document-wide: two bells on one page must not share one, or the first wins
  // and every pose wears the first pose's colour.
  const uid = useId().replace(/:/g, "");
  const n = reach.length;
  const clamped = Math.max(-1, Math.min(1, lean));
  return (
    <svg
      className="bell"
      data-pose={pose}
      viewBox={`0 0 ${W} ${H}`}
      width={size}
      height={(size * H) / W}
      role={label ? "img" : undefined}
      aria-label={label ? `${label}, ${POSE_WORDS[pose]}` : undefined}
      aria-hidden={label ? undefined : true}
      style={{ ["--lean" as string]: clamped }}
    >
      <defs>
        <radialGradient id={`${uid}-core`} cx="50%" cy="45%" r="55%">
          <stop offset="0" stopColor="var(--bell-core)" stopOpacity="0.95" />
          <stop offset="1" stopColor="var(--bell-core)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-skin`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      <g className="bell__tendrils">
        {reach.map((r, i) => (
          <g key={r.id} transform={`translate(${rootX(i, n).toFixed(1)} ${ROOT_Y})`}>
            <g
              className="bell__tendril"
              data-lit={r.lit}
              style={{ ["--i" as string]: i, ["--k" as string]: (rootX(i, n) - W / 2) / 104 }}
            >
              <g className="bell__sway">
                <g className="bell__sway bell__sway--tip">
                  <path d="M0 0 C 4 52, -8 98, 0 150" />
                  <circle cx="0" cy="150" r="4.5" />
                </g>
              </g>
            </g>
          </g>
        ))}
      </g>

      <g className="bell__body">
        <ellipse className="bell__ripple" cx="200" cy="140" rx="150" ry="104" />
        <ellipse className="bell__ripple bell__ripple--late" cx="200" cy="140" rx="150" ry="104" />
        <path
          className="bell__dome"
          d="M56 206 C56 98 120 36 200 36 C280 36 344 98 344 206 C330 218 316 218 302 206 C288 218 274 218 260 206 C246 218 232 218 218 206 C204 218 190 218 176 206 C162 218 148 218 134 206 C120 218 106 218 92 206 C78 218 66 216 56 206 Z"
          fill={`url(#${uid}-skin)`}
        />
        <path className="bell__rim" d="M96 150 C110 96 150 66 200 66" />
        <circle className="bell__core" cx="200" cy="140" r="64" fill={`url(#${uid}-core)`} />
        <g className="bell__mark" transform="translate(200 142)">
          <path d="M-16 20 0 -22 16 20" />
          <path d="M-8 8 -1 15 11 1" />
        </g>
      </g>
    </svg>
  );
}
