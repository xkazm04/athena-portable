"use client";

/**
 * The level rail and the one control beside it.
 *
 * The rail is a read-out as much as a control: a rung nobody has reached is
 * disabled rather than hidden, so the depth of the direction is on screen from
 * the first frame instead of being something a reader discovers by clicking.
 */
import { BK_LEVELS, DEVIATION_LABEL, type BkSheet, type DeviationKind } from "../model";

const KIND_ORDER: DeviationKind[] = ["duplicate", "conflict", "phone", "stale"];

/**
 * The ink a kind's count carries, and the reason the two are not one colour.
 *
 * An unadjudicated duplicate is gold everywhere on this sheet because no rule may resolve it; the
 * other three deviate from a specification and a rule can repair them, so they are redline. A
 * nought makes no claim either way and stays graphite.
 */
function markTone(kind: DeviationKind, count: number): "redline" | "goldline" | undefined {
  if (count === 0) return undefined;
  return kind === "duplicate" ? "goldline" : "redline";
}

export function SheetBar({
  sheet,
  level,
  showKinds,
  setShowKinds,
  nav,
}: {
  sheet: BkSheet;
  level: number;
  showKinds: boolean;
  setShowKinds: (next: boolean | ((v: boolean) => boolean)) => void;
  nav: { home: () => void; up: () => void };
}) {
  return (
    <>
  <div className="bk-bar">
    <div className="bk-rail" role="group" aria-label="Zoom level">
      {BK_LEVELS.map((name, index) => (
        <button
          key={name}
          type="button"
          className="bk-rung"
          data-on={index <= level}
          data-here={index === level}
          disabled={index >= level}
          onClick={() => (index === 0 ? nav.home() : nav.up())}
        >
          <span className="bk-rung-no">{["I", "II", "III"][index]}</span>
          <span>{name}</span>
        </button>
      ))}
    </div>
    <button
      type="button"
      className="bk-chip bk-zone-chip"
      aria-pressed={showKinds}
      onClick={() => setShowKinds((v) => !v)}
    >
      {showKinds ? "Hide the breakdown" : "Break the deviations down"}
    </button>
  </div>
  {/*
    * The breakdown is four CHIPS, the same chip the zone strip at L1 is made of: a word and the
    * figure it counts, in the one box this direction gives a small standing fact. It used to be a
    * bare monospace line of eight alternating tokens — `Duplicate 10 Conflict 36 Phone 99 Stale
    * 108` — which a reader had to parse into pairs before it said anything.
    */}
  {showKinds ? (
    <div className="bk-marks" role="group" aria-label="Deviations by kind">
      {KIND_ORDER.map((kind) => (
        <span className="bk-chip" data-kind={kind} key={kind}>
          <span>{DEVIATION_LABEL[kind]}</span>
          <b data-tone={markTone(kind, sheet.byKind[kind])}>{sheet.byKind[kind]}</b>
        </span>
      ))}
    </div>
  ) : null}
    </>
  );
}
