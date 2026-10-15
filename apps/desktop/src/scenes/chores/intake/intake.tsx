/**
 * The Chores front door — ADR 0098, README section 3.5.
 *
 * Where "New chore" leads (`chores/new`). The person says what they need; Athena asks one to three
 * question cards, then gives a verdict: a chore that fits (one press to its "Make it yours" studio
 * with the need as the opening message) or a command made for the need (handed to her window). The
 * conversation, its cards and its composer are the Adopt studio's; "Just decide for me" replaces
 * "Good enough". Every state is said in words with a way back: no daemon, connecting, reconnecting,
 * closed, busy, the engine's fault with Retry.
 *
 * Escape and Close go back to the catalogue; Escape asks first when something typed or picked was
 * not sent. Leaving closes the session.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import Button from "@/components/Button";
import ProblemNote from "@/components/ProblemNote";
import type { PlaybooksModel } from "@/modules/playbooks/model";

import type { AdoptDeps } from "../adopt/deps";
import Conversation, { type ConversationWords } from "../adopt/conversation";
import "../adopt/adopt.css";
import { useIntakeSession } from "./session";
import VerdictCard from "./verdict";

const WORDS: Omit<ConversationWords, "composer"> = {
  label: "Tell her what you need, or answer in your own words",
  placeholder:
    "Every month I chase refunds from airlines for flights that were cancelled…",
  enough: "Just decide for me",
  enoughDone: "Said: she is deciding with what she has",
};

export default function Intake({
  deps,
  model,
  back,
  openAdopt,
  openChore,
  offer,
}: {
  deps: AdoptDeps | undefined;
  model: PlaybooksModel;
  /** Back to the catalogue. */
  back: () => void;
  openAdopt: (playbookId: string, intro: string) => void;
  openChore: (playbookId: string) => void;
  /** Athena's composer (`athenaOffer`); without it, or without a shell, the person copies. */
  offer?: (text: string) => Promise<void>;
}) {
  const [s, act] = useIntakeSession(deps);
  const drafts = useRef(new Set<string>());
  const [asking, setAsking] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const onDraft = useCallback((key: string, unsent: boolean) => {
    if (unsent) drafts.current.add(key);
    else drafts.current.delete(key);
  }, []);
  const onCustomDraft = useCallback(
    (unsent: boolean) => onDraft("custom", unsent),
    [onDraft],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (root.current?.closest("[inert]")) return;
      e.preventDefault();
      if (drafts.current.size > 0) setAsking(true);
      else back();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [back]);

  const head = (
    <header className="ad-head">
      <div className="ad-head__row">
        <div>
          <p className="pa-eyebrow">New chore</p>
          <h1 className="ad-title">What do you need done?</h1>
          <p className="ad-sub">
            Say it in your own words. She asks a few questions, then tells you
            which chore fits, or writes you a command of your own.
          </p>
        </div>
        <div className="ad-head__acts">
          <Button variant="secondary" onClick={back}>
            Close
          </Button>
        </div>
      </div>
      {asking ? (
        <div
          className="ad-ask"
          role="alertdialog"
          aria-label="Leave with an unsent answer?"
        >
          <span>You have something you have not sent. Leave anyway?</span>
          <Button variant="primary" size="sm" onClick={back}>
            Leave
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
            Stay
          </Button>
        </div>
      ) : null}
    </header>
  );

  if (!deps?.intake || s.conn === "failed") {
    const reason = s.problem?.reason;
    const offline = !deps?.intake || reason === "offline";
    const busy = reason === "busy";
    return (
      <div className="pa-page ad-page" ref={root}>
        <div className="ad-wrap">
          {head}
          <div className="ad-problem">
            <ProblemNote
              title={
                offline
                  ? "Athena needs the daemon for this"
                  : busy
                    ? "Athena has all her conversations open"
                    : "The conversation could not start"
              }
              reason={
                !deps?.intake
                  ? "No daemon is connected to this window."
                  : s.problem?.detail || s.problem?.reason || "unknown"
              }
              detail={
                offline ? "Start it from Mind → Engine, then try again." : null
              }
              onRetry={deps?.intake ? act.retry : undefined}
              retryLabel="Try again"
            />
            <Button variant="ghost" onClick={back}>
              Back to the chores
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const done = s.verdict !== null;

  return (
    <div className="pa-page ad-page" ref={root}>
      <div className="ad-wrap in-wrap">
        {head}
        {s.conn === "retrying" ? (
          <p
            className="ad-banner"
            role="status"
          >{`The stream dropped. Reconnecting (try ${s.tries} of 5)…`}</p>
        ) : null}
        {s.conn === "lost" ? (
          <div className="ad-banner ad-banner--lost">
            <ProblemNote
              title="The conversation lost its connection."
              reason={s.problem?.detail || s.problem?.reason || "offline"}
              onRetry={act.retry}
              retryLabel="Retry"
              tone="warning"
            />
          </div>
        ) : null}
        {s.conn === "closed" && !done ? (
          <div className="ad-banner ad-banner--lost">
            <ProblemNote
              title="This conversation has ended."
              reason={s.problem?.detail || "closed"}
              onRetry={act.retry}
              retryLabel="Start again"
              tone="warning"
            />
          </div>
        ) : null}
        {s.fault && !done ? (
          <div className="ad-banner ad-banner--lost">
            <ProblemNote
              title="Athena could not finish thinking about this."
              reason={s.fault.detail || s.fault.reason || "engine_error"}
              onRetry={act.retry}
              retryLabel="Retry"
              tone="warning"
            />
          </div>
        ) : null}
        <Conversation
          feed={s.feed}
          progress={
            s.conn === "starting"
              ? "Reading what she already knows…"
              : s.progress
          }
          dictation={deps.dictation}
          ready={s.conn !== "starting" && s.sid !== "" && !done}
          enough={s.enough}
          onAnswer={act.answer}
          onSay={act.say}
          onEnough={act.decide}
          onDraft={onDraft}
          words={{ ...WORDS, composer: !done }}
          stage={
            s.verdict ? (
              <VerdictCard
                verdict={s.verdict}
                model={model}
                onDraft={onCustomDraft}
                actions={{
                  openAdopt,
                  openChore,
                  offer: offer ?? (() => Promise.reject(new Error("No shell"))),
                  back,
                }}
              />
            ) : null
          }
        />
      </div>
    </div>
  );
}
