/**
 * One question card — ADR 0097, README section 3.5.
 *
 * Up to four questions she wrote to fill the case's open slots, each with its options as buttons
 * (one pick: pressed like a radio; several: toggles) and a line for the person's own words where
 * the question allows it. One Send for the whole card; Enter in the last line sends too. An
 * answered card collapses to a receipt in a line, with "change" to answer those questions again:
 * a new answer, never an edit of the old one, so the daemon reads the latest.
 */
import { useEffect, useMemo, useState } from "react";

import Button from "@/components/Button";
import type { Answer, Question } from "@/lib/adopt";

import { receipt } from "./state";

export default function QuestionCard({
  round,
  questions,
  answers,
  onSend,
  onDraft,
}: {
  round: number;
  questions: readonly Question[];
  answers: readonly Answer[] | null;
  onSend: (answers: Answer[]) => void;
  /** Whether this card holds something typed or picked that was not sent. */
  onDraft: (unsent: boolean) => void;
}) {
  const [changing, setChanging] = useState(false);
  const seed = useMemo(() => {
    const picks: Record<string, string[]> = {};
    const texts: Record<string, string> = {};
    for (const a of answers ?? []) {
      picks[a.question_id] = [...a.choice_ids];
      texts[a.question_id] = a.text;
    }
    return { picks, texts };
  }, [answers]);
  const [picks, setPicks] = useState<Record<string, string[]>>(seed.picks);
  const [texts, setTexts] = useState<Record<string, string>>(seed.texts);
  const open = answers === null || changing;

  const touched =
    open &&
    questions.some(
      (q) =>
        (picks[q.id]?.length ?? 0) > 0 || (texts[q.id] ?? "").trim() !== "",
    );
  const sendable = changing || touched;
  useEffect(() => onDraft(touched), [touched, onDraft]);

  const reopen = () => {
    setPicks(seed.picks);
    setTexts(seed.texts);
    setChanging(true);
  };

  const send = () => {
    if (!sendable) return;
    onSend(
      questions.map((q) => ({
        question_id: q.id,
        choice_ids: picks[q.id] ?? [],
        text: (texts[q.id] ?? "").trim(),
      })),
    );
    setChanging(false);
  };

  const pick = (q: Question, id: string) =>
    setPicks((p) => {
      const now = p[q.id] ?? [];
      if (q.multi)
        return {
          ...p,
          [q.id]: now.includes(id) ? now.filter((x) => x !== id) : [...now, id],
        };
      return { ...p, [q.id]: now.includes(id) ? [] : [id] };
    });

  if (!open) {
    return (
      <div className="ad-receipt" data-round={round}>
        <span className="ad-receipt__who">You</span>
        <span className="ad-receipt__line">
          {receipt(questions, answers ?? [])}
        </span>
        <button type="button" className="ad-link focus-ring" onClick={reopen}>
          change
        </button>
      </div>
    );
  }

  const lastText = [...questions].reverse().find((q) => q.allow_text)?.id ?? "";

  return (
    <section className="ad-card" aria-label={`Questions, round ${round}`}>
      <p className="ad-card__head">
        <span className="ad-card__round">{`Round ${round}`}</span>
        <span>
          {questions.length === 1
            ? "1 question"
            : `${questions.length} questions`}
        </span>
      </p>
      <ol className="ad-qs">
        {questions.map((q, i) => (
          <li key={q.id} className="ad-q">
            <p className="ad-q__text" id={`ad-q-${round}-${q.id}`}>
              <span className="ad-q__n" aria-hidden="true">
                {i + 1}
              </span>
              {q.text}
            </p>
            {q.options.length ? (
              <div
                className="ad-chips"
                role="group"
                aria-labelledby={`ad-q-${round}-${q.id}`}
                data-multi={q.multi ? "" : undefined}
              >
                {q.options.map((o) => {
                  const on = (picks[q.id] ?? []).includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      className="ad-chip focus-ring"
                      aria-pressed={on}
                      onClick={() => pick(q, o.id)}
                    >
                      {q.multi ? (
                        <span className="ad-chip__box" aria-hidden="true">
                          {on ? "✓" : ""}
                        </span>
                      ) : null}
                      {o.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {q.allow_text ? (
              <input
                className="input focus-ring ad-q__input"
                type="text"
                aria-label={`Your answer: ${q.text}`}
                placeholder={
                  q.options.length ? "Or in your words…" : "In your words…"
                }
                value={texts[q.id] ?? ""}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setTexts((t) => ({ ...t, [q.id]: value }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && q.id === lastText) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
            ) : null}
          </li>
        ))}
      </ol>
      <div className="ad-card__foot">
        <Button
          variant="primary"
          onClick={send}
          disabledReason={
            sendable ? undefined : "Pick an answer or write one first"
          }
        >
          Send
        </Button>
        {changing ? (
          <Button variant="ghost" onClick={() => setChanging(false)}>
            Keep the earlier answer
          </Button>
        ) : null}
      </div>
    </section>
  );
}
