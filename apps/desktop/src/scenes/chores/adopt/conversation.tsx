/**
 * The conversation column of the Adopt studio — ADR 0097, README section 3.5.
 *
 * Her lines in simple markdown, the question cards, the person's own lines and dropped documents,
 * and any error the session reported, in the order they happened. Her latest progress beat is one
 * quiet line under the last message, replaced and never appended. Under it all, the composer:
 * free words at any time, a microphone held to talk (the transcript lands in the box and is never
 * sent on its own: what was heard is shown before it is used), a drop zone for a statement or a
 * letter, and "Good enough".
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import Button from "@/components/Button";
import type { Answer, AnswerVia } from "@/lib/adopt";
import { DOCUMENT_MIMES } from "@/lib/adopt-client";

import Rich from "../rich";
import QuestionCard from "./card";
import type { Dictation } from "./deps";
import type { FeedItem } from "./state";

/** What the composer says; the studio's by default. */
export interface ConversationWords {
  label: string;
  placeholder: string;
  enough: string;
  enoughDone: string;
  /** False once the conversation has its end (a verdict): nothing more to say. */
  composer: boolean;
}

const STUDIO_WORDS: ConversationWords = {
  label: "Tell her anything, at any time",
  placeholder: "My airline is Skylindle, and I paid with two cards…",
  enough: "Good enough",
  enoughDone: "Said: she is drafting with what she has",
  composer: true,
};

export default function Conversation({
  feed,
  progress,
  dictation,
  ready,
  enough,
  onAnswer,
  onSay,
  onResay,
  onDrop,
  onEnough,
  enoughBlocked,
  onDraft,
  stage,
  words,
}: {
  feed: readonly FeedItem[];
  progress: string;
  dictation: Dictation | null;
  /** The session is live: answers can be sent. */
  ready: boolean;
  enough: boolean;
  onAnswer: (cardKey: string, answers: Answer[], via: AnswerVia) => void;
  onSay: (text: string, via: AnswerVia) => void;
  /** Send a line the daemon refused once more. */
  onResay: (key: string) => void;
  /** Absent: no drop zone (the Chores front door takes no documents). */
  onDrop?: (file: File) => void;
  onEnough: () => void;
  /** Why "Good enough" cannot be pressed yet, when it cannot (the front door: nothing said). */
  enoughBlocked?: string;
  onDraft: (key: string, unsent: boolean) => void;
  /** What plays under the conversation once the brief is approved: the showcase. */
  stage?: ReactNode;
  /** The composer's words, for a conversation that is not the studio's (ADR 0098). */
  words?: ConversationWords;
}) {
  const w = { ...STUDIO_WORDS, ...words };
  const [text, setText] = useState("");
  const [via, setVia] = useState<AnswerVia>("text");
  const end = useRef<HTMLDivElement>(null);
  const last = feed.at(-1)?.key ?? "";

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest" });
  }, [last]);
  useEffect(() => onDraft("composer", text.trim() !== ""), [text, onDraft]);

  // Enter reaches here even while Send is disabled: the words stay in the box until they can go.
  const send = () => {
    if (!ready || !text.trim()) return;
    onSay(text, via);
    setText("");
    setVia("text");
  };

  return (
    <section className="ad-convo" aria-label="Conversation">
      <ol className="ad-feed">
        {feed.map((f) => (
          <li key={f.key} className={`ad-feed__item ad-feed__item--${f.kind}`}>
            <Item item={f} onAnswer={onAnswer} onDraft={onDraft} onResay={ready ? onResay : undefined} />
          </li>
        ))}
      </ol>
      {progress ? (
        <p className="ad-progress" role="status">
          <span className="ad-progress__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {progress}
        </p>
      ) : null}
      {stage}
      <div ref={end} />

      {w.composer ? (
        <div className="ad-composer">
          <label className="ad-composer__label" htmlFor="ad-say">
            {w.label}
          </label>
          <textarea
            id="ad-say"
            className="input focus-ring ad-composer__box"
            rows={2}
            placeholder={w.placeholder}
            value={text}
            onChange={(e) => {
              setText(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {via === "voice" && text ? (
            <p className="ad-note">
              Heard from your voice. Read it, fix it, then send.
            </p>
          ) : null}
          <div className="ad-composer__row">
            <Button
              variant="secondary"
              onClick={send}
              disabledReason={
                !ready
                  ? "Waiting for the session"
                  : text.trim()
                    ? undefined
                    : "Write something first"
              }
            >
              Send
            </Button>
            <Mic
              dictation={dictation}
              onHeard={(heard) => {
                setText((t) => (t.trim() ? `${t.trim()} ${heard}` : heard));
                setVia("voice");
              }}
            />
            {onDrop ? <DropZone onDrop={onDrop} disabled={!ready} /> : null}
            <span className="ad-composer__spacer" />
            <Button
              variant="ghost"
              onClick={onEnough}
              disabledReason={
                !ready
                  ? "Waiting for the session"
                  : enough
                    ? w.enoughDone
                    : enoughBlocked
              }
            >
              {w.enough}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Item({
  item: f,
  onAnswer,
  onDraft,
  onResay,
}: {
  item: FeedItem;
  onAnswer: (cardKey: string, answers: Answer[], via: AnswerVia) => void;
  onDraft: (key: string, unsent: boolean) => void;
  /** Absent while a line cannot be sent. */
  onResay?: (key: string) => void;
}) {
  const draft = useCallback(
    (unsent: boolean) => onDraft(f.key, unsent),
    [f.key, onDraft],
  );
  switch (f.kind) {
    case "say":
      return (
        <div className="ad-her">
          <span className="ad-her__mark" aria-hidden="true" />
          <Rich md={f.text} className="ad-her__words" />
        </div>
      );
    case "card":
      return (
        <QuestionCard
          round={f.round}
          questions={f.questions}
          answers={f.answers}
          onSend={(answers) => onAnswer(f.key, answers, "text")}
          onDraft={draft}
        />
      );
    case "you":
      return (
        <div className="ad-you-wrap">
          <p className="ad-you" data-status={f.status}>
            {f.via === "voice" ? (
              <span className="ad-you__via">spoken</span>
            ) : null}
            {f.text}
          </p>
          {f.status === "failed" ? (
            <p className="ad-you__not-sent" role="status">
              <span className="ad-note">Not sent. She has not heard this.</span>
              {onResay ? (
                <button type="button" className="ad-link" data-act="resay" onClick={() => onResay(f.key)}>
                  Send again
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
      );
    case "doc":
      return (
        <p className="ad-doc" data-status={f.status}>
          <span className="ad-doc__glyph" aria-hidden="true">
            ▤
          </span>
          <span className="ad-doc__name">{f.name}</span>
          <span className="ad-note">
            {f.status === "sending"
              ? "handing it over…"
              : f.status === "sent"
                ? "handed to her to read"
                : f.detail}
          </span>
        </p>
      );
    case "error":
      return (
        <p className="ad-error" role="alert">
          <strong>{`Something went wrong (${f.reason || "unknown"}).`}</strong>{" "}
          {f.detail}
        </p>
      );
  }
}

/** Hold to talk. The take goes into the box; the person sends it. */
export function Mic({
  dictation,
  onHeard,
}: {
  dictation: Dictation | null;
  onHeard: (text: string) => void;
}) {
  const [reason, setReason] = useState<string | null>(
    dictation ? "Checking the microphone…" : "Voice is not set up here",
  );
  const [phase, setPhase] = useState<"idle" | "recording" | "hearing">("idle");
  const [problem, setProblem] = useState("");
  const holding = useRef(false);

  useEffect(() => {
    let live = true;
    if (!dictation) return;
    void dictation.check().then(
      (r) => live && setReason(r),
      () => live && setReason("Voice could not be checked"),
    );
    return () => {
      live = false;
    };
  }, [dictation]);

  const start = () => {
    if (!dictation || reason !== null || holding.current) return;
    holding.current = true;
    setProblem("");
    setPhase("recording");
    dictation.start().catch((error: unknown) => {
      holding.current = false;
      setPhase("idle");
      setProblem(
        `The microphone did not open: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  };
  const stop = () => {
    if (!dictation || !holding.current) return;
    holding.current = false;
    setPhase("hearing");
    void dictation.stop().then(
      (out) => {
        setPhase("idle");
        if (out.ok) {
          if (out.text.trim()) onHeard(out.text.trim());
          else setProblem("Nothing was heard. Hold a little longer.");
        } else setProblem(out.reason);
      },
      // A take that could not be heard at all (the recorder or the listener threw) says so too.
      (error: unknown) => {
        setPhase("idle");
        setProblem(
          `The take could not be heard: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
  };

  if (reason !== null) {
    return (
      <Button variant="ghost" disabledReason={reason}>
        <MicGlyph /> Hold to talk
      </Button>
    );
  }
  return (
    <>
      <button
        type="button"
        className="btn btn--ghost focus-ring ad-mic"
        data-phase={phase}
        aria-pressed={phase === "recording"}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            start();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") stop();
        }}
      >
        <MicGlyph />{" "}
        {phase === "recording"
          ? "Listening…"
          : phase === "hearing"
            ? "Hearing it…"
            : "Hold to talk"}
      </button>
      {problem ? (
        <span className="ad-note ad-mic__problem">{problem}</span>
      ) : null}
    </>
  );
}

function MicGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="ad-mic__glyph"
    >
      <rect
        x="5.5"
        y="1.5"
        width="5"
        height="8.5"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M3 8a5 5 0 0 0 10 0M8 13v2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A statement or a letter, dropped or picked. */
function DropZone({
  onDrop,
  disabled,
}: {
  onDrop: (file: File) => void;
  disabled: boolean;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className="ad-drop"
      data-over={over ? "" : undefined}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        for (const f of Array.from(e.dataTransfer?.files ?? [])) onDrop(f);
      }}
    >
      <button
        type="button"
        className="ad-drop__btn focus-ring"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <span aria-hidden="true">⇩</span> Drop a statement or letter
      </button>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={DOCUMENT_MIMES.join(",")}
        onChange={(e) => {
          for (const f of Array.from(e.currentTarget.files ?? [])) onDrop(f);
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}
