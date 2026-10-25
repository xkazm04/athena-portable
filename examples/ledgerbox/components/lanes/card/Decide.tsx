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
 * and the user's reply will live. Whether a bridge is in the page is READ, by
 * the same `useAthenaPresence` the footer's presence line draws (`card/read.ts`
 * talkSay), and said in the present tense of registration rather than as a
 * disabled text box implying a feature that is coming. `design/pass3-law-brief.md` §4.1 forbids any sentence in which Athena
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
  matchAction,
  sendReminderAction,
  voidInvoiceAction,
} from "@/app/actions";
import { CATEGORIES, TONES, type Category, type Tone } from "@/lib/constants";
import type { ActionResult } from "@/lib/types";
import { Gate } from "../Gate";
import type { LnMark } from "../model";
import { useAthenaPresence } from "../presence";
import type { ActDoor, ActIssue, ActSpec, ActState, ListTool } from "./acts";
import { talkSay } from "./read";
import { fade, instant } from "../motion";

/** The server action an act's issue descriptor names. */
function perform(issue: ActIssue): Promise<ActionResult> {
  switch (issue.tool) {
    case "draft_reminder":
      return draftReminderAction(issue.ref, issue.tone);
    case "match_bank_line":
      return matchAction(issue.ref, issue.lineId);
    case "categorize":
      return categorizeAction(issue.ids, issue.category);
    case "mark_paid":
      return markPaidAction(issue.ref, issue.amountCents);
    case "send_reminder":
      return sendReminderAction(issue.ref, "user", issue.reminderId);
    case "void_invoice":
      return voidInvoiceAction(issue.ref);
  }
}

export function Decide({
  mark,
  tone,
  setTone,
  category,
  setCategory,
  specs,
  acts,
  door,
  onClose,
}: {
  mark: LnMark;
  tone: Tone;
  setTone: (next: Tone) => void;
  category: Category;
  setCategory: (next: Category) => void;
  /** The list, as data (`card/acts.ts` actSpecs), built once by the card. */
  specs: readonly ActSpec[];
  /** The card's one act machine: what is armed, what is in flight, where focus goes. */
  acts: ActState;
  door: ActDoor;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const presence = useAthenaPresence();
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
    // A focus the machine asked for before this list opened is not this list's to honour.
    door.focused();
    // Leaving the list leaves nothing armed for its next opening.
    return () => door.close();
  }, [door]);

  /*
   * WHERE FOCUS GOES WHEN AN ACT CLOSES is the machine's answer (`card/acts.ts`): back to the row
   * whose gate was cancelled or whose act answered, or - when that row is now disabled and cannot
   * hold focus - to this heading. Without it, a confirm that unmounts or disables under the
   * keyboard leaves focus on the body.
   */
  useEffect(() => {
    if (acts.focus !== "heading") return;
    headingRef.current?.focus();
    door.focused();
  }, [acts.focus, door]);
  /** A row's take control, which takes focus when the machine names its row. A callback ref runs
   *  as the control mounts, so a gate's idle button that returns after its exit fade is reached. */
  const focusRow = (tool: ListTool) => (el: HTMLButtonElement | null) => {
    if (el && !el.disabled && acts.focus === `row:${tool}`) {
      el.focus();
      door.focused();
    }
  };

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

  /*
   * THE PARAMETERS, the only part of a row that is JSX. Everything else about each act - its
   * label, what it reaches, why it is refused, whether it arms, what it is armed on - is
   * `card/acts.ts` actSpecs, built from the books and pinned there as behaviour.
   */
  const params: Partial<Record<ListTool, ReactNode>> = {
    draft_reminder: (
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
    categorize: (
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
  };
  const busy = acts.issuing !== null;

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
          <p className="ln-talk-say">{talkSay(presence.bridged)}</p>
          <p className="ln-talk-note">
            Her proposal and your reply will sit here. Every act below is registered and waiting.
          </p>
        </div>

        <ul className="ln-acts">
          {specs.map((act) => {
            /*
             * THE CONTROL FOLLOWS THE CLASS, as the badge does: `act.gated` is
             * `lib/tool-classes.ts`'s answer and nobody else's. Every press goes through the
             * card's one door, which refuses a second write while one is in flight.
             */
            const take = act.gated ? (
              <Gate
                label={act.takeLabel}
                confirmLabel={act.takeLabel}
                question={act.question ?? act.reaches}
                armed={acts.armed?.tool === act.tool}
                busy={busy}
                disabled={act.blocked !== null}
                onArm={() => door.arm(act.tool, act.subject ?? act.reaches)}
                onCancel={() => door.disarm()}
                onConfirm={() => door.confirm(act.tool, () => perform(act.issue))}
                idleRef={focusRow(act.tool)}
              />
            ) : (
              <button
                type="button"
                className="ln-btn"
                ref={focusRow(act.tool)}
                disabled={busy || act.blocked !== null}
                onClick={() => door.take(act.tool, () => perform(act.issue))}
              >
                {act.takeLabel}
              </button>
            );
            const param = params[act.tool];
            return (
              <li className="ln-act" key={act.tool} data-class={act.gated ? "gated" : "auto"}>
                <span className="ln-act-class">{act.gated ? "Gated" : "Auto"}</span>
                <span className="ln-act-said">
                  <b>{act.label}</b>
                  <i>{act.reaches}</i>
                  <code className="num">{act.tool}</code>
                </span>
                {param ? <span className="ln-act-params">{param}</span> : null}
                <span className="ln-act-take">{take}</span>
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
