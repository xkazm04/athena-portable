"use client";

/**
 * The sheet head: what this print is, whether an agent is beside it, and the six figures that
 * summarise it.
 *
 * A colour is a claim, so a zero here is set in graphite whatever it counts. A green nought read
 * as "all clear" when it meant "none", which is the opposite of the truth on a sheet whose whole
 * subject is how much has not been checked.
 *
 * THE SIX FIGURES ARE `Stat`s, like every other figure in the direction. They used to be this
 * file's own markup at this file's own size, which is how the plate, the zone head and the block
 * card ended up printing one idea three ways.
 */
import { STUDIO } from "@athena/demo-kit/seed";

import { Stat, Stats } from "../Stat";
import { presenceLine, useAthenaPresence } from "../presence";
import { outstandingTone, type BkSheet } from "../model";

export function SheetHead({ sheet }: { sheet: BkSheet }) {
  const presence = useAthenaPresence();

  return (
    <header className="bk-head">
      <div className="bk-head-top">
        <div>
          {/* Whose list this is. The three example apps are one studio's tabs, and the studio is
              named from the shared registry (@athena/demo-kit/seed) so the three cannot drift. */}
          <p className="bk-lettering">
            {STUDIO.name} / tidycrm / check print / the blocks
          </p>
          <h1 className="bk-h1">
            {sheet.tableCount} blocks, {sheet.records} records, read at three depths
          </h1>
        </div>
        {/* A reading, not a caption: `presence.ts` looks for the surface's own injected bridge and
            counts the registrations actually on the page. */}
        <p className="bk-presence" data-on={presence.bridged}>
          {presenceLine(presence)}
        </p>
      </div>
      <Stats className="bk-mast-figures">
        <Stat value={`${Math.round(sheet.coverage * 100)}%`} label="of records checked" />
        {/* A colour is a claim. A zero has no claim to make, so it is set in graphite: a green 0
            read as "all clear" when it meant "none". */}
        <Stat
          value={sheet.deviationTotal}
          label="deviations outstanding"
          tone={outstandingTone(sheet.deviationTotal)}
        />
        <Stat
          value={sheet.unadjudicated}
          label="pairs awaiting a person"
          tone={sheet.unadjudicated > 0 ? "goldline" : undefined}
        />
        <Stat
          value={sheet.clearTables}
          label="blocks fully checked"
          tone={sheet.clearTables > 0 ? "greenline" : undefined}
        />
        <Stat value={sheet.changed} label="rows changed so far" />
        <Stat value={`Rev ${sheet.revision}`} label="of this print" />
      </Stats>
    </header>
  );
}
