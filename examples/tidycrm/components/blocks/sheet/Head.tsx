"use client";

/**
 * The sheet head: what this print is, and the six figures that summarise it.
 *
 * A colour is a claim, so a zero here is set in graphite whatever it counts. A
 * green nought read as "all clear" when it meant "none", which is the opposite
 * of the truth on a sheet whose whole subject is how much has not been checked.
 */
import { STUDIO } from "@athena/demo-kit/seed";

import type { BkSheet } from "../model";

export function SheetHead({ sheet }: { sheet: BkSheet }) {
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
      </div>
      <div className="bk-coverage">
        <div>
          <b className="bk-fig">{Math.round(sheet.coverage * 100)}%</b>
          <span className="bk-lettering">of records checked</span>
        </div>
        <div>
          {/* A colour is a claim. A zero has no claim to make, so it is set
              in graphite: a green 0 read as "all clear" when it meant
              "none". */}
          <b className="bk-fig" data-tone={sheet.deviationTotal > 0 ? "redline" : undefined}>
            {sheet.deviationTotal}
          </b>
          <span className="bk-lettering">deviations outstanding</span>
        </div>
        <div>
          <b className="bk-fig" data-tone={sheet.unadjudicated > 0 ? "goldline" : undefined}>
            {sheet.unadjudicated}
          </b>
          <span className="bk-lettering">pairs awaiting a person</span>
        </div>
        <div>
          <b className="bk-fig" data-tone={sheet.clearTables > 0 ? "greenline" : undefined}>
            {sheet.clearTables}
          </b>
          <span className="bk-lettering">blocks fully checked</span>
        </div>
        <div>
          <b className="bk-fig">{sheet.changed}</b>
          <span className="bk-lettering">rows changed so far</span>
        </div>
        <div>
          <b className="bk-fig">REV {sheet.revision}</b>
          <span className="bk-lettering">of this print</span>
        </div>
      </div>
    </header>
  );
}
