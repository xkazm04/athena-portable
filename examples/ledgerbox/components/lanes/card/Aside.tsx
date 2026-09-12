"use client";

/**
 * The invoice's own facts, in a lean panel beside the card's body.
 *
 * ONLY THE ROWS THAT HAVE AN ANSWER. A settled invoice carries no detail
 * record, and six rows of em-dash is not a panel of facts — it is a form nobody
 * filled in. Issued, due and the count of reminders come off the mark itself
 * and are therefore always true; the rest arrive with the detail or not at all.
 */
import { formatFullDate } from "@/lib/format";
import type { LnDetail, LnMark } from "../model";

export function CardAside({
  mark,
  detail,
}: {
  mark: LnMark;
  detail: LnDetail | undefined;
}) {
  return (
        <aside className="ln-card-aside">
          <span className="ln-block-label">The invoice</span>
          <dl className="ln-meta">
            <div>
              <dt>Issued</dt>
              <dd>{formatFullDate(mark.issuedAt)}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>{formatFullDate(mark.dueAt)}</dd>
            </div>
            {detail ? (
              <div>
                <dt>Terms</dt>
                <dd>{detail.terms} days</dd>
              </div>
            ) : null}
            {detail?.contact ? (
              <div>
                <dt>Contact</dt>
                <dd>{detail.contact}</dd>
              </div>
            ) : null}
            {detail?.email ? (
              <div>
                <dt>Email</dt>
                <dd>{detail.email}</dd>
              </div>
            ) : null}
            <div>
              <dt>Reminders sent</dt>
              <dd>
                {mark.remindersSent === 0 ? "none" : mark.remindersSent}
                {mark.remindersSent === 0 && mark.daysOverdue > 0 ? (
                  <em className="ln-meta-aside">and {mark.daysOverdue} days late</em>
                ) : null}
              </dd>
            </div>
          </dl>
        </aside>
  );
}
