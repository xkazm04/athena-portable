"use client";

/**
 * The card variants, and the strip that switches between them — `design/ui-pass-brief.md` §2.6.
 *
 * SCAFFOLDING. This file and the two variants beside it do not ship. §2.6 is explicit: when a
 * direction wins, the losers, this map, the switcher and the state in `Carousel.tsx` are deleted
 * in the same commit that renames the winner to `Slide.tsx`. A variant switcher left in the tree
 * is a second direction nobody is maintaining, which is the failure `design/` already holds four
 * reviewed-out briefs' worth of.
 *
 * Every variant takes `CardProps` and nothing else, so the deck — `pose.ts`, the keyboard
 * handling, the dots, and the `layoutId` that carries a candidate through all three levels —
 * never learns which one is mounted.
 */
import type { BdCandidate, BdColumn } from "../model";
import { Slide } from "./Slide";
import { SlideStrip } from "./SlideStrip";
import { SlideLedger } from "./SlideLedger";

export interface CardProps {
  candidate: BdCandidate;
  column: BdColumn;
  /** Distance from the loupe, in cards. `pose.ts` turns it into a position. */
  offset: number;
  /**
   * Per-criterion median among the SCORED candidates in this column.
   *
   * Computed once per column by `Carousel.tsx` rather than once per card, and passed to every
   * variant even though only the ledger reads it — one props shape is what lets the deck stay
   * ignorant of which variant is mounted. Empty when nobody in the column has been scored, which
   * the ledger has to render honestly rather than as a row of zeroes.
   */
  medians: Map<string, number>;
  onFocus: () => void;
  onOpen: () => void;
}

export const CARD_VARIANTS = [
  {
    slug: "card",
    label: "The card",
    note: "what ships today — five criteria, rubric order, label over bar",
    Component: Slide,
  },
  {
    slug: "strip",
    label: "The strip",
    note: "the five as one signal, labels printed once under the rail",
    Component: SlideStrip,
  },
  {
    slug: "ledger",
    label: "The ledger",
    note: "the five ordered by how far they sit from the rest of this column",
    Component: SlideLedger,
  },
] as const;

export type CardSlug = (typeof CARD_VARIANTS)[number]["slug"];

/**
 * Per-criterion median among the scored candidates in a column.
 *
 * The median rather than the mean, and that is the honest choice in a column of ten where one
 * person was read generously: a mean lets a single outlier move everybody else's delta, and the
 * ledger's whole claim is that the number beside a criterion says something about THIS candidate.
 *
 * The unscored are excluded from the population rather than counted as zero — the same rule
 * `dossier/Bench.tsx` defends when it sorts them last. An absent measurement is not a low one, and
 * it must not be allowed to drag the middle of the field down.
 */
export function criterionMedians(candidates: BdCandidate[]): Map<string, number> {
  const buckets = new Map<string, number[]>();
  for (const candidate of candidates) {
    if (!candidate.scored) continue;
    for (const score of candidate.scores) {
      const bucket = buckets.get(score.criterionId);
      if (bucket) bucket.push(score.score);
      else buckets.set(score.criterionId, [score.score]);
    }
  }
  const out = new Map<string, number>();
  for (const [id, values] of buckets) {
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    out.set(
      id,
      values.length % 2 === 0 ? ((values[mid - 1] ?? 0) + (values[mid] ?? 0)) / 2 : (values[mid] ?? 0),
    );
  }
  return out;
}

/** The switcher. Scaffolding, and labelled as such on the surface so nobody mistakes it for chrome. */
export function CardSwitcher({
  value,
  onChange,
}: {
  value: CardSlug;
  onChange: (next: CardSlug) => void;
}) {
  return (
    <div className="bd-proto" role="tablist" aria-label="Card design, while this is being chosen">
      <span className="bd-block-label">Card design</span>
      {CARD_VARIANTS.map((variant) => (
        <button
          key={variant.slug}
          type="button"
          role="tab"
          className="bd-proto-tab"
          aria-selected={value === variant.slug}
          title={variant.note}
          onClick={() => onChange(variant.slug)}
        >
          {variant.label}
        </button>
      ))}
    </div>
  );
}
