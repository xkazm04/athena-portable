"use client";

/**
 * The breadcrumb and the legend.
 *
 * The legend describes what is actually on screen at this level, which is not a
 * detail: an earlier one still described the retired SVG plate, telling readers
 * that a dot's size was its record count long after dots had stopped having
 * sizes.
 */
import type { BkSheet, BkTable, BkZone } from "../model";

export function SheetFoot({
  sheet,
  zone,
  table,
  level,
  nav,
}: {
  sheet: BkSheet;
  zone: BkZone | undefined;
  table: BkTable | undefined;
  level: number;
  nav: { up: () => void };
}) {
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
      </div>
    </footer>
  );
}
