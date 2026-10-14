/**
 * The guided fit — README section 3.5, ADR 0044 and 0096.
 *
 * A playbook was measured on the bench against its own portals and its own persona; a person's
 * case differs in a portal or two and in something only they know. The fit asks exactly that and
 * nothing else: for each portal, "I use this" or "mine is…" with the name of theirs, then what is
 * different in their case. What it hands Athena is the playbook's own command with the person's
 * differences after it (`fitCommand`), shown live as it will be sent, never a rewrite: a rewritten
 * command would be a different chore from the one the bench measured. The value stays the
 * author's estimate for the playbook's persona, said so, and is never rescaled to a guess.
 *
 * The answers are the form's own state, gone when the pane shows another playbook.
 */
import { useEffect, useRef, useState } from "react";

import Button from "@/components/Button";
import FormField, { TextInput } from "@/components/FormField";
import { fitCommand, type Fit as FitAnswers, type PlaybookView } from "@/modules/playbooks/model";

export default function Fit({
  view,
  onHand,
  onCancel,
}: {
  view: PlaybookView;
  /** Hand the fitted command to Athena; the pane says it did. */
  onHand: (command: string) => void;
  onCancel: () => void;
}) {
  const p = view.playbook;
  const [mine, setMine] = useState<Record<string, boolean>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const box = useRef<HTMLElement>(null);
  // It opens from the pane's foot, under the fold: bring it into view once, not on every keystroke.
  useEffect(() => {
    box.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  const fit: FitAnswers = {
    portals: Object.fromEntries(p.apps.map((a) => [a.name, mine[a.name] ? (names[a.name] ?? "") : ""])),
    note,
  };
  const command = fitCommand(p, fit);

  return (
    <section ref={box} className="ch-fit" aria-label="Fit it to me">
      <h3 className="ch-pane__title">Fit it to me</h3>
      <ul className="ch-fit__portals">
        {p.apps.map((a) => (
          <li key={a.name} className="ch-fit__portal">
            <span className="ch-fit__who">
              <span className="ch-label">{a.name}</span>
              <span className="ch-note">{a.role}</span>
            </span>
            <span className="ch-fit__choice" role="group" aria-label={`Your ${a.name}`}>
              <Button
                size="sm"
                variant={mine[a.name] ? "ghost" : "secondary"}
                aria-pressed={!mine[a.name]}
                onClick={() => setMine((m) => ({ ...m, [a.name]: false }))}
              >
                I use this
              </Button>
              <Button
                size="sm"
                variant={mine[a.name] ? "secondary" : "ghost"}
                aria-pressed={Boolean(mine[a.name])}
                onClick={() => setMine((m) => ({ ...m, [a.name]: true }))}
              >
                Mine is…
              </Button>
            </span>
            {mine[a.name] ? (
              <span className="ch-fit__mine">
                <FormField label={`What you use instead of ${a.name}`}>
                  {(input) => (
                    <TextInput
                      {...input}
                      value={names[a.name] ?? ""}
                      placeholder="its name"
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        setNames((n) => ({ ...n, [a.name]: value }));
                      }}
                    />
                  )}
                </FormField>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <FormField label="What is different in your case?" hint="Optional. Said to her after the playbook, in your words.">
        {(input) => (
          <textarea
            {...input}
            className="input typo-body focus-ring field__input ch-fit__note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
        )}
      </FormField>
      <p className="ch-note">
        {`Worth ${view.value} ${view.per} for ${p.persona || "the playbook's own case"}, the author's estimate; yours is not rescaled.`}
      </p>
      <div className="ch-fit__said">
        <p className="ch-label">What she will read</p>
        <pre className="ch-fit__command">{command}</pre>
      </div>
      <div className="ch-adopt__row">
        <Button variant="primary" onClick={() => onHand(command)}>
          Hand it to Athena
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
