"use client";

/**
 * The masthead: whose books these are, one headline, three poster figures, and one honest line
 * about whether an agent is here.
 *
 * The figures are the books at a glance — what is late, what is disputed, what is unapplied — set
 * at the size the direction's source uses for a hero. L1 repeats the device for one lane, and the
 * two read as one instrument because they are literally the same class.
 *
 * NO LINKS. There used to be two, "All directions" at `/v` and "The Strip" at `/`, from the round
 * where this was one candidate among several. The Lanes IS the app now and there is nowhere else
 * to be, so the masthead does not pretend there is.
 *
 * THE PRESENCE LINE IS NOT HERE ANY MORE. It moved to `shell/Foot.tsx` with the agent-driven
 * pass that took the filter bar and the level rail down: the sheet is the environment an agent
 * works in, not a console a person drives, so a status line above the fold was addressing a
 * reader who is not the audience. It is moved and not deleted — `PresenceLine.tsx` still draws
 * the same reading from the same manifest, one region lower.
 */
import { STUDIO } from "@athena/demo-kit/seed";

import { formatMoneyShort } from "@/lib/format";
import type { LnSheet } from "../model";

export function Mast({ sheet }: { sheet: LnSheet }) {
  return (
    <header className="ln-mast">
      <div>
        <span className="ln-label">
          {STUDIO.name} / the books — {STUDIO.owner.name}, {STUDIO.owner.title}
        </span>
        <h1 className="ln-title ln-display">Six areas of the practice, one clock</h1>
      </div>
      <div className="ln-mast-under">
        <div className="ln-readout">
          <div data-tone="alert">
            <b>{formatMoneyShort(sheet.totals.overdueCents)}</b>
            <span>{sheet.totals.overdueCount} late</span>
          </div>
          <div>
            <b>{sheet.totals.disputedCount}</b>
            <span>disputed</span>
          </div>
          <div>
            <b>{sheet.totals.unmatchedCount}</b>
            <span>credits unapplied</span>
          </div>
        </div>
      </div>
    </header>
  );
}
