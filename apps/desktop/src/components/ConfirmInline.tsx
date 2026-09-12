/**
 * @catalog A destructive act that asks once, in place: the trigger becomes a note naming what is
 * lost, with the safe option focused. Every "Forget", "Remove", "Delete" in this app.
 *
 * **Never a modal.** These acts are row-scoped — the row *is* the context — and a dialog over the
 * list covers the evidence the user is deciding from. This lands at commit zero rather than being
 * discovered: the first build grew three of these (Origins' Forget, Connectors' Remove, Projects'
 * delete) which disagreed about the confirm button's size, the safe button's variant, the minimum
 * target and, worst, **focus** — two of them dropped focus to `<body>` when the trigger they
 * replaced unmounted, so a stray Enter landed wherever the browser decided.
 *
 * The rule this carries is the app's, not any one surface's: **loud belongs on the confirm inside
 * the note, never on the trigger.** A list whose delete buttons are already red asks the user to
 * be careful on every render; a quiet trigger asks once, at the moment it matters.
 */
import { useState } from "react";
import type { ReactNode } from "react";

import Button from "@/components/Button";

export default function ConfirmInline({
  trigger,
  children,
  confirmLabel,
  keepLabel = "Keep it",
  onConfirm,
}: {
  /** The resting control. It is handed the opener; style it as anything but an alarm. */
  trigger: (ask: () => void) => ReactNode;
  /** What is lost, in one or two short sentences. The only prose this app puts on a page. */
  children: ReactNode;
  confirmLabel: string;
  keepLabel?: string;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <>{trigger(() => setAsking(true))}</>;

  return (
    <div className="problem-note problem-note--error" role="alertdialog" aria-label={confirmLabel}>
      <span className="problem-note__mark typo-heading" aria-hidden="true">
        !
      </span>
      <div className="problem-note__body">
        <p className="typo-body">{children}</p>
        <span className="row">
          {/* The app's `Button` has three variants and none of them is an alarm, deliberately:
              the note around this button is the alarm, and its hue is on a 3px rule rather than
              on a 12px word (house style §4). The confirm is simply the primary act of the note
              it sits in. */}
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setAsking(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
          {/* The trigger this note replaced held focus, so focus must land here — and on the
              safe option, so a stray Enter keeps rather than destroys. */}
          <Button variant="ghost" size="sm" autoFocus onClick={() => setAsking(false)}>
            {keepLabel}
          </Button>
        </span>
      </div>
    </div>
  );
}
