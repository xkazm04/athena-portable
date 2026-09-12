/**
 * The conversation, as a record — README section 3.2 (how a turn flows).
 *
 * One rail down the left and every kind of line hanging off it, told apart by its mark, its type
 * tier and its measure rather than by a wash of colour behind it: six kinds would be six
 * backgrounds and no hierarchy. What the user asked leads (it is the only thing on the page in the
 * title tier); what Athena answered is prose at its own measure; a tool call and its result are
 * the machine's own spelling in the mono tier, because they are a trace and not a sentence; an
 * error is the reason verbatim; a summary is what the turn came to.
 *
 * **The pending card is pinned above the composer, and the line in the record points at it.**
 * A card that scrolls out of the transcript is a turn that has silently stopped, and two copies
 * of the same card with two sets of buttons is a worse answer than one. So the record keeps the
 * *place* the decision happened and the pin keeps the *act*, and after it is answered the pin
 * goes and the line becomes the card collapsed to its choice.
 *
 * Local to this module. It renders `PanelModel` and nothing else could want it.
 */
import { useState } from "react";

import Button from "@/components/Button";
import { TextInput } from "@/components/FormField";

import DecisionCard from "./DecisionCard";
import type { PanelLine, PanelModel } from "../model";

export default function ChatPane({ model }: { model: PanelModel }) {
  const [draft, setDraft] = useState("");
  const { actions, blocked, lines, pending } = model;

  const send = () => {
    const text = draft.trim();
    if (!text || blocked) return;
    setDraft("");
    actions.send(text);
  };

  return (
    <section className="chat" aria-label="Conversation">
      <header className="chat__head">
        <h2 className="typo-title">Conversation</h2>
        {model.conversationId ? (
          <code className="typo-code muted truncate">{model.conversationId}</code>
        ) : (
          <span className="typo-caption">not started</span>
        )}
        <span style={{ marginLeft: "auto" }}>
          <Button
            size="sm"
            variant="ghost"
            disabledReason={
              lines.length === 0
                ? "There is nothing to clear."
                : model.status === "streaming"
                  ? "Athena is working."
                  : undefined
            }
            onClick={actions.clear}
          >
            Clear
          </Button>
        </span>
      </header>

      <ol className="transcript">
        {lines.length === 0 ? (
          <li className="entry">
            <span className="entry__body">
              <p className="typo-body">
                Nothing yet. Ask for something on the page in front of you.
              </p>
            </span>
          </li>
        ) : (
          lines.map((line) => <Entry key={line.id} line={line} model={model} />)
        )}
        {model.status === "streaming" ? (
          <li className="entry entry--assistant">
            <span className="entry__mark typo-code" aria-hidden="true">
              ·
            </span>
            <span className="entry__body">
              <p className="typo-label muted">Athena is working…</p>
            </span>
          </li>
        ) : null}
      </ol>

      <div className="chat__foot">
        {pending ? (
          <div className="chat__pin">
            <DecisionCard
              card={pending}
              onAnswer={(choice) => actions.answer(pending.id, choice)}
              blocked={
                model.daemonReady ? undefined : "Athena is offline, so an answer cannot be sent."
              }
            />
          </div>
        ) : null}

        {model.error ? (
          <p className="typo-caption">
            <code className="typo-code">{model.error.reason}</code>
            {model.error.detail && model.error.detail !== model.error.reason
              ? ` — ${model.error.detail}`
              : ""}
          </p>
        ) : null}

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <TextInput
            aria-label="Ask Athena"
            value={draft}
            disabled={Boolean(blocked)}
            // The reason lives on the control itself (house style §2.2): a disabled field whose
            // reason is stated nowhere is a dead end.
            placeholder={blocked ?? "What should happen on this page?"}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" variant="primary" disabledReason={blocked ?? undefined}>
            Send
          </Button>
        </form>
      </div>
    </section>
  );
}

/** The glyph that says which kind of line this is. The word is in the line's own label. */
const MARK: Record<PanelLine["kind"], string> = {
  user: "›",
  assistant: "·",
  "tool.call": "→",
  "tool.result": "✓",
  decision: "⟡",
  error: "✗",
  summary: "▪",
};

function Entry({ line, model }: { line: PanelLine; model: PanelModel }) {
  const kindClass = `entry entry--${line.kind.replace(".", "-")}`;

  if (line.kind === "decision" && line.card) {
    const card = line.card;
    return (
      <li className={kindClass}>
        <span className="entry__mark typo-code" aria-hidden="true">
          {MARK.decision}
        </span>
        <span className="entry__body">
          {card.state === "pending" ? (
            // The act is on the pin below; the record keeps the place it happened.
            <p className="typo-label">
              <code className="typo-code">{card.action}</code> is waiting on you — the card is
              pinned under the transcript.
            </p>
          ) : (
            <DecisionCard card={card} onAnswer={(choice) => model.actions.answer(card.id, choice)} />
          )}
        </span>
      </li>
    );
  }

  return (
    <li className={kindClass}>
      <span className="entry__mark typo-code" aria-hidden="true">
        {MARK[line.kind]}
      </span>
      <span className="entry__body">
        {line.kind === "user" ? (
          <>
            <span className="typo-label muted">you asked</span>
            <p className="typo-title entry__prose" style={{ color: "var(--foreground)" }}>
              {line.text}
            </p>
          </>
        ) : line.kind === "tool.call" || line.kind === "tool.result" ? (
          <p className="typo-code entry__text entry__prose">{line.text}</p>
        ) : line.kind === "summary" ? (
          <>
            <span className="typo-label muted">this turn</span>
            <p className="typo-caption entry__prose">{line.text}</p>
          </>
        ) : (
          <p className="typo-body entry__text entry__prose">{line.text}</p>
        )}
      </span>
    </li>
  );
}
