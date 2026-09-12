"use client";

/**
 * The zone's own heading, and the five figures that are true of it.
 *
 * Everything `BkZone` carries used to vanish the moment a zone opened: the
 * level knew which twelve blocks it held and said nothing about them together.
 * These are the sheet head's figures asked of one quarter of the sheet, in the
 * sheet head's own grammar, so the two read as one instrument.
 *
 * It arrives last of the four beats, because it is the only part of this level
 * that was never inside the cube and so has nothing to arrive from.
 */
import { outstandingTone, type BkSheet, type BkZone } from "../model";

export function FieldHead({
  sheet,
  zone,
  onOpenZone,
}: {
  sheet: BkSheet;
  zone: BkZone;
  onOpenZone: (id: string) => void;
}) {
  return (
  <div className="bk-grid-head">
    <div className="bk-grid-title">
      <h2 className="bk-h2">Zone {zone.id}</h2>
      <p className="bk-lede">
        {zone.tables.length} blocks, {zone.span}. One cluster is one block; one dot in it is one
        of its records, in the place the cube just put it.
      </p>
    </div>
    {/*
      * Switching zones is a decision, so the chip carries the figure the
      * decision turns on. A strip of four bare letters made the reader go
      * back to the plate to find out which one was worth opening.
      */}
    <div className="bk-zone-strip" role="group" aria-label="Other zones">
      {sheet.zones.map((other) => (
        <button
          key={other.id}
          type="button"
          className="bk-zone-chip bk-zone-jump"
          aria-pressed={other.id === zone.id}
          aria-label={`Zone ${other.id}, ${other.tables.length} blocks, ${other.deviationTotal} outstanding`}
          onClick={() => onOpenZone(other.id)}
        >
          <span>ZONE {other.id}</span>
          <b data-tone={outstandingTone(other.deviationTotal)}>
            {other.deviationTotal}
          </b>
        </button>
      ))}
    </div>
    {/*
      * The zone's own verdict, in the sheet head's grammar. Everything here
      * was on the zone key at L0 and then vanished the moment the zone was
      * opened, which left the reader comparing twelve blocks with no idea
      * how the zone they are standing in compares to the other three.
      */}
    <div className="bk-coverage bk-grid-verdict">
      <div>
        <b className="bk-fig">{zone.records}</b>
        <span className="bk-lettering">records in this zone</span>
      </div>
      <div>
        <b className="bk-fig">{Math.round(zone.coverage * 100)}%</b>
        <span className="bk-lettering">carry nothing outstanding</span>
      </div>
      <div>
        <b className="bk-fig" data-tone={outstandingTone(zone.deviationTotal)}>
          {zone.deviationTotal}
        </b>
        <span className="bk-lettering">deviations outstanding</span>
      </div>
      <div>
        <b className="bk-fig" data-tone={zone.attention > 0 ? "goldline" : undefined}>
          {zone.attention}
        </b>
        <span className="bk-lettering">blocks awaiting a person</span>
      </div>
      <div>
        <b className="bk-fig" data-tone={zone.clear > 0 ? "greenline" : undefined}>
          {zone.clear}
        </b>
        <span className="bk-lettering">blocks fully checked</span>
      </div>
    </div>
  </div>
  );
}
