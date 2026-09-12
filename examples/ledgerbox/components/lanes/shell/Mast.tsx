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
 * THE PRESENCE LINE IS A READING. It used to say "Athena is not connected" in ink; it now asks
 * `useAthenaPresence`, which looks for the surface's own injected bridge. The capability counts
 * beside it come from the union manifest, so the sentence cannot claim a register the page does
 * not have.
 */
import { STUDIO } from "@athena/demo-kit/seed";

import { formatMoneyShort } from "@/lib/format";
import { REGISTER } from "@/lib/manifest";
import { useAthenaPresence } from "../presence";
import type { LnSheet } from "../model";

const AUTO = REGISTER.filter((t) => t.auto).length;
const GATED = REGISTER.length - AUTO;

export function Mast({ sheet }: { sheet: LnSheet }) {
  const presence = useAthenaPresence();

  return (
    <header className="ln-mast">
      <div>
        <span className="ln-label">
          {STUDIO.name} / the books — {STUDIO.owner.name}, {STUDIO.owner.title}
        </span>
        <h1 className="ln-title ln-display">Six areas of the practice, one clock</h1>
      </div>
      <p className="ln-presence" data-on={presence.bridged}>
        {presence.bridged
          ? `Athena is connected. ${AUTO} capabilities run on their own; ${GATED} ask first.`
          : `Athena is not connected. All ${REGISTER.length} capabilities are registered and waiting — ${GATED} of them gated.`}
      </p>
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
