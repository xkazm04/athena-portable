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
      className="bk-zone-chip"
      aria-pressed={showKinds}
      onClick={() => setShowKinds((v) => !v)}
    >
      {showKinds ? "Hide the breakdown" : "Break the deviations down"}
    </button>
  </div>
  {showKinds ? (
    <div className="bk-marks">
      {KIND_ORDER.map((kind) => (
        <span className="bk-mark" data-kind={kind} key={kind}>
          {DEVIATION_LABEL[kind]} {sheet.byKind[kind]}
        </span>
      ))}
    </div>
  ) : null}
    </>
  );
}
