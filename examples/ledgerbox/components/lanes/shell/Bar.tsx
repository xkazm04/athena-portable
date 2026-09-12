"use client";

/**
 * The level rail, the filters and the two view switches, on one row.
 *
 * SEVEN PIXELS TOO WIDE was enough to wrap this onto a second fifty-two-pixel
 * row and cost the swarm a whole lane. The horizontal padding is shaved rather
 * than the targets, none of which drops below forty-four pixels.
 */
import { PERIODS, PERIOD_LABEL, type Period } from "@/lib/constants";
import {
  STATE_FILTERS,
  STATE_FILTER_LABEL,
  isFiltered,
  type LnFilter,
  type LnLane,
  type LnSheet,
} from "../model";

const LEVELS = ["The books", "One area", "One invoice"] as const;

export function Bar({
  sheet,
  level,
  filter,
  setFilter,
  flat,
  setFlat,
  mode,
  setMode,
  shown,
  lane,
  shownInLane,
  picked,
  period,
  setPeriod,
  nav,
}: {
  sheet: LnSheet;
  level: number;
  filter: LnFilter;
  setFilter: (next: LnFilter | ((prev: LnFilter) => LnFilter)) => void;
  flat: boolean;
  setFlat: (next: boolean | ((v: boolean) => boolean)) => void;
  mode: "flat" | "raised";
  setMode: (next: "flat" | "raised") => void;
  /** Marks the filter is lighting across the whole sheet. */
  shown: number;
  /** The lane being read at L1, and how many of its marks the filter lights. */
  lane: LnLane | undefined;
  shownInLane: number;
  /** How many invoices `select` has ticked. Zero prints nothing. */
  picked: number;
  /** The period the close readout and `export_summary` are pointed at. */
  period: Period;
  setPeriod: (next: Period) => void;
  nav: { home: () => void; up: () => void };
}) {
  return (
    <div className="ln-bar">
      <div className="ln-rail" role="group" aria-label="Zoom level">
        {LEVELS.map((name, index) => (
          <button
            key={name}
            type="button"
            className="ln-rung"
            data-on={index <= level}
            data-here={index === level}
            disabled={index >= level}
            onClick={() => {
              if (index === 0) nav.home();
              else nav.up();
            }}
          >
            <span className="ln-rung-no">{["I", "II", "III"][index]}</span>
            <span className="ln-rung-name">{name}</span>
          </button>
        ))}
      </div>
      <div className="ln-tools">
        <div className="ln-chips" role="group" aria-label="Filter by state">
          {STATE_FILTERS.map((state) => (
            <button
              key={state}
              type="button"
              className="ln-chip"
              aria-pressed={filter.state === state}
              onClick={() => setFilter((f) => ({ ...f, state }))}
            >
              {STATE_FILTER_LABEL[state]}
            </button>
          ))}
        </div>
        <label className="ln-select">
          <span className="ln-label">Client</span>
          <select
            value={filter.client}
            onChange={(event) => setFilter((f) => ({ ...f, client: event.target.value }))}
            aria-label="Filter by client"
          >
            <option value="all">every client</option>
            {sheet.clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name} ({client.count})
              </option>
            ))}
          </select>
        </label>
        {/* The accounting period. It is a control rather than a readout because
            `set_period` and `export_summary` both move it, and a tool that moves
            something invisible is a tool nobody can check. */}
        <label className="ln-select">
          <span className="ln-label">Close</span>
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as Period)}
            aria-label="Accounting period for the close"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        {level === 0 ? (
          <div className="ln-toggle" role="group" aria-label="Overview depth">
            <button type="button" aria-pressed={!flat} onClick={() => setFlat(false)}>
              Tilted
            </button>
            <button type="button" aria-pressed={flat} onClick={() => setFlat(true)}>
              Flat
            </button>
          </div>
        ) : null}
        {level === 1 ? (
          <div className="ln-toggle" role="group" aria-label="How the lane is laid out">
            <button type="button" aria-pressed={mode === "flat"} onClick={() => setMode("flat")}>
              2D dates
            </button>
            <button
              type="button"
              aria-pressed={mode === "raised"}
              onClick={() => setMode("raised")}
            >
              3D amounts
            </button>
          </div>
        ) : null}
        {/*
         * The count counts WHAT IS ON SCREEN. Inside a lane of twelve it
         * went on reporting all 124 invoices in the books, which is the one
         * number in the toolbar and it was answering a question about a
         * level you had already left.
         */}
        <span className="ln-count">
          {level > 0 && lane
            ? isFiltered(filter)
              ? `${shownInLane} of ${lane.count} in ${lane.label.toLowerCase()}`
              : `${lane.count} in ${lane.label.toLowerCase()}`
            : isFiltered(filter)
              ? `showing ${shown} of ${sheet.totals.invoiceCount}`
              : `${sheet.totals.invoiceCount} invoices`}
        </span>
        {picked > 0 ? <span className="ln-picked">{picked} ticked</span> : null}
      </div>
    </div>
  );
}
