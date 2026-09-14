"use client";

/**
 * The standing of one invoice, as a mark in the corner of its card.
 *
 * The key comes from `model/status.ts`, which is pure and tested; this file is
 * only the lookup from a key to a drawn shape, and it is deliberately the whole
 * of the icon inventory for the direction. Nine keys, nine icons, no second
 * spelling anywhere.
 *
 * It inherits `--tone` from the card's own `data-heat`, so the glyph and the
 * card's top rule are the same colour by construction rather than by a second
 * table agreeing with the first.
 */
import {
  Ban,
  CircleCheck,
  CirclePercent,
  CircleQuestionMark,
  Clock,
  FilePen,
  HandCoins,
  Hourglass,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { STATUS_LABEL, type StatusKey } from "../model";

const ICON: Record<StatusKey, LucideIcon> = {
  disputed: CircleQuestionMark,
  void: Ban,
  draft: FilePen,
  settled: CircleCheck,
  "long-overdue": TriangleAlert,
  credit: HandCoins,
  late: Clock,
  "part-paid": CirclePercent,
  "within-terms": Hourglass,
};

export function StatusGlyph({ status }: { status: StatusKey }) {
  const Icon = ICON[status];
  return (
    <span className="ln-glyph" data-status={status}>
      {/* Sized in `em` so the glyph scales with the card's own type rather than
          with a second number. NOT `absoluteStrokeWidth`: lucide computes that
          as `strokeWidth * 24 / Number(size)`, and `Number("1em")` is NaN — the
          browser then drops the attribute and React warns on every one of the
          forty cards in a lane. */}
      <Icon size="1em" strokeWidth={1.75} aria-hidden />
      <span className="ln-glyph-say">{STATUS_LABEL[status]}</span>
    </span>
  );
}
