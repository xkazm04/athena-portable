/**
 * The Adopt studio — ADR 0097, README section 3.5.
 *
 * Where "Make it yours" leads (`chores/<id>/adopt`), and "Open your case" (`chores/<id>/case/<proj_id>`,
 * ADR 0123): the same studio started on a saved case, which draws its approved brief at once. Athena interviews the person in question
 * cards while research lanes fill the case on their own; when nothing is open (or the person says
 * "Good enough") she drafts a brief; approving it plays the run with their portals and rehearses
 * it on a world shaped like their case; "Start for real" hands the brief's command to her. Two
 * columns when the frame is wide (the conversation, then "Your case", sticky), stacked below. The
 * showcase plays in the conversation's column, under her last line, where a turn has the width it
 * needs; the brief stays on the right beside the case it was drawn from. What the studio says about
 * the brief (approvable, approved, rehearsed, handed) is read from one rev-keyed `phase`, so it is
 * always about the draft on show.
 *
 * Escape and Close go back to the topic page; Escape asks first when something typed or picked was
 * not sent. Leaving parks a conversation the person said something in (ADR 0179): coming back to
 * the same studio offers Continue, where it stopped, or Start over. Leaving with nothing said, or
 * after the hand-off, closes the session.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import Button from "@/components/Button";
import ProblemNote from "@/components/ProblemNote";
import type { PlaybookView, PlaybooksModel } from "@/modules/playbooks/model";

import { BriefCard, ResearchTray, SlotsBoard } from "./casepanel";
import Conversation from "./conversation";
import type { AdoptDeps } from "./deps";
import { useAdoptSession } from "./session";
import Showcase from "./showcase";
import { approval, dayOf, phase } from "./state";
import "./adopt.css";

export default function Studio({
  view,
  model,
  deps,
  back,
  intro,
  caseId,
}: {
  view: PlaybookView;
  model: PlaybooksModel;
  deps: AdoptDeps | undefined;
  /** Back to the chore's topic page. */
  back: () => void;
  /** What the person said at the front door (ADR 0098): the session's opening message. */
  intro?: string;
  /** The saved case to reopen (ADR 0123): its slots and approved brief, with no re-interview. */
  caseId?: string;
}) {
  const p = view.playbook;
  const [s, act] = useAdoptSession(deps, p.id, intro, caseId);
  const drafts = useRef(new Set<string>());
  const [asking, setAsking] = useState(false);
  const [aloud, setAloud] = useState(false);
  const [speakWhy, setSpeakWhy] = useState<string | null>(
    "Voice is not set up here",
  );
  const root = useRef<HTMLDivElement>(null);

  const onDraft = useCallback((key: string, unsent: boolean) => {
    if (unsent) drafts.current.add(key);
    else drafts.current.delete(key);
  }, []);

  useEffect(() => {
    const d = deps?.dictation;
    if (!d) return;
    let live = true;
    void d.canSpeak().then(
      (r) => live && setSpeakWhy(r),
      () => live && setSpeakWhy("Voice could not be checked"),
    );
    return () => {
      live = false;
    };
  }, [deps]);

  // Read each new card aloud, when the person asked for it.
  const lastCard = [...s.feed].reverse().find((f) => f.kind === "card");
  const spoken = useRef("");
  useEffect(() => {
    if (
      !aloud ||
      !lastCard ||
      lastCard.kind !== "card" ||
      lastCard.answers ||
      spoken.current === lastCard.key
    )
      return;
    spoken.current = lastCard.key;
    void deps?.dictation
      ?.speak(lastCard.questions.map((q) => q.text).join(" "))
      .catch(() => {});
  }, [aloud, lastCard, deps]);

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

  const gate = approval(s);
  const now = phase(s);
  const approved = now.kind === "approved";
  const trace = p.bench?.trace ?? [];

  const head = (
    <header className="ad-head">
      <div className="ad-head__row">
        <div>
          <p className="pa-eyebrow">{caseId ? "Your case" : "Make it yours"}</p>
          <h1 className="ad-title">{p.shortTitle}</h1>
          <p className="ad-sub">
            She asks what differs in your case, looks the rest up, and shows you
            the run before anything is real.
          </p>
        </div>
        <div className="ad-head__acts">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={aloud}
            onClick={() => setAloud((v) => !v)}
            disabledReason={speakWhy ?? undefined}
          >
            {aloud ? "Reading questions aloud" : "Read questions aloud"}
          </Button>
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
          <span>You have an answer you have not sent. Leave anyway?</span>
          <Button variant="primary" size="sm" onClick={back}>
            Leave
          </Button>
          {/* An alertdialog takes the focus, on the answer that loses nothing. */}
          <Button variant="ghost" size="sm" autoFocus onClick={() => setAsking(false)}>
            Stay
          </Button>
        </div>
      ) : null}
    </header>
  );

  if (deps && s.conn === "parked") {
    return (
      <div className="pa-page ad-page" ref={root}>
        <div className="ad-wrap">
          {head}
          <div className="ad-problem ad-resume" role="group" aria-label="Your earlier conversation">
            <p className="ad-banner">{s.offer}</p>
            <div className="ad-head__acts">
              <Button variant="primary" onClick={act.resume}>
                Continue
              </Button>
              <Button variant="ghost" onClick={act.startOver}>
                Start over
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!deps || s.conn === "failed") {
    const offline = !deps || s.problem?.reason === "offline";
    return (
      <div className="pa-page ad-page" ref={root}>
        <div className="ad-wrap">
          {head}
          <div className="ad-problem">
            <ProblemNote
              title={
                offline
                  ? "The studio needs Athena's daemon, and it is not running."
                  : "The studio could not start."
              }
              reason={
                !deps
                  ? "No daemon is connected to this window."
                  : s.problem?.detail || s.problem?.reason || "unknown"
              }
              detail={
                offline ? "Start it from Mind → Engine, then try again." : null
              }
              onRetry={deps ? act.retry : undefined}
              retryLabel="Try again"
            />
            <Button variant="ghost" onClick={back}>
              Back to the playbook
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pa-page ad-page" ref={root}>
      <div className="ad-wrap">
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
        {s.conn === "closed" ? (
          <p className="ad-banner" role="status">
            {`This conversation has ended (${s.problem?.detail || "closed"}). Close it and start again to continue.`}
          </p>
        ) : null}
        {s.notice ? (
          <p className="ad-banner" role="status">
            {s.notice}
          </p>
        ) : null}
        {s.reopened ? (
          <p className="ad-banner" role="status">
            {`Your case, as you approved it on ${dayOf(s.reopened.approved_at)} (draft ${s.reopened.approved_rev}). What you told her carries over; a date or an amount that may have moved, she asks again.`}
          </p>
        ) : null}
        {approved && s.caseProblem ? (
          <p className="ad-note" role="status">{`Approved, but your case was not saved: ${s.caseProblem}`}</p>
        ) : approved && s.caseId ? (
          <p className="ad-note" role="status">
            Saved as your case. It is on the chore&apos;s page next time, with what you told her.
          </p>
        ) : null}
        <div className="ad-cols">
          <Conversation
            feed={s.feed}
            progress={
              s.conn === "starting"
                ? "Reading the playbook and what she already knows…"
                : s.progress
            }
            dictation={deps.dictation}
            ready={s.conn !== "starting" && s.sid !== ""}
            enough={s.enough}
            onAnswer={act.answer}
            onSay={act.say}
            onDrop={act.drop}
            onEnough={act.enough}
            onDraft={onDraft}
            stage={
              now.kind === "approved" && s.brief ? (
                <Showcase
                  recorded={trace}
                  kinds={p.economics.kinds}
                  portals={s.brief.portals}
                  rehearsal={now.rehearsal}
                  rev={now.rev}
                  handed={now.handed}
                  onStart={() => {
                    // The saved case rides the hand-off, so every turn of the run is filed under it
                    // and its receipt comes back to the chore (ADR 0124).
                    model.actions.hand(s.brief!.command, {
                      id: p.id,
                      title: view.title,
                      ...(s.caseId ? { caseId: s.caseId } : {}),
                    });
                    act.handed(now.rev);
                  }}
                />
              ) : null
            }
          />
          <aside className="ad-case" aria-label="Your case">
            <SlotsBoard slots={s.slots} compact={s.brief !== null} />
            {s.brief ? (
              <BriefCard
                brief={s.brief}
                slots={s.slots}
                can={gate.can}
                why={gate.why}
                approved={approved}
                onApprove={() => s.brief && act.approve(s.brief.rev)}
              />
            ) : null}
            <ResearchTray lanes={s.lanes} />
            {s.usage.calls ? (
              <p className="ad-note ad-usage">{`${s.usage.calls} model ${s.usage.calls === 1 ? "call" : "calls"} so far · ${(s.usage.ms / 1000).toFixed(1)} s`}</p>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
