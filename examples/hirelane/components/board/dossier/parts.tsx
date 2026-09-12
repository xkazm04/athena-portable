"use client";

/**
 * The band that titles a region, and nothing else.
 *
 * Every region of the dossier is ruled and labelled — that was the fix for a
 * card nobody could read at a glance — so the label is one component rather
 * than four copies of the same two elements.
 */
export function Band({ label, note }: { label: string; note?: string }) {
  return (
    <div className="bd-band-head">
      <p className="bd-block-label">{label}</p>
      {note ? <span className="bd-hand">{note}</span> : null}
    </div>
  );
}
