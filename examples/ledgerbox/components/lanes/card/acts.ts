/**
 * The card's acts as one machine: one armed gate, one write in flight, one door.
 *
 * WHAT THIS REPLACED. The L2 card ran its acts on states that could not see each other: the
 * card's own `useRun`, one more `useRun` inside every `Gate`, and one `armedOn` per `Gate`. A
 * person could arm Record and Void at once, and could confirm Send while a redraft they had just
 * pressed was still in flight - the idle and armed gates read only their own pending - so
 * `sendReminderAction`, which sends whatever draft is newest at the server, could send a letter
 * the person never saw (hitl-approval, gate-state-machines: approval binds to a version). A double
 * click on a confirm could land twice before `useTransition`'s pending repainted.
 *
 * THREE PARTS, all plain, so the node runner drives them (ADR 0155):
 *
 *   actSpecs     the decision list as data - each act's label, what it reaches, why the books
 *                would refuse it, whether its class gates it, its question, its subject and what
 *                it issues. The view maps only the per-act parameters (tone, file-under) to JSX.
 *   reduceActs   {armed, issuing, ticket, focus} under arm, disarm, close, take, confirm, observe,
 *                settle and focused. Nothing arms while something is in flight, nothing issues
 *                while something is in flight, and arming one act disarms any other.
 *   createActDoor  the one door every card write passes through - the five listed acts and
 *                Evidence's match and unmatch. It holds the state in a closure, updated
 *                SYNCHRONOUSLY, so a second press before the first one's render is refused
 *                (single-flight-primitives, refuse the second caller) rather than sent.
 *
 * WHERE FOCUS GOES is the machine's answer too: a cancelled or settled act hands focus back to
 * its own row, and a row that is now disabled cannot take it, so it goes to the list's heading.
 *
 * NOT CLOSED HERE: an agent's draft_reminder landing between the person's arm and confirm still
 * races at the server. `observe` closes the gate on the next render, but closing the window itself
 * needs the send to name the draft it was armed on (app/actions.ts).
 */
import type { Category, Tone } from "@/lib/constants";
import { creditNamed } from "@/lib/chase";
import { formatMoney } from "@/lib/format";
import { isAuto } from "@/lib/manifest";
import { TOOL_CLASSES } from "@/lib/tool-classes";
import type { ActionResult } from "@/lib/types";
import type { LnDetail, LnMark } from "../model";
import { actRefusal, gateSubject, stillArmed } from "./read";

/**
 * The acts on the decision list, in the order a bookkeeper would consider them. `match_bank_line`
 * stands in Draft's place on an invoice an unapplied credit settles: the books refuse that chase.
 */
export type ListTool = "draft_reminder" | "match_bank_line" | "categorize" | "mark_paid" | "send_reminder" | "void_invoice";
/** Every write the card can issue: the list's acts, plus Evidence's unapply. */
export type CardTool = ListTool | "unmatch";

/** What a listed act issues, as data. The view turns it into the server action call. */
export type ActIssue =
  | { tool: "draft_reminder"; ref: string; tone: Tone }
  | { tool: "match_bank_line"; ref: string; lineId: string }
  | { tool: "categorize"; ids: string[]; category: Category }
  | { tool: "mark_paid"; ref: string; amountCents: number }
  | { tool: "send_reminder"; ref: string; reminderId?: string }
  | { tool: "void_invoice"; ref: string };

/** One row of the decision list. */
export interface ActSpec {
  /** The tool's registered name; the badge's class and `gated` are read from it. */
  tool: ListTool;
  label: string;
  /** One line: what this act reaches - or, when the books would refuse it, why. */
  reaches: string;
  /** The words on the control that takes it. */
  takeLabel: string;
  /** Why it cannot be taken now, or null. A blocked row is disabled. */
  blocked: string | null;
  /** `!isAuto(TOOL_CLASSES[tool])`: the act arms before it issues. */
  gated: boolean;
  /** A gated act's second question; null for an AUTO act. */
  question: string | null;
  /** What an armed gate is armed on (`gateSubject`); null for an AUTO act. */
  subject: string | null;
  issue: ActIssue;
}

/**
 * The decision list for one invoice, as data. The consequence clauses are built from the books
 * (the contact's name and address, the balance to the cent), and every refusal is `actRefusal`'s,
 * so a row the list offers is a press the books take.
 */
export function actSpecs(
  mark: LnMark,
  detail: LnDetail | undefined,
  tone: Tone,
  category: Category,
): ActSpec[] {
  const to = detail?.contact ?? mark.clientName;
  const email = detail?.email;
  const draft = actRefusal("draft_reminder", mark, detail);
  const paid = actRefusal("mark_paid", mark, detail);
  const send = actRefusal("send_reminder", mark, detail);
  const voided = actRefusal("void_invoice", mark, detail);
  const filed = category === mark.category;
  // Exact, not `formatMoneyShort`: the short form rounds to whole units, which is wrong on the
  // one control that moves money.
  const balance = formatMoney(mark.balanceCents);

  // The card asks the chase: while the statement holds an unapplied credit that settles this
  // invoice, the books refuse a reminder (lib/chase.ts), so Draft is not offered - the act that
  // lifts the refusal is, through the same match the Evidence column issues.
  const credit = detail?.settling;
  const first: Omit<ActSpec, "gated" | "question" | "subject"> = credit
    ? {
        tool: "match_bank_line",
        label: "Apply the credit first",
        reaches: `${creditNamed(credit)}. Applies it to ${mark.number} - reversible, it writes an undo row. Chase only what remains.`,
        takeLabel: "Apply it",
        blocked: null,
        issue: { tool: "match_bank_line", ref: mark.id, lineId: credit.line_id },
      }
    : {
        tool: "draft_reminder",
        label: `Draft a ${tone} reminder`,
        reaches: draft ?? "Nobody. It writes a draft on this invoice and replaces any draft already there.",
        takeLabel: "Draft it",
        blocked: draft,
        issue: { tool: "draft_reminder", ref: mark.id, tone },
      };

  const rows: Omit<ActSpec, "gated" | "question" | "subject">[] = [
    first,
    {
      tool: "categorize",
      label: "Refile this invoice",
      reaches: "Moves it to another area of the books. Reversible: it writes an undo row.",
      takeLabel: "Refile",
      blocked: filed ? `Blocked: it is already filed under ${category}. Pick another area first.` : null,
      issue: { tool: "categorize", ids: [mark.id], category },
    },
    {
      tool: "mark_paid",
      label: `Record ${balance} received`,
      reaches: paid ?? `Writes ${balance} against the books. There is no undo row for this one.`,
      takeLabel: "Record it",
      blocked: paid,
      issue: { tool: "mark_paid", ref: mark.id, amountCents: mark.balanceCents },
    },
    {
      tool: "send_reminder",
      label: detail?.draft ? "Send the drafted reminder" : "Send a reminder",
      reaches:
        send ??
        (email
          ? `Reaches ${to} at ${email} by email. You cannot un-send it.`
          : `Reaches ${to} by email. You cannot un-send it.`),
      takeLabel: "Send it",
      blocked: send,
      // The draft the card drew: the server sends it only while it is still the letter on the
      // invoice, closing the race `observe` cannot (an agent's redraft between arm and confirm).
      issue: { tool: "send_reminder", ref: mark.id, ...(detail?.draft ? { reminderId: detail.draft.id } : {}) },
    },
    {
      tool: "void_invoice",
      label: "Void this invoice",
      // `voidInvoiceAction` refuses an invoice with payments applied, so the row says so before
      // the press; an armed void closes the moment a credit lands (`observe`).
      reaches: voided ?? "Writes the balance off permanently. There is no undo.",
      takeLabel: "Void it",
      blocked: voided,
      issue: { tool: "void_invoice", ref: mark.id },
    },
  ];

  const asked: Partial<Record<ListTool, string>> = {
    mark_paid: `This writes ${balance} against the books and cannot be replayed backwards.`,
    send_reminder: `This reaches ${email ?? "the client"}. You cannot un-send it.`,
    void_invoice: "Voiding writes off the balance. There is no undo.",
  };

  return rows.map((row) => {
    // The class table is the only place that decides what arms: a row cannot be gated or
    // ungated here, because there is nowhere to say so.
    const gated = !isAuto(TOOL_CLASSES[row.tool]);
    const subject =
      row.tool === "mark_paid" || row.tool === "send_reminder" || row.tool === "void_invoice"
        ? gateSubject(row.tool, mark, detail)
        : row.reaches;
    return {
      ...row,
      gated,
      question: gated ? (asked[row.tool] ?? row.reaches) : null,
      subject: gated ? subject : null,
    };
  });
}

/* ------------------------------------------------------------------------- the machine */

/** Where focus goes next: the list's heading, or the take control of one row. */
export type FocusTarget = "heading" | `row:${CardTool}`;

export interface ActState {
  /** The one armed gate, and the subject it was armed on. */
  armed: { tool: CardTool; subject: string } | null;
  /** The one write in flight, and the ticket its answer must carry to be heard. */
  issuing: { tool: CardTool; ticket: number } | null;
  /** The last ticket handed out. */
  ticket: number;
  /** Where focus should go on the next commit, or null when it stays put. */
  focus: FocusTarget | null;
}

export const IDLE_ACTS: ActState = { armed: null, issuing: null, ticket: 0, focus: null };

/** Said when a second act is asked for while one is still in flight. */
export const IN_FLIGHT = "An act on this invoice is still in flight.";
/** Said when a confirm is pressed for an act that is not the armed one. */
export const NOT_ARMED = "That act is not armed.";

export type ActEvent =
  | { type: "arm"; tool: CardTool; subject: string }
  | { type: "disarm" }
  | { type: "close" }
  | { type: "take"; tool: CardTool }
  | { type: "confirm"; tool: CardTool }
  | { type: "observe"; specs: readonly ActSpec[] }
  | { type: "settle"; ticket: number; result: ActionResult | null }
  | { type: "focused" };

/** One step: the next state (the same object when nothing moved), and why, if it was refused. */
export interface ActStep {
  state: ActState;
  refused: string | null;
}

const LIST_TOOLS: ReadonlySet<CardTool> = new Set<CardTool>([
  "draft_reminder",
  "match_bank_line",
  "categorize",
  "mark_paid",
  "send_reminder",
  "void_invoice",
]);

/** A row's focus target, or null for a write with no row on the list (Evidence's). */
const rowOf = (tool: CardTool): FocusTarget | null => (LIST_TOOLS.has(tool) ? `row:${tool}` : null);

const ok = (state: ActState): ActStep => ({ state, refused: null });
const no = (state: ActState, refused: string): ActStep => ({ state, refused });

export function reduceActs(state: ActState, event: ActEvent): ActStep {
  switch (event.type) {
    case "arm":
      // A yes asked while another write is in flight would be a yes to a card that is about to
      // change under it - the send over an unsettled redraft.
      if (state.issuing) return no(state, IN_FLIGHT);
      // One armed gate: arming this one disarms any other.
      return ok({ ...state, armed: { tool: event.tool, subject: event.subject }, focus: null });
    case "disarm":
      if (!state.armed || state.issuing) return ok(state);
      return ok({ ...state, armed: null, focus: rowOf(state.armed.tool) });
    case "close":
      // The list left: nothing stays armed for its next opening, and nothing waits to take focus.
      if (!state.armed && !state.focus) return ok(state);
      return ok({ ...state, armed: state.issuing ? state.armed : null, focus: null });
    case "take": {
      if (state.issuing) return no(state, IN_FLIGHT);
      const ticket = state.ticket + 1;
      // An AUTO act taken while a gate is armed is the person choosing another act.
      return ok({ armed: null, issuing: { tool: event.tool, ticket }, ticket, focus: null });
    }
    case "confirm": {
      if (state.issuing) return no(state, IN_FLIGHT);
      if (state.armed?.tool !== event.tool) return no(state, NOT_ARMED);
      const ticket = state.ticket + 1;
      // The gate stays armed while its own confirm is in flight, so it reads "Working".
      return ok({ ...state, issuing: { tool: event.tool, ticket }, ticket, focus: null });
    }
    case "observe": {
      let { armed, focus } = state;
      const inFlight = armed !== null && state.issuing?.tool === armed.tool;
      if (armed && !inFlight) {
        const spec = event.specs.find((s) => s.tool === armed!.tool);
        const disabled = !spec || spec.blocked !== null;
        // What the gate showed has moved (a redraft, a credit), or its act is now refused.
        if (!stillArmed(armed.subject, spec?.subject ?? "", disabled)) {
          focus = disabled ? "heading" : rowOf(armed.tool);
          armed = null;
        }
      }
      // A row that turned disabled under a pending focus cannot take it, nor can one that left the
      // list (an applied credit's row, replaced by Draft).
      if (focus && focus !== "heading") {
        const tool = focus.slice("row:".length);
        const row = event.specs.find((s) => s.tool === tool);
        if (!row || row.blocked) focus = "heading";
      }
      if (armed === state.armed && focus === state.focus) return ok(state);
      return ok({ ...state, armed, focus });
    }
    case "settle":
      // A late answer for a write that is no longer the one in flight is not this card's news.
      if (!state.issuing || state.issuing.ticket !== event.ticket) return ok(state);
      // Answered or thrown, the gate over it closes and is armed again only by a person who has
      // looked: the books may have moved either way.
      return ok({ ...state, armed: null, issuing: null, focus: rowOf(state.issuing.tool) });
    case "focused":
      return state.focus === null ? ok(state) : ok({ ...state, focus: null });
  }
}

/* ---------------------------------------------------------------------------- the door */

/** Runs one write and hands its answer, or null when it threw, to `after`. `useRun` is one. */
export type ActTransport = (
  issue: () => Promise<ActionResult>,
  after: (result: ActionResult | null) => void,
) => void;

export interface ActDoor {
  /** The state as the door holds it now, ahead of any render. */
  current(): ActState;
  arm(tool: CardTool, subject: string): string | null;
  disarm(): void;
  close(): void;
  /** Issue an AUTO act. Returns why it was refused, or null when it went. */
  take(tool: CardTool, issue: () => Promise<ActionResult>): string | null;
  /** Issue the armed act. Returns why it was refused, or null when it went. */
  confirm(tool: CardTool, issue: () => Promise<ActionResult>): string | null;
  observe(specs: readonly ActSpec[]): void;
  focused(): void;
  /** Swap the transport for the next write (a view whose `run` was re-made). */
  setTransport(next: ActTransport): void;
}

/**
 * The one door. `publish` is how the view learns the state (a `setState`); `transport` runs the
 * write. The state lives HERE and moves before `publish` is called, so two presses in one tick
 * see each other, which a state read back from a render cannot do.
 */
export function createActDoor({
  publish,
  transport,
  initial = IDLE_ACTS,
}: {
  publish: (state: ActState) => void;
  transport: ActTransport;
  initial?: ActState;
}): ActDoor {
  let state = initial;
  let via = transport;
  const step = (event: ActEvent): ActStep => {
    const next = reduceActs(state, event);
    if (next.state !== state) {
      state = next.state;
      publish(state);
    }
    return next;
  };
  const issue = (event: ActEvent & { type: "take" | "confirm" }, run: () => Promise<ActionResult>) => {
    const next = step(event);
    if (next.refused) return next.refused;
    const ticket = state.ticket;
    via(run, (result) => step({ type: "settle", ticket, result }));
    return null;
  };
  return {
    current: () => state,
    arm: (tool, subject) => step({ type: "arm", tool, subject }).refused,
    disarm: () => void step({ type: "disarm" }),
    close: () => void step({ type: "close" }),
    take: (tool, run) => issue({ type: "take", tool }, run),
    confirm: (tool, run) => issue({ type: "confirm", tool }, run),
    observe: (specs) => void step({ type: "observe", specs }),
    focused: () => void step({ type: "focused" }),
    setTransport: (next) => {
      via = next;
    },
  };
}
