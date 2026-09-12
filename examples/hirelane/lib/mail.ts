/**
 * The two messages that leave the building, composed in full (design 4.6.2; README section 4).
 *
 * In the demo the send is carried by a Gmail connector OUTSIDE the page: the app's gated tool
 * returns the message and a tier-3 executor puts it in a mailbox. A connector cannot address an
 * envelope from `Interview time` and a candidate id, so the result of a gated send here is a
 * complete, addressable message — `to`, `subject`, `body` — and the row written to `messages` is
 * the same three fields. Nothing is assembled twice and nothing is assembled later.
 *
 * Everything is signed by the one studio these three apps belong to, so a message read in
 * Hirelane and a chase read in Ledgerbox come from the same person at the same address.
 */
import { STUDIO } from "@athena/demo-kit/seed";

import { type RejectionTemplate } from "./constants";

/** A complete message: everything a mail connector needs and nothing it has to guess. */
export interface Mail {
  to: string;
  subject: string;
  body: string;
}

/** The studio's own sign-off, on every message this app produces. */
function signature(): string {
  return `${STUDIO.owner.name}\n${STUDIO.owner.title}, ${STUDIO.name}\n${STUDIO.inbox}`;
}

export function schedulingMail(args: {
  applicantName: string;
  applicantEmail: string;
  roleTitle: string;
  interviewer: string;
  /** ISO start of the slot. */
  startTs: string;
  minutes: number;
}): Mail {
  const when = `${args.startTs.replace("T", " ").slice(0, 16)} UTC`;
  return {
    to: args.applicantEmail,
    subject: `Interview for ${args.roleTitle} — ${when}`,
    body: [
      `Hi ${args.applicantName.split(" ")[0] ?? args.applicantName},`,
      "",
      `Thank you for applying for the ${args.roleTitle} role at ${STUDIO.name}. We would like to talk to you.`,
      "",
      `I have held ${when} for you, ${args.minutes} minutes with ${args.interviewer}. Reply to this message if that time does not work and we will find another.`,
      "",
      signature(),
    ].join("\n"),
  };
}

/**
 * Three wordings, and the wording is an enum because it reaches a person.
 *
 * The template names the tone; the letter is written out here rather than in the action, so the
 * body a test reads is the body a mailbox gets.
 */
const REJECTION_BODY: Record<RejectionTemplate, (first: string, role: string) => string> = {
  standard: (first, role) =>
    [
      `Hi ${first},`,
      "",
      `Thank you for applying for the ${role} role at ${STUDIO.name}. We have read your application carefully and we are not taking it forward.`,
      "",
      "We appreciate the time you put into it, and we wish you well.",
    ].join("\n"),
  encouraging: (first, role) =>
    [
      `Hi ${first},`,
      "",
      `Thank you for applying for the ${role} role at ${STUDIO.name}. There was a lot to like in your application, and the decision was not an easy one — but we are not taking it forward this time.`,
      "",
      "Please do not read this as a verdict on your work. It is a decision about one role, on one week.",
    ].join("\n"),
  keep_in_touch: (first, role) =>
    [
      `Hi ${first},`,
      "",
      `Thank you for applying for the ${role} role at ${STUDIO.name}. We are not taking this application forward, but we would genuinely like to hear from you again.`,
      "",
      "We open roles a few times a year. If you see one that fits, please apply and say that we spoke.",
    ].join("\n"),
};

export function rejectionMail(args: {
  applicantName: string;
  applicantEmail: string;
  roleTitle: string;
  template: RejectionTemplate;
}): Mail {
  const first = args.applicantName.split(" ")[0] ?? args.applicantName;
  return {
    to: args.applicantEmail,
    subject: `Your application for ${args.roleTitle} at ${STUDIO.name}`,
    body: `${REJECTION_BODY[args.template](first, args.roleTitle)}\n\n${signature()}`,
  };
}
