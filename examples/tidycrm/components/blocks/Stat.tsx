"use client";

/**
 * One figure and the word under it — the only way a figure is printed anywhere
 * in this direction.
 *
 * THE PROBLEM THIS FIXES. The same read-out existed at three depths in three
 * slightly different treatments: the sheet head at one size, the zone key at
 * another, the L1 cell and the dossier verdict at two more, each with its own
 * label rule. Four treatments of one idea is not a hierarchy, it is drift — a
 * reader comparing "255 records" on the plate with "255 records" in the zone
 * head had to decide, every time, whether the difference in weight meant
 * anything. It did not.
 *
 * So there is ONE scale. The figure is the figure face at `--bk-text-md`,
 * tabular, whatever it counts and wherever it stands; the label is the one
 * label style (`--bk-label-size`, sentence case, `--bk-graphite-2`). What
 * changes between the four places is the ARRANGEMENT — a row on the mast, two
 * columns in the zone rail — and that is what `Stats` takes a modifier for.
 *
 * Everything renders as `<span>`: two of the four places are inside a
 * `<button>`, whose content model is phrasing content, so a `<div>` here would
 * be invalid in the zone key and the L1 cell.
 */

/** The three inks a figure may carry. A colour is a claim; see `outstandingTone`. */
export type StatTone = "redline" | "goldline" | "greenline";

export function Stats({
  className,
  children,
}: {
  /** An arrangement modifier — `bk-stats-pair`, `bk-verdict` — never a new scale. */
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={className ? `bk-stats ${className}` : "bk-stats"}>{children}</span>;
}

export function Stat({
  value,
  label,
  tone,
  quiet,
}: {
  value: React.ReactNode;
  label: string;
  tone?: StatTone;
  /** A nought that counts nothing, set back so the figures that count read first. */
  quiet?: boolean;
}) {
  return (
    <span className="bk-stat" data-tone={tone} data-quiet={quiet ? "true" : undefined}>
      <b>{value}</b>
      <span>{label}</span>
    </span>
  );
}
