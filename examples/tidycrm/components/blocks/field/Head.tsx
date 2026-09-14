"use client";

/**
 * The database's own heading, and the five figures that are true of it.
 *
 * Everything `BkDatabase` carries used to vanish the moment it opened: the level
 * knew which tables it held and said nothing about them together. These are the
 * sheet head's figures asked of one database, in the sheet head's own grammar,
 * so the two read as one instrument.
 *
 * It arrives last of the four beats, because it is the only part of this level
 * that was never inside the L0 picture and so has nothing to arrive from.
 */
import { Stat, Stats } from "../Stat";
import { outstandingTone, type BkDatabase, type BkSheet } from "../model";

export function FieldHead({
  sheet,
  database,
  onOpenDatabase,
}: {
  sheet: BkSheet;
  database: BkDatabase;
  onOpenDatabase: (id: string) => void;
}) {
  return (
  <div className="bk-grid-head">
    <div className="bk-grid-title">
      <h2 className="bk-h2">{database.name}</h2>
      <p className="bk-lede">
        {database.tables.length} tables, {database.span}. One cluster is one table; one dot in it
        is one of its records, in the place the plate just put it.
      </p>
    </div>
    {/*
      * Switching databases is a decision, so the chip carries the figure the
      * decision turns on. A strip of nine bare names made the reader go back to
      * the plate to find out which one was worth opening.
      */}
    <div className="bk-db-strip" role="group" aria-label="Other databases">
      {sheet.databases.map((other) => (
        <button
          key={other.id}
          type="button"
          className="bk-chip bk-db-chip bk-db-jump"
          aria-pressed={other.id === database.id}
          aria-label={`${other.name}, ${other.tables.length} tables, ${other.deviationTotal} deviations outstanding`}
          onClick={() => onOpenDatabase(other.id)}
        >
          <span>{other.name}</span>
          <b data-tone={outstandingTone(other.deviationTotal)}>{other.deviationTotal}</b>
        </button>
      ))}
    </div>
    {/*
      * The database's own verdict, in the sheet head's grammar. Everything here
      * was on the legend key at L0 and then vanished the moment the database
      * was opened, which left the reader comparing six tables with no idea how
      * the database they are standing in compares to the other eight.
      */}
    <Stats className="bk-grid-verdict">
      <Stat value={database.records} label="records in this database" />
      <Stat value={`${Math.round(database.coverage * 100)}%`} label="carry nothing outstanding" />
      <Stat
        value={database.deviationTotal}
        label="deviations outstanding"
        tone={outstandingTone(database.deviationTotal)}
      />
      <Stat
        value={database.attention}
        label="tables awaiting a person"
        tone={database.attention > 0 ? "goldline" : undefined}
      />
      <Stat
        value={database.clear}
        label="tables fully checked"
        tone={database.clear > 0 ? "greenline" : undefined}
      />
    </Stats>
  </div>
  );
}
