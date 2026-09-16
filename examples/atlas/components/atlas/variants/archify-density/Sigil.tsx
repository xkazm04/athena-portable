/**
 * THE SEMANTIC SIGIL — an 11-unit stroked mark at (6, 6), one per kind. Archify study §2.
 *
 * Archify's node anatomy has NO TITLE BAR: what tells a reader what kind of box they are looking at
 * is a small stroked glyph in the corner, in the kind's own colour, and the fill does the rest.
 * Seven glyphs, one per member of the closed enum, and no eighth — a decorative icon would be a
 * second visual channel saying nothing.
 *
 * The paths are the baseline variant's, copied for the reason `kinds.ts` explains: two drawings of
 * one repository may not disagree about what a database looks like, and the contract forbids
 * reaching across. `vector-effect: non-scaling-stroke` keeps the mark's weight at every distance.
 */
import type { Kind } from "./kinds";

const PATHS: Record<Kind, string> = {
  /* a screen on a stand */
  frontend: "M1.5 2h9v6h-9z M4.5 10.5h3 M6 8v2.5",
  /* a bus: three lines and a spine */
  messagebus: "M1.5 3h9 M1.5 6h9 M1.5 9h9 M3.5 3v6 M8.5 3v6",
  /* chevrons — code that runs */
  backend: "M4.5 3L1.5 6l3 3 M7.5 3l3 3-3 3",
  /* a shield */
  security: "M6 1.5l4 1.5v3.2c0 2.3-1.7 3.7-4 4.3-2.3-.6-4-2-4-4.3V3z",
  /* a cylinder */
  database:
    "M2 3c0-.9 1.8-1.5 4-1.5S10 2.1 10 3v6c0 .9-1.8 1.5-4 1.5S2 9.9 2 9z M2 3c0 .9 1.8 1.5 4 1.5S10 3.9 10 3",
  /* a cloud */
  cloud: "M3.3 9.5a2.3 2.3 0 010-4.6 3.2 3.2 0 016.2-.6 2.6 2.6 0 01-.5 5.2z",
  /* a box with an arrow leaving it */
  external: "M6.5 2.5h-5v8h8v-5 M7 6l3.5-3.5 M7.8 2.2h2.9v2.9",
};

export function Sigil({ kind }: { kind: Kind }) {
  return (
    <svg className="ad-sigil" viewBox="0 0 12 12" aria-hidden focusable="false">
      <path d={PATHS[kind]} />
    </svg>
  );
}
