"use client";

/**
 * The three small things every region of the dossier needs.
 *
 * A date in the print's own format, the fields a row shows beside its name, and
 * the band that titles a region. None is worth a file of its own, and all three
 * would otherwise be copied into whichever region happened to need them first.
 */
import type { BkRow } from "../model";

const dayMonthYear = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function fmtDate(iso: string): string {
  return dayMonthYear.format(new Date(iso));
}

/** The fields the side-by-side draws, in the order a reader compares them. */
export const SIDE_FIELDS: { key: keyof BkRow; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "company", label: "Company" },
  { key: "title", label: "Title" },
  { key: "city", label: "City" },
];

export function Band({ label, note }: { label: string; note?: string }) {
  return (
    <div className="bk-band-head">
      <p className="bk-lettering" data-ink="1">
        {label}
      </p>
      {note ? <span className="bk-band-note">{note}</span> : null}
    </div>
  );
}
