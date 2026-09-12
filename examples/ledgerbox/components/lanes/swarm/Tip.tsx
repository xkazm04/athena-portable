"use client";

/**
 * The hover read-out, portalled onto the direction's own root.
 *
 * IT MUST BE PORTALLED. `.ln-stack` carries a `perspective`, which makes it the
 * containing block for a `position: fixed` child — so the read-out rendered in
 * place landed three hundred pixels below the mark it described. It goes to
 * `.ln-root` and not to `document.body`, because the body is outside the
 * variant wrapper and every `--ln-*` token there resolves to nothing, which
 * drew the tip in black system text.
 *
 * One trap on the way: `.ln-root > *:not(a):not(b):not(c)` scores (0,4,0) and
 * quietly beat `.ln-tip`'s own `position: fixed`, dropping the read-out into
 * the grid as an implicit fifth row. The stylesheet excludes it by name now.
 */
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";

import { formatDate, formatMoney, formatMoneyShort } from "@/lib/format";
import { HEAT_LABEL, type LnLane, type LnMark } from "../model";

/** Roughly how tall the read-out gets. Below this much room it flips above. */
const TIP_H = 250;

export interface Hover {
  mark: LnMark;
  lane: LnLane;
  x: number;
  y: number;
  top: number;
}

export function Tip({ hover }: { hover: Hover }) {
  const host = document.querySelector<HTMLElement>(".ln-root");
  if (!host) return null;
  const above = hover.y > window.innerHeight - TIP_H;
  const x = Math.min(Math.max(hover.x, 170), window.innerWidth - 170);
  const style: CSSProperties = {
    left: x,
    top: above ? undefined : hover.y + 12,
    bottom: above ? window.innerHeight - hover.top + 12 : undefined,
  };
  const { mark } = hover;

  return createPortal(
    <div className="ln-tip" data-heat={mark.heat} style={style} role="tooltip">
      <span className="ln-tip-top">
        <span className="ln-tip-no">{mark.number}</span>
        <span className="ln-tip-money">
          {formatMoney(mark.balanceCents > 0 ? mark.balanceCents : mark.amountCents)}
        </span>
      </span>
      <span className="ln-tip-client">{mark.clientName}</span>
      <dl className="ln-tip-stats">
        <div>
          <dt>Due</dt>
          <dd>{formatDate(mark.dueAt)}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>{HEAT_LABEL[mark.heat]}</dd>
        </div>
        <div>
          <dt>Invoiced</dt>
          <dd>{formatMoneyShort(mark.amountCents)}</dd>
        </div>
        <div>
          <dt>{mark.daysOverdue > 0 ? "Days late" : "Area"}</dt>
          <dd>{mark.daysOverdue > 0 ? mark.daysOverdue : hover.lane.label}</dd>
        </div>
      </dl>
      <span className="ln-tip-status">{mark.status}</span>
    </div>,
    host,
  );
}
