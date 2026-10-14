/**
 * The ledger's preview — README section 3.5, ADR 0044, 0096.
 *
 * The playbook the ledger has picked, read without leaving the list: its area and job, its name
 * and its promise; the blueprint of its process (the hero, a plan drawn from its own data); the
 * screens of its bench run; the chore by hand against the same chore with her; and, held at the
 * pane's foot, what a person does with it. "Fit it to me" opens the fit in the pane, "Copy the
 * command" puts the playbook's own command on the clipboard, and "Open the full playbook" goes down
 * to the chore and its replay, which keep everything the preview leaves out.
 *
 * Whether the fit is open, and what a press just did, is the pane's own state; the field keys the
 * pane by playbook, so both start again for another one. Nothing here fetches.
 */
import { useState } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import { categoryLabel, jobLabel } from "@/lib/playbook-taxonomy";
import type { PlaybookActions, PlaybookView } from "@/modules/playbooks/model";

import Blueprint from "./blueprint";
import Fit from "./fit";
import { beforeAfterOf } from "./model";
import Storyboard from "./storyboard";

export default function Preview({
  view,
  actions,
  onOpen,
}: {
  view: PlaybookView;
  actions: PlaybookActions;
  /** Go down to the chore: the full playbook and its replay. */
  onOpen: () => void;
}) {
  const p = view.playbook;
  const [fitting, setFitting] = useState(false);
  const [said, setSaid] = useState("");
  const band = beforeAfterOf(view);

  return (
    <aside className="ch-pane" aria-label={`Preview: ${view.title}`}>
      <div className="ch-pane__body">
        <header className="ch-pane__head">
          <p className="ch-eyebrow">{`${categoryLabel(p.category)} · ${jobLabel(p.job)}`}</p>
          <h2 className="ch-pane__name">{view.title}</h2>
          <p className="ch-body">{p.promise}</p>
          <p className="ch-pane__worth">
            <Badge tone={view.verdict.tone}>{view.verdict.label}</Badge>
            <span className="ch-data">{`${view.value} ${view.per}`}</span>
            <span className="ch-note">author&apos;s estimate</span>
          </p>
        </header>

        <Blueprint view={view} />
        <Storyboard view={view} />

        <section className="ch-band" aria-label="By hand and with Athena">
          <div className="ch-band__side">
            <p className="ch-label">By hand</p>
            <p className="ch-band__n">{band.manual.figure}</p>
            <p className="ch-note">{band.manual.line || "the author's estimate"}</p>
          </div>
          <div className="ch-band__side" data-athena="">
            <p className="ch-label">With Athena</p>
            {band.athena ? (
              <>
                <p className="ch-band__n">{band.athena.figure}</p>
                <p className="ch-note">{band.athena.line}</p>
              </>
            ) : (
              <>
                <p className="ch-band__n">–</p>
                <p className="ch-note">Not benched, so nothing is measured.</p>
              </>
            )}
          </div>
          {band.ratio ? <p className="ch-band__ratio ch-data">{band.ratio}</p> : null}
        </section>

        {fitting ? (
          <Fit
            view={view}
            onHand={(command) => {
              actions.hand(command, { id: p.id, title: view.title });
              setFitting(false);
              setSaid("Handed to her, fitted. It waits in her composer until you send it.");
            }}
            onCancel={() => setFitting(false)}
          />
        ) : null}
      </div>

      <footer className="ch-adopt">
        {fitting ? null : (
          <div className="ch-adopt__row">
            <Button variant="primary" onClick={() => setFitting(true)}>
              Fit it to me
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                actions.copy(p.command);
                setSaid("Sent the command to the clipboard.");
              }}
            >
              Copy the command
            </Button>
            <button type="button" className="ch-link ch-adopt__open focus-ring" onClick={onOpen}>
              Open the full playbook
            </button>
          </div>
        )}
        <p className="ch-note ch-said" role="status">
          {said}
        </p>
      </footer>
    </aside>
  );
}
