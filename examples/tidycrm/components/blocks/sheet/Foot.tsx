"use client";

/**
 * The breadcrumb and the legend.
 *
 * The legend describes what is actually on screen at this level, which is not a
 * detail: an earlier one still described the retired SVG plate, telling readers
 * that a dot's size was its record count long after dots had stopped having
 * sizes.
 *
 * THE PRESENCE READING MOVED HERE from the head, with the agent-driven pass that took the level
 * rail and the breakdown toggle down: the sheet is the environment an agent works in rather than
 * a console a person drives, so a status line above the fold was addressing a reader who is not
 * the audience. `DESIGN-LAW.md` §4.1 (in the hirelane app, which the three share) is explicit
 * that the reading may be MOVED and not deleted — it is still on the surface, still visible
 * without interaction, still counted from the live registrations rather than typed.
 */
import { DEVIATION_LABEL, type BkSheet, type BkTable, type BkZone, type DeviationKind } from "../model";
import { presenceLine, useAthenaPresence } from "../presence";

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

export function SheetFoot({
  sheet,
  zone,
  table,
  level,
  showKinds,
  nav,
}: {
  sheet: BkSheet;
  zone: BkZone | undefined;
  table: BkTable | undefined;
  level: number;
  /**
   * Whether the deviation breakdown is open.
   *
   * It has no control on the surface any more — the toggle went with the bar — and it is moved by
   * `break_down_deviations` in `components/blocks/tools/`. It is rendered HERE rather than
   * dropped, because a tool that moves something invisible is a tool nobody can check, which is
   * the argument this app already makes about the accounting period in its sibling.
   */
  showKinds: boolean;
  nav: { up: () => void };
}) {
  const presence = useAthenaPresence();

  return (
    <footer className="bk-foot">
      <div className="bk-crumbs">
        <span className="bk-crumb">
          <b>The plate</b>
          <i>
            {sheet.tableCount} blocks · {sheet.records} records
          </i>
        </span>
        {zone ? (
          <span className="bk-crumb">
            <b>Zone {zone.id}</b>
            <i>
              {zone.tables.length} blocks · {zone.span}
            </i>
          </span>
        ) : null}
        {table ? (
          <span className="bk-crumb">
            <b>{table.ident}</b>
            <i>{table.name}</i>
          </span>
        ) : null}
        {level > 0 ? (
          <button type="button" className="bk-back" onClick={nav.up}>
            <span aria-hidden>←</span> back <kbd>Esc</kbd>
          </button>
        ) : null}
      </div>
      {/*
        * The legend describes the drawing that is actually on the sheet.
        * It used to describe the retired SVG plate — "one dot is one block,
        * its size is the record count", and a ring that nothing wears any
        * more — which was false at every level.
        */}
      <div className="bk-legend">
        <span data-tone="ink">
          <i /> one dot is one record, carrying nothing outstanding
        </span>
        <span data-tone="redline">
          <i /> deviates from the specification; a rule can repair it
        </span>
        <span data-tone="goldline">
          <i /> stands in an identity pair no rule may resolve
        </span>
        {level >= 1 ? (
          <span data-tone="ink" className="bk-legend-edge">
            <i /> a block&rsquo;s inner edge carries the strongest claim on it
          </span>
        ) : null}
        <span className="bk-presence" data-on={presence.bridged}>
          {presenceLine(presence)}
        </span>
      </div>
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
    </footer>
  );
}
