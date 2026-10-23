/**
 * Athena's seal - Main's jellyfish dome with the A mark and its trailing tendrils (Tideline's seal,
 * carried into Bell's window by the athena-mini-window merge round).
 *
 * One self-contained component: this markup, its stylesheet (`seal.css`) and one state input. The
 * window around it never reaches into its parts; it maps its own facts to one {@link SealState}
 * (`sealStateOf` in `model.ts`) and passes it down. `kind="seal"` is the dome at the anchor of every
 * resize; `kind="tab"` is her docked form: the A mark, the count and the working light.
 */
import { useId, type PointerEvent } from "react";

import "./seal.css";

/** What the seal can show. The caller maps its own facts to one of these. */
export const SEAL_STATES = [
  "rest",
  "quiet",
  "welcome",
  "working",
  "hearing",
  "speaking",
  "done",
  "stopped",
  "waiting",
  "signing",
  "signed",
  "declined",
] as const;

export type SealState = (typeof SEAL_STATES)[number];

/** States that show the count of decisions waiting on the person. */
const COUNTED: ReadonlySet<SealState> = new Set<SealState>(["waiting", "signing"]);

/** Athena's logo: the A mark, drawn once in the dome's coordinates. */
const MARK = "M31.5 41 L38 24 L44.5 41 M34 35.5 L42 35.5";
/** The mark alone, for the docked tab. */
const MARK_BOX = "29.5 22 17 21";
const CAP =
  "M8 50 C8 25 21 10 38 10 C55 10 68 25 68 50 q-5 6 -10 0 q-5 6 -10 0 q-5 6 -10 0 q-5 6 -10 0 q-5 6 -10 0 q-5 6 -10 0 Z";
const TENDRILS = ["M22 54 q-3 7 0 14", "M33 55 q3 8 0 15", "M44 55 q-3 8 0 15", "M55 54 q3 7 0 14"];

export interface SealProps {
  kind?: "seal" | "tab";
  state: SealState;
  /** Decisions waiting on the person; shown only in the counted states. */
  count: number;
  label: string;
  onActivate: () => void;
  /** A press that may become a drag (the housing's 4px rule lives with the caller). */
  onPointerDown?: (e: PointerEvent<HTMLButtonElement>) => void;
}

function Dome() {
  // Two seals on one page (the preview) must not share gradient ids.
  const id = useId().replace(/:/g, "");
  return (
    <svg className="seal-dome" viewBox="0 0 76 76" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-dome`} cx="50%" cy="38%" r="70%">
          <stop className="seal-stop-a" offset="0" />
          <stop className="seal-stop-b" offset="1" />
        </radialGradient>
        <radialGradient id={`${id}-orb`} cx="50%" cy="50%" r="50%">
          <stop className="seal-orb-0" offset="0" />
          <stop className="seal-orb-1" offset=".6" />
          <stop className="seal-orb-2" offset="1" />
        </radialGradient>
      </defs>
      <g className="seal-tent">
        {TENDRILS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <path className="seal-cap" fill={`url(#${id}-dome)`} d={CAP} />
      <path className="seal-gleam" d="M17 36 C19 25 27 17 37 15.5" />
      <circle className="seal-orb" fill={`url(#${id}-orb)`} cx="38" cy="33" r="16" />
      <circle className="seal-ring" cx="38" cy="33" r="18.5" pathLength={100} />
      <path className="seal-mark" d={MARK} />
      <path className="seal-check" pathLength={100} d="M29 33 L35.5 39.5 L48 25" />
      <path className="seal-cross" d="M31 26 L45 40 M45 26 L31 40" />
      <circle className="seal-sign" cx="38" cy="38" r="42" pathLength={100} />
    </svg>
  );
}

export function Seal({ kind = "seal", state, count, label, onActivate, onPointerDown }: SealProps) {
  const shown = count > 0 && COUNTED.has(state) ? String(count) : "";
  const counted = shown ? "1" : "0";
  if (kind === "tab") {
    return (
      <div className="seal-tab" data-seal={state} data-counted={counted}>
        <button type="button" className="seal-hit" aria-label={label} onClick={onActivate} onPointerDown={onPointerDown}>
          <svg className="seal-a" viewBox={MARK_BOX} aria-hidden="true">
            <path className="seal-mark" d={MARK} />
          </svg>
          <span className="seal-count" aria-hidden="true">
            {shown}
          </span>
          <i className="seal-light" aria-hidden="true" />
        </button>
      </div>
    );
  }
  return (
    <div className="seal" data-seal={state} data-counted={counted}>
      <button type="button" className="seal-hit" aria-label={label} onClick={onActivate} onPointerDown={onPointerDown}>
        <Dome />
      </button>
      <span className="seal-count" aria-hidden="true">
        {shown}
      </span>
    </div>
  );
}
