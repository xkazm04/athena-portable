"use client";

/**
 * The breadcrumb and the legend.
 *
 * The legend lists ALL FIVE colours and all three glyphs. It used to list
 * three, including neither the blue that is a quarter of the marks nor the grey
 * that means "not in play" — so a reader could see two states on the sheet that
 * the key did not admit existed.
 */
import { formatMoneyShort } from "@/lib/format";
import { HEAT_LABEL, type LnLane, type LnMark, type LnSheet } from "../model";

export function Foot({
  sheet,
  lane,
  mark,
  level,
  nav,
}: {
  sheet: LnSheet;
  lane: LnLane | undefined;
  mark: LnMark | undefined;
  level: number;
  nav: { home: () => void; up: () => void; openGroup: (id: string) => void };
}) {
  return (
    <footer className="ln-foot">
      {/*
       * A trail you can actually walk back up.
       *
       * Every crumb but the last one was an inert `<span>` dressed as a
       * path, which is the sort of thing a person tries once and then stops
       * trusting. Each ancestor is a real button now.
       *
       * The ancestors also drop their figures. At L0 "6 areas · $1,791,703
       * outstanding" is the sheet's own summary and belongs there; from
       * inside a lane it is a statistic about the level you left, and
       * carrying it cost 185px in a row that then wrapped and took 57px of
       * the swarm's height with it on every single drill-in.
       */}
      <div className="ln-crumbs">
        {level === 0 ? (
          <span className="ln-crumb">
            <b>The books</b>
            <i>
              {sheet.lanes.length} areas · {formatMoneyShort(sheet.totals.outstandingCents)}{" "}
              outstanding
            </i>
          </span>
        ) : (
          <button type="button" className="ln-crumb ln-crumb-up" onClick={nav.home}>
            <b>The books</b>
          </button>
        )}
        {lane && level === 1 ? (
          <span className="ln-crumb">
            <b>{lane.label}</b>
            <i>
              {lane.count} invoices · {formatMoneyShort(lane.owedCents)} open
            </i>
          </span>
        ) : null}
        {lane && level === 2 ? (
          <button type="button" className="ln-crumb ln-crumb-up" onClick={nav.up}>
            <b>{lane.label}</b>
          </button>
        ) : null}
        {mark ? (
          <span className="ln-crumb">
            <b>{mark.number}</b>
            <i>{HEAT_LABEL[mark.heat]}</i>
          </span>
        ) : null}
        {level > 0 ? (
          <button
            type="button"
            className="ln-back"
            onClick={nav.up}
          >
            <span aria-hidden>←</span> back <kbd>Esc</kbd>
          </button>
        ) : null}
      </div>
      {/*
       * Two legends, because the sheet has two encodings and conflating
       * them is what made the old one incomplete. COLOUR is the state every
       * mark carries — and it was missing the blue, which is a quarter of
       * the marks and the whole right-hand half of the sheet. GLYPH is the
       * separate, sparser claim that a mark is asking for something.
       */}
      <div className="ln-legend">
        <span className="ln-legend-set">
          <span className="ln-label">colour</span>
          <span data-heat="alert">
            <i /> long overdue
          </span>
          <span data-heat="risk">
            <i /> late
          </span>
          <span data-heat="watch">
            <i /> within terms
          </span>
          <span data-heat="good">
            <i /> settled
          </span>
          <span data-heat="inert">
            <i /> not in play
          </span>
        </span>
        <span className="ln-legend-set">
          <span className="ln-label">glyph</span>
          <span data-heat="alert">
            <em>!</em> 45+ days
          </span>
          <span data-heat="alert">
            <em>?</em> disputed
          </span>
          <span data-heat="watch">
            <em>+</em> a credit fits
          </span>
        </span>
      </div>
    </footer>
  );
}
