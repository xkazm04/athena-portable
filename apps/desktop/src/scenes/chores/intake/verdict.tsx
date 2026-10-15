/**
 * The front door's verdict — ADR 0098, README section 3.5.
 *
 * Two endings. A chore fits: which one, why it fits, what would differ for this person, and one
 * press to its "Make it yours" studio with their need as the opening message; the chores that
 * nearly fit are quiet rows with the same two ways in. No chore is worth reusing: an editable
 * command, handed to Athena's window to be read and sent by the person. Either ending can become
 * the other: "Go custom instead" opens the same panel on the need, and the custom panel always
 * ends in "Back to the chores". The hand-off is `athenaOffer` injected as `offer`; with no shell
 * it rejects and the panel says so and leaves Copy as the way.
 */
import { useEffect, useState } from "react";

import Button from "@/components/Button";
import type { Verdict } from "@/lib/adopt";
import { categoryLabel } from "@/lib/playbook-taxonomy";
import type { PlaybookView, PlaybooksModel } from "@/modules/playbooks/model";

export interface VerdictActions {
  /** Open the chore's studio with the need as the opening message. */
  openAdopt: (playbookId: string, intro: string) => void;
  /** Open the chore's page. */
  openChore: (playbookId: string) => void;
  /** Put a command in Athena's composer; rejects without a shell. */
  offer: (text: string) => Promise<void>;
  /** Back to the catalogue. */
  back: () => void;
}

export default function VerdictCard({
  verdict,
  model,
  actions,
  onDraft,
}: {
  verdict: Verdict;
  model: PlaybooksModel;
  actions: VerdictActions;
  /** Whether the custom panel holds an edit that was not handed over. */
  onDraft: (unsent: boolean) => void;
}) {
  const main =
    verdict.fit === "template"
      ? model.items.find((v) => v.id === verdict.playbook_id)
      : undefined;
  const [custom, setCustom] = useState(
    verdict.fit === "custom" || main === undefined,
  );
  const alternates = verdict.alternates.flatMap((a) => {
    const view = model.items.find((v) => v.id === a.playbook_id);
    return view ? [{ ...a, view }] : [];
  });

  if (custom) {
    return (
      <CustomPanel
        initial={verdict.fit === "custom" ? verdict.command : verdict.need}
        why={verdict.fit === "custom" ? verdict.why : ""}
        missing={verdict.fit === "template" && main === undefined}
        actions={actions}
        onDraft={onDraft}
        onFit={
          verdict.fit === "template" && main
            ? () => setCustom(false)
            : undefined
        }
      />
    );
  }
  if (!main) return null;

  return (
    <section className="in-verdict" aria-label="Verdict">
      <p className="in-verdict__eyebrow">This chore fits</p>
      <h2 className="in-verdict__title">{main.playbook.shortTitle}</h2>
      <p className="in-verdict__area">{areaOf(main)}</p>
      {verdict.why ? <p className="in-verdict__why">{verdict.why}</p> : null}
      {verdict.differs ? (
        <>
          <h3 className="in-verdict__h">What would differ</h3>
          <p className="in-verdict__differs">{verdict.differs}</p>
        </>
      ) : null}
      <div className="in-verdict__acts">
        <Button
          variant="primary"
          onClick={() => actions.openAdopt(main.id, verdict.need)}
        >
          Make it yours
        </Button>
        <button
          type="button"
          className="ad-link focus-ring"
          onClick={() => actions.openChore(main.id)}
        >
          See the chore page
        </button>
        <span className="in-verdict__spacer" />
        <Button variant="ghost" onClick={() => setCustom(true)}>
          Go custom instead
        </Button>
      </div>
      {alternates.length ? (
        <div className="in-alts">
          <h3 className="in-verdict__h">Also close</h3>
          <ul className="in-alts__list">
            {alternates.map((a) => (
              <li key={a.playbook_id} className="in-alt">
                <div className="in-alt__words">
                  <span className="in-alt__title">
                    {a.title || a.view.playbook.shortTitle}
                  </span>
                  <span className="in-alt__area">{areaOf(a.view)}</span>
                  {a.why ? <span className="in-alt__why">{a.why}</span> : null}
                </div>
                <div className="in-alt__acts">
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Make it yours: ${a.title || a.view.playbook.shortTitle}`}
                    onClick={() =>
                      actions.openAdopt(a.playbook_id, verdict.need)
                    }
                  >
                    Make it yours
                  </Button>
                  <button
                    type="button"
                    className="ad-link focus-ring"
                    aria-label={`See the chore page: ${a.title || a.view.playbook.shortTitle}`}
                    onClick={() => actions.openChore(a.playbook_id)}
                  >
                    See the chore page
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

const areaOf = (v: PlaybookView) => categoryLabel(v.playbook.category);

type Hand = "idle" | "sending" | "handed" | "failed";
type Copy = "idle" | "copied" | "failed";

function CustomPanel({
  initial,
  why,
  missing,
  actions,
  onDraft,
  onFit,
}: {
  initial: string;
  why: string;
  /** The chore she named is not in this build. */
  missing: boolean;
  actions: VerdictActions;
  onDraft: (unsent: boolean) => void;
  /** Back to the chore that fits, when there is one. */
  onFit?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [hand, setHand] = useState<Hand>("idle");
  const [copy, setCopy] = useState<Copy>("idle");
  const edited = text !== initial && hand !== "handed";
  useEffect(() => onDraft(edited), [edited, onDraft]);

  const give = () => {
    setHand("sending");
    actions.offer(text.trim()).then(
      () => setHand("handed"),
      () => setHand("failed"),
    );
  };
  const copyIt = () => {
    const done = navigator.clipboard?.writeText(text);
    if (!done) {
      setCopy("failed");
      return;
    }
    done.then(
      () => setCopy("copied"),
      () => setCopy("failed"),
    );
  };

  return (
    <section className="in-verdict in-verdict--custom" aria-label="Verdict">
      <p className="in-verdict__eyebrow">No chore here is worth reusing</p>
      <h2 className="in-verdict__title">Hand this to Athena as it is</h2>
      {why ? <p className="in-verdict__why">{why}</p> : null}
      {missing ? (
        <p className="in-verdict__why">
          The chore she picked is not in this build, so here is the need as a
          command.
        </p>
      ) : null}
      <label className="ad-composer__label" htmlFor="in-command">
        The command for Athena. Change anything you like.
      </label>
      <textarea
        id="in-command"
        className="input focus-ring in-command"
        rows={6}
        value={text}
        onChange={(e) => {
          setText(e.currentTarget.value);
          setHand("idle");
          setCopy("idle");
        }}
      />
      <div className="in-verdict__acts">
        <Button
          variant="primary"
          onClick={give}
          disabledReason={
            text.trim()
              ? hand === "sending"
                ? "Handing it over"
                : undefined
              : "Write the command first"
          }
        >
          Hand to Athena
        </Button>
        <Button
          variant="secondary"
          onClick={copyIt}
          disabledReason={text.trim() ? undefined : "Write the command first"}
        >
          Copy
        </Button>
        <span className="in-verdict__spacer" />
        {onFit ? (
          <Button variant="ghost" onClick={onFit}>
            Show the chore that fits
          </Button>
        ) : null}
        <Button variant="ghost" onClick={actions.back}>
          Back to the chores
        </Button>
      </div>
      {hand === "handed" ? (
        <p className="ad-note in-verdict__status" role="status">
          It is in Athena&apos;s window. Read it and press send.
        </p>
      ) : null}
      {hand === "failed" ? (
        <p className="ad-note in-verdict__status" role="status">
          Athena&apos;s window is only there in the app. Copy the command and
          paste it where you talk to her.
        </p>
      ) : null}
      {copy === "copied" ? (
        <p className="ad-note in-verdict__status" role="status">
          Copied.
        </p>
      ) : null}
      {copy === "failed" ? (
        <p className="ad-note in-verdict__status" role="status">
          Copying did not work here. Select the text and copy it yourself.
        </p>
      ) : null}
    </section>
  );
}
