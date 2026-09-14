"use client";

/**
 * "Decide next step" — every act available on this invoice, in one place, with
 * what each one reaches.
 *
 * WHAT THIS REPLACED. Two bands at the foot of the card, one tagged AUTO and one
 * tagged GATED, each a row of buttons with two bare `<select>`s wedged among
 * them. The review's words were "footer bars Auto/Gated have terrible UX, not
 * clear what belongs to what", and the diagnosis is in the layout: the tone
 * picker sat beside "Draft a gentle reminder" and also beside "Refile", the file-
 * under picker sat beside "Refile" and also beside "Record $95,100 received", and
 * nothing on the surface said which parameter belonged to which verb. A row of
 * peers cannot express "this control is an argument to that one". A LIST OF ACTS
 * can, and that is the whole shape here: one row per act, its class, what it
 * reaches, its own parameters inside its own row, and its own confirm at the end
 * of it.
 *
 * THE CLASSES DID NOT MOVE AND NEITHER DID THE GATE. `lib/tool-classes.ts` is
 * still the only place that decides what is AUTO and what is GATED, the badge on
 * each row reads it, and the three gated acts still arm through `Gate` before
 * they issue. This file changed where the acts are drawn and nothing about what
 * they are.
 *
 * THE CONVERSATION SLOT IS EMPTY AND SAYS SO. This is where Athena's proposal
 * and the user's reply will live. She is not connected to this app — no bridge,
 * no chat, no provider — so the slot renders that fact in the present tense of
 * registration rather than a disabled text box implying a feature that is
 * coming. `design/pass3-law-brief.md` §4.1 forbids any sentence in which Athena
 * has done, is doing, or will shortly do something; "the options below are yours
 * to take" is what is true.
 *
 * IT OWNS ESCAPE AND HANDS FOCUS BACK (round-1 rule 5). It is a dialog inside a
 * dialog: one press closes this and leaves the card open, which needs
 * `stopPropagation` — the card's own handler is a React ancestor of this one
 * even though the DOM node is portalled to the body — and `preventDefault`,
 * which is what the kit's window listener checks first.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { useOverlayEscape } from "@athena/demo-kit/zoom";

import {
  categorizeAction,
  draftReminderAction,
  markPaidAction,
  sendReminderAction,
  voidInvoiceAction,
} from "@/app/actions";
import { CATEGORIES, TONES, type Category, type Tone } from "@/lib/constants";
import { formatMoney } from "@/lib/format";
import { isAuto } from "@/lib/manifest";
import { TOOL_CLASSES, type ToolName } from "@/lib/tool-classes";
import { Gate } from "../Gate";
import type { LnDetail, LnMark } from "../model";
import { fade, instant } from "../motion";
import type { useRun } from "../useRun";

type Run = ReturnType<typeof useRun>;

/** One row of the list: a named capability, what it reaches, and how to take it. */
interface Act {
  /** The tool's real name, as registered. The badge's class is read from it —
   *  the row cannot claim a class the manifest does not give it, because there
   *  is nowhere to type one. */
  tool: ToolName;
  label: string;
  /** One line: what this act reaches, and whether it can be taken back. */
  reaches: string;
  /** The parameters this act needs, drawn inside its own row. */
  params?: ReactNode;
  /** The control that takes it — a plain button for AUTO, a `Gate` for GATED. */
  take: ReactNode;
  disabled?: boolean;
}

export function Decide({
  mark,
  detail,
  owed,
  tone,
  setTone,
  category,
  setCategory,
  pending,
  run,
  onClose,
}: {
  mark: LnMark;
  detail: LnDetail | undefined;
  owed: boolean;
  tone: Tone;
  setTone: (next: Tone) => void;
  category: Category;
  setCategory: (next: Category) => void;
  pending: Run["pending"];
  run: Run["run"];
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const paneRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  /**
   * WHY IT IS PORTALLED, AND WHY NOT TO THE BODY.
   *
   * Portalled because the card it opens from is `overflow: hidden` and carries
   * two transforms — motion's layout projection and the pointer lean — and a
   * transformed ancestor becomes the containing block for `position: fixed`, so
   * a dialog rendered in place would be both clipped and positioned against the
   * card rather than the viewport.
   *
   * NOT to `document.body`, which is where this went first and where it lost
   * every token it has. `--ln-*` is declared on `[data-variant="lanes"]`; a
   * portal to the body is outside that subtree, so `padding`, `background`,
   * `gap` and `border-radius` all resolved to nothing while the declarations
   * with no `var()` in them — the width, the grid — applied normally. The result
   * was a correctly laid-out dialog with no surface under it, and it looked like
   * a stylesheet that had not loaded. `.ln-root` is the nearest ancestor that is
   * both outside the card and inside the tokens.
   */
  const [host] = useState<HTMLElement | null>(() =>
    typeof document === "undefined"
      ? null
      : document.querySelector<HTMLElement>(".ln-root") ?? document.body,
  );

  /**
   * ESCAPE AND THE WAY BACK, from the kit — and this is the nesting case.
   *
   * ONE PRESS LEAVES ONE THING, and it needs no `stopPropagation` now. A portal
   * still propagates React events to its React parent, so the card's handler
   * does see this Escape — but the card is on the same hook, and
   * `escapeClosesOverlay` declines any event whose default is already prevented.
   * The inner overlay speaks first because React bubbles from the target
   * outwards; the outer one then correctly stands down. The composition is the
   * kit's, not a local suppression.
   *
   * THE OPENER IS FOUND, NOT PASSED. The hook records whatever held focus when
   * this dialog mounted, which is the CTA the reader just pressed — so the
   * `requestAnimationFrame(() => ctaRef.current?.focus())` that used to live in
   * `card/Foot.tsx` is gone, and with it the question of what happens when the
   * dialog is closed by something that is not the button. `returnFocusTo` is
   * the net for the case where nothing had focus at all (an agent opened it),
   * and it looks the CTA up at unmount rather than holding a ref across it.
   */
  const overlay = useOverlayEscape({
    onClose,
    returnFocusTo: () => document.querySelector<HTMLElement>(".ln-decide-cta"),
  });

  /*
   * Focus lands on the dialog's own heading rather than on its first control:
   * the list is the point and the first act is `mark_paid`, which writes money.
   * The card does the same thing for the same reason — a place you are reading
   * should not open with your hands on the loudest control in it.
   *
   * AFTER the hook, deliberately: effects run in declaration order, and the
   * hook's has to read `document.activeElement` while it is still the opener.
   */
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    overlay.onKeyDown(event);
    if (event.key !== "Tab") return;
    event.stopPropagation();
    const focusable = paneRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const to = detail?.contact ?? mark.clientName;
  const email = detail?.email;

  /*
   * THE LIST. Every act the card could take, in the order a bookkeeper would
   * consider them: ask first, then file, then the three that cannot be undone.
   * The consequence clause is built from the books — the contact's real name and
   * address, the exact balance to the cent — because "reaches a person" is a
   * claim, and a claim about who should name them.
   */
  const acts: Act[] = [
    {
      tool: "draft_reminder",
      label: `Draft a ${tone} reminder`,
      reaches: "Nobody. It writes a draft on this invoice and replaces any draft already there.",
      params: (
        <label className="ln-field-select">
          <span className="ln-field-label">Tone</span>
          <select value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
            {TONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      ),
      take: (
        <button
          type="button"
          className="ln-btn"
          disabled={pending}
          onClick={() => run(() => draftReminderAction(mark.id, tone))}
        >
          Draft it
        </button>
      ),
    },
    {
      tool: "categorize",
      label: "Refile this invoice",
      reaches: "Moves it to another area of the books. Reversible: it writes an undo row.",
      params: (
        <label className="ln-field-select">
          <span className="ln-field-label">File under</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      ),
      take: (
        <button
          type="button"
          className="ln-btn"
          disabled={pending || category === mark.category}
          onClick={() => run(() => categorizeAction([mark.id], category))}
        >
          Refile
        </button>
      ),
      disabled: category === mark.category,
    },
    {
      tool: "mark_paid",
      // Exact, not `formatMoneyShort`: the short formatter rounds to whole
      // units, which is right for a headline figure and wrong on the one control
      // that moves money.
      label: `Record ${formatMoney(mark.balanceCents)} received`,
      reaches: `Writes ${formatMoney(mark.balanceCents)} against the books. There is no undo row for this one.`,
      take: (
        <Gate
          label="Record it"
          confirmLabel="Record it"
          question={`This writes ${formatMoney(mark.balanceCents)} against the books and cannot be replayed backwards.`}
          onConfirm={() => markPaidAction(mark.id, mark.balanceCents)}
          disabled={!owed}
        />
      ),
      disabled: !owed,
    },
    {
      tool: "send_reminder",
      label: detail?.draft ? "Send the drafted reminder" : "Send a reminder",
      reaches: email
        ? `Reaches ${to} at ${email} by email. You cannot un-send it.`
        : `Reaches ${to} by email. You cannot un-send it.`,
      take: (
        <Gate
          label="Send it"
          confirmLabel="Send it"
          question={`This reaches ${email ?? "the client"}. You cannot un-send it.`}
          onConfirm={() => sendReminderAction(mark.id)}
          disabled={!detail?.draft}
        />
      ),
      disabled: !detail?.draft,
    },
    {
      tool: "void_invoice",
      label: "Void this invoice",
      /* `voidInvoiceAction` refuses any invoice with payments applied, so the row
         has to say so before it is pressed rather than after. `mark_paid`
         through the tool layer hits the same guard. */
      reaches:
        mark.paidCents > 0
          ? "Blocked: there are credits applied to this invoice. Unapply them first."
          : "Writes the balance off permanently. There is no undo.",
      take: (
        <Gate
          label="Void it"
          confirmLabel="Void it"
          question={
            mark.paidCents > 0
              ? "Unapply the credits on this invoice first."
              : "Voiding writes off the balance. There is no undo."
          }
          onConfirm={() => voidInvoiceAction(mark.id)}
          disabled={mark.paidCents > 0}
        />
      ),
      disabled: mark.paidCents > 0,
    },
  ];

  if (!host) return null;

  return createPortal(
    <div
      className="ln-decide-layer"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        className="ln-decide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ln-decide-title"
        ref={paneRef}
        onKeyDown={onKeyDown}
        initial={reduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? instant : fade()}
      >
        <div className="ln-decide-head">
          <h3 className="ln-decide-title" id="ln-decide-title" ref={headingRef} tabIndex={-1}>
            Decide next step
          </h3>
          <p className="ln-decide-sub">
            {mark.number} · {mark.clientName} · {mark.status}
          </p>
          <button
            type="button"
            className="ln-close"
            onClick={onClose}
            aria-label="Close the decision list and return to the invoice"
          >
            ✕
          </button>
        </div>

        {/*
         * The conversation slot. It is a real region of the dialog with a real
         * heading, held open and empty, because the honest rendering of "there
         * is no agent attached" is an empty seat and not the absence of one.
         */}
        <div className="ln-talk">
          <span className="ln-label">the conversation</span>
          <p className="ln-talk-say">
            Athena is not connected — the options below are yours to take.
          </p>
          <p className="ln-talk-note">
            Her proposal and your reply will sit here. Every act below is registered and waiting.
          </p>
        </div>

        <ul className="ln-acts">
          {acts.map((act) => {
            const auto = isAuto(TOOL_CLASSES[act.tool]);
            return (
              <li className="ln-act" key={act.tool} data-class={auto ? "auto" : "gated"}>
                <span className="ln-act-class">{auto ? "Auto" : "Gated"}</span>
                <span className="ln-act-said">
                  <b>{act.label}</b>
                  <i>{act.reaches}</i>
                  <code className="num">{act.tool}</code>
                </span>
                {act.params ? <span className="ln-act-params">{act.params}</span> : null}
                <span className="ln-act-take">{act.take}</span>
              </li>
            );
          })}
        </ul>

        <p className="ln-class">
          <b>AUTO</b> reversible — each writes an undo row. <i>GATED</i> each reaches a person or
          cannot be replayed backwards, and arms before it issues.
        </p>
      </motion.div>
    </div>,
    host,
  );
}
