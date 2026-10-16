/**
 * Design 4.6.1 "chase": the reminder as an ADDRESSABLE message, not a paragraph.
 *
 * `send_reminder` is GATED and, in the demo, the send is carried by a Gmail connector outside the
 * page - so what the app hands over has to be a whole message. A body alone is not one. Every
 * draft therefore carries `to` (the client's registry contact, on their `.example` domain),
 * `to_name`, `from` (the studio's shared inbox) and a `subject`, and the same three fields are
 * stored on the `reminders` row so the send records who it reached rather than re-deriving it.
 *
 * One composer, two callers - `draftReminderAction` and the seed's already-sent reminders - so a
 * drafted letter and a filed one are the same document.
 */
import { STUDIO } from "@athena/demo-kit/seed";

import type { Tone } from "./constants";
import { formatMoney } from "./format";

/** The addressable half of a reminder. `body` is plain text; the connector wraps it. */
export interface ReminderDraft {
  to: string;
  to_name: string;
  from: string;
  subject: string;
  body: string;
}

export interface ComposeInput {
  number: string;
  clientName: string;
  contactName: string;
  contactEmail: string;
  tone: Tone;
  daysOverdue: number;
  balanceCents: number;
  amountCents: number;
}

/** `1 day`, `21 days`. */
function dayCount(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * The opening line, from the one fact the composer is given: how many days past due the invoice
 * is, which may be none - `draft_reminder` takes any invoice with a balance. The gentle line used
 * to say the invoice "went out N days ago" with N = days past DUE, a send date the books never
 * gave it (a 30-day-terms invoice issued 91 days ago "went out 70 days ago"), and both tones
 * floored the count at one, so an invoice inside terms was "1 days past its due date".
 */
const OPENING: Record<Tone, (n: string, d: number) => string> = {
  gentle: (n, d) =>
    d > 0
      ? `Hope the work has been landing well. ${n} is ${dayCount(d)} past its due date and still showing as open on our side - no rush if it is already in a payment run, just flagging it.`
      : `Hope the work has been landing well. ${n} is still showing as open on our side - no rush if it is already in a payment run, just flagging it ahead of the due date.`,
  firm: (n, d) =>
    d > 0
      ? `${n} is now ${dayCount(d)} past its due date. Please let us know today when payment will be made, or we will pause scheduled work until it clears.`
      : `${n} is still open on our side. Please let us know today when payment will be made.`,
};

/** First name only, the way a person opens a letter. */
function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

export function reminderSubject(input: Pick<ComposeInput, "number" | "balanceCents" | "daysOverdue">): string {
  const late = input.daysOverdue > 0 ? `, ${dayCount(input.daysOverdue)} past due` : "";
  return `${input.number}: ${formatMoney(input.balanceCents)} outstanding${late}`;
}

export function composeReminder(input: ComposeInput): ReminderDraft {
  const days = Math.max(input.daysOverdue, 0);
  return {
    to: input.contactEmail,
    to_name: input.contactName,
    from: STUDIO.inbox,
    subject: reminderSubject(input),
    body: [
      `Hi ${firstName(input.contactName)},`,
      "",
      OPENING[input.tone](input.number, days),
      "",
      `Outstanding: ${formatMoney(input.balanceCents)} of ${formatMoney(input.amountCents)}.`,
      "",
      "Thanks,",
      STUDIO.owner.name,
      STUDIO.name,
      STUDIO.inbox,
    ].join("\n"),
  };
}
