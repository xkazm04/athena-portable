/**
 * @catalog A drawing set in the brand's stamp: plate, inset seal ring, a tilted ghost plate, the diamond mark (ADR 0029).
 *
 * The emblem is what makes a tile read at a glance. Its two states are the item's standing, drawn
 * rather than written: **done** inks the plate teal with a dark glyph and a solid ring; **not done**
 * leaves the plate recessed with a dashed ring, so a grid shows what is set up before a word is
 * read. One accent stroke — the diamond at the ring's foot — is the mark's countersign.
 *
 * `glyph` is a 24×24 path (or several, joined with `|`), stroked, never filled: the drawings stay
 * one family whatever draws them.
 */
export default function Emblem({
  glyph,
  done,
  size = 56,
  label,
}: {
  glyph: string;
  done: boolean;
  size?: number;
  /** For a screen reader; omit when the tile's own title already names the item. */
  label?: string;
}) {
  return (
    <svg
      className={`emblem${done ? " emblem--done" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <rect className="emblem__ghost" x="9" y="9" width="46" height="46" rx="12" transform="rotate(-8 32 32)" />
      <rect className="emblem__plate" x="8" y="8" width="48" height="48" rx="12" />
      <circle className="emblem__ring" cx="32" cy="32" r="19" />
      <g transform="translate(20 20)" className="emblem__glyph">
        {glyph.split("|").map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <path className="emblem__mark" d="M32 47.5l2.5 2.5-2.5 2.5-2.5-2.5z" />
    </svg>
  );
}

/** Glyphs for the services and facts the app draws, in one place so two surfaces never disagree. */
export const GLYPHS: Readonly<Record<string, string>> = {
  gmail: "M3 6h18v12H3z|M3 7l9 6 9-6",
  notion: "M5 3h11l3 3v15H5z|M9 16V9l6 7V9",
  exa: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z|M15.5 15.5L21 21",
  generic: "M4 12h16|M12 4v16",
};
