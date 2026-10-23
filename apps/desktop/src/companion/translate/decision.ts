/**
 * A waiting decision in plain words: what will happen, to whom, and whether it can be taken back
 * (the contest's `describeDecision`). The card still carries every parameter; this is the sentence
 * above them, composed from the action's verb and what the turn has already shown.
 */
import { tidyContact, type Fact, type TurnContext } from "./payload";
import { DESTRUCTIVE, DIRECT, OUTBOUND, READ_VERBS, article, brand, cap, money, parseTool, tidyId } from "./words";

export interface DecisionWords {
  /** "Send a reminder for INV-118 to Northwind Traders". */
  title: string;
  /** "Northwind Traders will receive “INV-118 is 41 days past due”. Once it is sent it cannot be taken back." */
  effect: string;
  risk: "outbound" | "destructive" | "read" | "change";
  facts: Fact[];
  /** The message that will go out, when the turn drafted one or the card carries it. */
  letter: { to: string; subject: string; body: string; cut: boolean } | null;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * `from` is the account a connector card acts as (ADR 0116), "" otherwise. Pure: the card's action
 * and parameters, and the turn's context, in; the words out.
 */
export function describeDecision(
  card: { action: string; params: Readonly<Record<string, unknown>> },
  ctx: TurnContext,
  from = "",
): DecisionWords {
  const t = parseTool(card.action);
  const p = card.params;
  const id = text(p.id);
  const target = id ? tidyId(id) : "";
  const entity = id ? ctx.byId[id] : undefined;
  const email = text(p.to);
  const person = email ? ctx.byEmail[email] : undefined;
  const whom = person ? person.who : email;
  const risk = OUTBOUND.has(t.verb) ? "outbound" : DESTRUCTIVE.has(t.verb) ? "destructive" : READ_VERBS.has(t.verb) ? "read" : "change";
  const obj = t.object;
  const noun = obj
    ? DIRECT.has(t.verb)
      ? obj + (target ? " " + target : "")
      : `${article(obj)} ${obj}${target ? " for " + target : ""}`
    : target;
  const draft = email ? ctx.drafts[email] : undefined;
  const subject = text(p.subject) || text(draft?.subject);
  const body = text(p.body) || text(draft?.body);
  const app = brand(t.app);

  let effect: string;
  if (risk === "outbound") {
    effect = `${whom || "The recipient"} will receive ${subject ? `“${subject}”` : "it"}${from ? " from " + from : ""}. Once it is sent it cannot be taken back.`;
  } else if (risk === "destructive") {
    effect = `${cap(target || obj || "it")} is changed for good in ${app}. It cannot be undone.`;
  } else {
    effect = `${cap(obj || "it")}${target ? " " + target : ""} is changed in ${app}.`;
  }

  const facts: Fact[] = [];
  if (whom) facts.push({ k: "To", v: person?.contact ? `${person.who} · ${person.contact}` : whom });
  if (email && whom !== email) facts.push({ k: "Address", v: email });
  if (from) facts.push({ k: "Sent from", v: `${from} (${app})` });
  if (subject) facts.push({ k: "Subject", v: subject });
  if (target && !whom) facts.push({ k: "What", v: target });
  const amount = entity?.amount;
  const balance = entity?.balance;
  if (typeof amount === "number" && risk !== "outbound") facts.push({ k: "Amount", v: money(amount) });
  if (typeof balance === "number" && risk === "outbound") facts.push({ k: "Still owed", v: money(balance) });

  return {
    title: `${cap(t.verb)} ${noun}${whom ? " to " + whom : ""}`.replace(/\s+/g, " ").trim(),
    effect,
    risk,
    facts,
    letter: body ? { to: tidyContact(email, ctx), subject, body, cut: /\.\.\.\s*$/.test(body) } : null,
  };
}
