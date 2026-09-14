"use client";

/**
 * The breadcrumb, and the legend that is also the filter.
 *
 * THE LEGEND IS A CONTROL NOW. It named eight readings of the sheet and let a
 * reader do nothing with any of them, while the one thing that could narrow the
 * sheet — the state filter — had gone with the toolbar and survived only as a
 * capability an agent could call. Each entry is a toggle: pressing it lights its
 * own invoices and dims the rest, at L0 and at L1 both, because both levels draw
 * from the same `presenceOf`. Pressing it again, or pressing Everything, is the
 * way back.
 *
 * It adds no vocabulary. `model/legend.ts` builds the panel out of
 * `STATE_FILTERS` — the same enum `set_filter` and `navigate` address — so a
 * press and a call end in one `setFilter`, and the counts beside each entry are
 * counted off the sheet rather than estimated.
 *
 * THE PRESENCE READING MOVED HERE from the masthead, with the agent-driven pass that took the
 * mast's bar and status line down: the sheet is the environment an agent works in, not a console
 * a person drives, so a line above the fold telling a reader whether Athena is attached addresses
 * somebody who is not the audience. `DESIGN-LAW.md` §4.1 (in the hirelane app, which the three
 * share) is explicit that the reading may be MOVED and not deleted — it is still on the surface,
 * still without interaction, still counted from the manifest rather than typed.
 */
import { useMemo } from "react";

import { formatMoneyShort } from "@/lib/format";
import { REGISTER } from "@/lib/manifest";
import {
  HEAT_LABEL,
  LEGEND,
  legendCounts,
  legendSay,
  toggleState,
  type LnFilter,
  type LnLane,
  type LnMark,
  type LnSheet,
} from "../model";
import { useAthenaPresence } from "../presence";
import { PresenceLine } from "../PresenceLine";

const GATED = REGISTER.filter((t) => !t.auto).length;

export function Foot({
  sheet,
  lane,
  mark,
  level,
  nav,
  filter,
  setFilter,
}: {
  sheet: LnSheet;
  lane: LnLane | undefined;
  mark: LnMark | undefined;
  level: number;
  nav: { home: () => void; up: () => void; openGroup: (id: string) => void };
  filter: LnFilter;
  setFilter: (next: LnFilter) => void;
}) {
  const presence = useAthenaPresence();
  /* Counted off the sheet, once per client narrowing — 124 invoices against
     eight predicates is a thousand comparisons, which is nothing, but it is
     nothing on every keystroke without this. */
  const counts = useMemo(() => legendCounts(sheet, filter.client), [sheet, filter.client]);
  const total = sheet.totals.invoiceCount;

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
       * The key, and the control, as one row.
       *
       * Every entry is a real button with `aria-pressed`, so the panel is
       * keyboard-operable by being made of controls rather than by a handler
       * that reimplements what a button already does. Its accessible name
       * carries the count and the clause — "Late, 54 of 124 invoices, past its
       * due date and still owed" — because a swatch and a word is a legend and
       * a reader who cannot see the swatch still has to be able to filter.
       */}
      <div className="ln-legend">
        <div className="ln-legend-set" role="group" aria-label="Light a state, dim the rest">
          <span className="ln-label">show</span>
          {LEGEND.map((entry) => {
            const on = filter.state === entry.state;
            const count = counts[entry.state] ?? 0;
            return (
              <button
                key={entry.state}
                type="button"
                className="ln-legend-chip"
                data-state={entry.state}
                data-heat={entry.heat ?? undefined}
                aria-pressed={on}
                onClick={() => setFilter(toggleState(filter, entry.state))}
                aria-label={`${entry.label}, ${count} of ${total} invoices — ${entry.says}`}
              >
                {entry.heat ? <i aria-hidden /> : null}
                {entry.glyph ? <em aria-hidden>{entry.glyph}</em> : null}
                <span aria-hidden>{entry.label}</span>
                <b className="num" aria-hidden>
                  {count}
                </b>
              </button>
            );
          })}
        </div>
        {/*
         * What the press did, said once, politely. A filter that dims rather
         * than removes is the right behaviour and the hardest one to perceive —
         * nothing leaves the screen — so the count is the feedback.
         */}
        {/* The press and the register share a row: two quiet second lines under
            the chips rather than two stacked bands, which is 40px of the swarm
            given back at 1440. */}
        <div className="ln-legend-under">
          <p className="ln-legend-say" role="status">
            {legendSay(filter.state, counts[filter.state] ?? 0, total)}
          </p>
          {/* The half of the old key a row of filter chips cannot say for
              itself: the chips carry the colour, the sheet also encodes money
              as width and lateness as length. Outside the live region, because
              it never changes. */}
          <span className="ln-legend-key">
            Width is the balance; the tail is how late.
          </span>
          <PresenceLine
            connected={presence.bridged}
            offered={REGISTER.length}
            gated={GATED}
          />
        </div>
      </div>
    </footer>
  );
}
