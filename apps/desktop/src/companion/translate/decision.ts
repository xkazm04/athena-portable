/**
 * A waiting decision in plain words: what will happen, to whom, and whether it can be taken back
 * (the contest's `describeDecision`). The card still carries every parameter; this is the sentence
 * above them, composed from the action's verb and what the turn has already shown.
 *
 * Whether it can be taken back is the tool's declared flags (ADR 0189), the same ones the gate
 * classifies by; the verb only chooses the sentence's shape. A tool that declared nothing reads as
 * the severe bucket and says so, so an unknown never shares a spelling with a mild change.
 *
 * What the turn already read about the card's target rides with it as `standing` (ADR 0199): the
 * record's notes and ages in the existing vocabulary, and which step read it at what clock.
 */
import { tidyContact, type Fact, type TurnContext } from "./payload";
import { AGE_KEY, DIRECT, NOTE_KEY, OUTBOUND, appSuffix, article, brand, cap, clock, humanKey, money, objectPhrase, parseTool, past, tidyId } from "./words";

/** What the turn read about a card's target before the card rose: the decider sees what she saw. */
export interface Standing {
  /** The record's NOTE_KEY fields: "dispute: Client says the second revision was out of scope." */
  notes: Fact[];
  /** The record's AGE_KEY fields, as the table formats them: "days overdue: 12 days". */
  facts: Fact[];
  /** `HH:MM` of the step that last read it, or "" when the entry carried no time. */
  readAt: string;
  /** That step in plain words: "Read the inbox in Ledgerbox". */
  readBy: string;
}

export interface DecisionWords {
  /** "Send a reminder for INV-118 to Northwind Traders". */
  title: string;
  /** "Northwind Traders will receive “INV-118 is 41 days past due”. Once it is sent it cannot be taken back." */
  effect: string;
  risk: "outbound" | "destructive" | "read" | "change";
  /** False when the tool's flags were missing or `reversible` was null: `risk` is then the severe default. */
  declared: boolean;
  facts: Fact[];
  /** The message that will go out, when the turn drafted one or the card carries it. */
  letter: { to: string; subject: string; body: string; cut: boolean } | null;
  /** What the turn already read about the target, or `null` when it never read it. */
  standing: Standing | null;
}

/** What the app declared about a tool (README section 3.3): the flags the gate's class comes from. */
export interface ToolFlags {
  reversible: boolean | null;
  side_effects: string;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const SIDE_EFFECTS: ReadonlySet<string> = new Set(["none", "internal", "external"]);

/** The bucket the flags put a tool in, or `null` when they do not say (ADR 0189). */
function riskOf(flags: ToolFlags | undefined): DecisionWords["risk"] | null {
  if (!flags || typeof flags.reversible !== "boolean" || !SIDE_EFFECTS.has(flags.side_effects)) return null;
  if (flags.side_effects === "external") return "outbound";
  if (!flags.reversible) return "destructive";
  return flags.side_effects === "none" ? "read" : "change";
}

/** The record the turn read under `id`, its notes, ages and provenance; `null` when it read none. */
function standingOf(id: string, ctx: TurnContext): Standing | null {
  const record = id ? ctx.byId[id] : undefined;
  if (!record) return null;
  const notes: Fact[] = [];
  const facts: Fact[] = [];
  for (const [k, v] of Object.entries(record)) {
    if (NOTE_KEY.test(k) && typeof v === "string" && v.trim()) notes.push({ k: humanKey(k), v });
    else if (AGE_KEY.test(k) && typeof v === "number") facts.push({ k: humanKey(k), v: v === 1 ? "1 day" : `${v} days` });
  }
  const seen = ctx.seen[id];
  const t = seen?.tool ? parseTool(seen.tool) : null;
  const readBy = t ? `${past(t.verb)} ${objectPhrase(t, true)}${appSuffix(t)}`.replace(/\s+/g, " ").trim() : "";
  return { notes, facts, readAt: clock(seen?.at), readBy };
}

/**
 * `from` is the account a connector card acts as (ADR 0116), "" otherwise. Pure: the card's action
 * and parameters, and the turn's context, in; the words out.
 */
export function describeDecision(
  card: { action: string; params: Readonly<Record<string, unknown>> },
  ctx: TurnContext,
  from = "",
  flags?: ToolFlags,
): DecisionWords {
  const t = parseTool(card.action);
  const p = card.params;
  const id = text(p.id);
  const target = id ? tidyId(id) : "";
  const entity = id ? ctx.byId[id] : undefined;
  const email = text(p.to);
  const person = email ? ctx.byEmail[email] : undefined;
  const whom = person ? person.who : email;
  const declaredRisk = riskOf(flags);
  // Undeclared: the severe bucket, an outbound shape for a sending verb, never the mild sentence.
  const risk = declaredRisk ?? (OUTBOUND.has(t.verb) ? "outbound" : "destructive");
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
  if (risk === "outbound" && (OUTBOUND.has(t.verb) || whom)) {
    effect = `${whom || "The recipient"} will receive ${subject ? `“${subject}”` : "it"}${from ? " from " + from : ""}. Once it is sent it cannot be taken back.`;
  } else if (risk === "outbound") {
    effect = `${cap(noun || "it")} goes out to ${app}${from ? " as " + from : ""}. Once it is done it cannot be taken back.`;
  } else if (risk === "destructive") {
    effect = `${cap(target || obj || "it")} is changed for good in ${app}. It cannot be undone.`;
  } else {
    effect = `${cap(obj || "it")}${target ? " " + target : ""} is changed in ${app}.`;
  }
  if (!declaredRisk) effect += " The app did not declare whether this can be undone, so the card assumes it cannot.";

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
    declared: declaredRisk !== null,
    facts,
    letter: body ? { to: tidyContact(email, ctx), subject, body, cut: /\.\.\.\s*$/.test(body) } : null,
    standing: standingOf(id, ctx),
  };
}
