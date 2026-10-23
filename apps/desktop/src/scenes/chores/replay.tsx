/**
 * The replay of a run, at one turn — README section 3.5, ADR 0040, 0053, 0087 and 0089.
 *
 * The sub-level of a chore (`chores/<chore>/run/<turn>`). The turn is the place, so a link opens at
 * it and the breadcrumb names it; stepping is a move to the next place. A route of tab visits, a
 * dot for every turn (its shape says what she did there: filed wrong, filed, read, only spoke —
 * never colour alone), the turn itself (what the person said, her words, what she read, the cards
 * the gate filed with the scorer's word on each) and the money back her right cards were worth so far
 * (money back only; a card of another kind says its own words, a weight none, ADR 0133).
 * Play steps on its own; Back and Next, the dots and ArrowLeft and ArrowRight step by hand and
 * stop it. The ledger lists every card of the run, folded, with a way to show all.
 *
 * Because each step is a move, the scene is remounted at every one; whether it is playing is
 * therefore kept in a tiny store beside it, which goes stale on its own if the person leaves.
 * No timer here asks for animation frames.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import Button from "@/components/Button";
import StatusDot from "@/components/StatusDot";
import type { Path } from "@/depth/model";
import { kindOf, usd } from "@/lib/playbooks";
import { OUTCOME_WORDS, type PlaybookView } from "@/modules/playbooks/model";
import { foundBy, turnState, visitsOf, type TurnState } from "@/modules/playbooks/replay";

import { runPath } from "./model";
import { cardValue } from "./worth";
import TurnView from "./turn";

/** How long the replay holds a turn before the next, when it plays on its own. */
export const REPLAY_STEP_MS = 2800;

// -- whether it is playing: outlives the remount at every step ------------------------------------

interface Playing {
  id: string | null;
  /** When it last stepped or was started. */
  at: number;
}
let playing: Playing = { id: null, at: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** True for `id` while it has been started and stepped within the last two steps' time. */
export function isPlaying(id: string, now = Date.now()): boolean {
  return playing.id === id && now - playing.at < REPLAY_STEP_MS * 2;
}
export function setPlaying(id: string | null, now = Date.now()) {
  playing = { id, at: now };
  emit();
}
/** For tests: forget it. */
export function stopPlaying() {
  setPlaying(null);
}

function usePlaying(id: string): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => isPlaying(id),
    () => false,
  );
}

const STATE_WORDS: Record<TurnState, string> = {
  wrong: "filed a wrong card",
  filed: "filed",
  read: "read",
  spoke: "only spoke",
};

/** Cards the whole-run ledger shows before it folds. */
export const LEDGER_SHOWN = 6;

export default function Replay({
  view,
  turn,
  go,
}: {
  view: PlaybookView;
  /** 0-based. */
  turn: number;
  go: (to: Path) => void;
}) {
  const trace = view.playbook.bench?.trace ?? [];
  const last = trace.length - 1;
  const at = Math.max(0, Math.min(last, turn));
  const live = usePlaying(view.id);
  const root = useRef<HTMLDivElement>(null);
  const [all, setAll] = useState(false);

  const step = (i: number) => go(runPath(view.id, Math.max(0, Math.min(last, i))));
  const stepByHand = (i: number) => {
    setPlaying(null);
    step(i);
  };

  // Play: one timer for the turn on show. A step is a move that remounts this scene; the new one
  // reads `playing` and sets its own timer. The check at the end is for a timer that outlived a
  // press of Back or Next, or a layer that is already leaving.
  useEffect(() => {
    if (!live || at >= last) {
      if (live && at >= last) setPlaying(null);
      return;
    }
    const timer = window.setTimeout(() => {
      if (!isPlaying(view.id) || root.current?.closest("[inert]")) return;
      setPlaying(view.id);
      step(at + 1);
    }, REPLAY_STEP_MS);
    return () => window.clearTimeout(timer);
    // `step` closes over go and the ids, which do not change while this turn is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, at, last, view.id]);

  // ArrowLeft and ArrowRight, anywhere in the scene: the stage keeps focus on its layer, so the
  // key arrives at the document. A leaving layer is inert and does not answer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (root.current?.closest("[inert]")) return;
      if (e.key === "ArrowRight") stepByHand(at + 1);
      else if (e.key === "ArrowLeft") stepByHand(at - 1);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, last, view.id]);

  const t = trace[at];
  if (t === undefined) return null;
  const visits = visitsOf(trace);
  const kind = (tool: string) => kindOf(view.playbook, tool);
  const found = foundBy(trace, at, kind);
  // A run with no money-back card says how many right cards so far, never "$0 back".
  const money = trace.some((tt) => tt.cards.some((c) => c.valueUsd && kind(c.action) === "money_back"));
  const right = trace.slice(0, at + 1).reduce((n, tt) => n + tt.cards.filter((c) => c.outcome === "correct").length, 0);
  const play = () => {
    if (at >= last) {
      setPlaying(view.id);
      step(0);
    } else if (live) setPlaying(null);
    else setPlaying(view.id);
  };

  const ledger = trace.flatMap((tt, i) => tt.cards.map((c, k) => ({ turn: i, card: c, k })));
  const ledgerShown = all ? ledger : ledger.slice(0, LEDGER_SHOWN);

  return (
    <div className="chores ch-run" ref={root}>
      <header className="ch-run__top">
        <p className="ch-eyebrow">{`${view.title} · the run`}</p>
        <h1 className="ch-marquee ch-marquee--run">
          {`Turn ${at + 1}`}
          <span className="ch-marquee__of">{` of ${trace.length}`}</span>
        </h1>
        <p className="ch-line">
          <span className="ch-chip">{t.portal}</span>
        </p>
        {money ? (
          <p className="ch-found" title="The money back her right cards were worth so far, in the invented example">
            <span className="ch-found__n">{usd(found)}</span>
            <span className="ch-note">back so far, in the test run</span>
          </p>
        ) : (
          <p className="ch-found" title="Her right cards so far, in the invented example">
            <span className="ch-found__n">{right}</span>
            <span className="ch-note">{`${right === 1 ? "item" : "items"} found so far, in the test run`}</span>
          </p>
        )}
      </header>

      <ol className="ch-rail" aria-label="Turns, by tab">
        {visits.map((v) => (
          <li key={`${v.portal}-${v.from}`} className="ch-rail__visit" data-here={at >= v.from && at <= v.to ? "" : undefined}>
            <span className="ch-rail__name ch-label" title={v.portal}>
              {v.portal}
            </span>
            <span className="ch-rail__dots">
              {trace.slice(v.from, v.to + 1).map((tt, k) => {
                const i = v.from + k;
                const state = turnState(tt);
                return (
                  <button
                    key={i}
                    type="button"
                    className="ch-dot focus-ring"
                    data-state={state}
                    data-past={i < at ? "" : undefined}
                    aria-current={i === at ? "step" : undefined}
                    aria-label={`Turn ${i + 1}, ${tt.portal}, ${STATE_WORDS[state]}`}
                    onClick={() => stepByHand(i)}
                  />
                );
              })}
            </span>
          </li>
        ))}
      </ol>
      <p className="ch-legend ch-legend--dots" aria-hidden="true">
        <span><i className="ch-key" data-state="spoke" /> only spoke</span>
        <span><i className="ch-key" data-state="read" /> read</span>
        <span><i className="ch-key" data-state="filed" /> filed</span>
        <span><i className="ch-key" data-state="wrong" /> filed a wrong card</span>
      </p>

      <div className="ch-controls">
        <Button size="sm" variant={live ? "ghost" : "primary"} onClick={play}>
          {live ? "Pause" : at >= last ? "Replay" : "Play"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => stepByHand(at - 1)}
          disabledReason={at === 0 ? "This is the first turn" : undefined}
        >
          Back
        </Button>
        <span className="ch-progress" aria-hidden="true">
          <span style={{ ["--at" as string]: trace.length > 1 ? at / last : 1 }} />
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => stepByHand(at + 1)}
          disabledReason={at >= last ? "This is the last turn" : undefined}
        >
          Next
        </Button>
        <span className="ch-note">Left and right arrows step.</span>
      </div>

      <div className="ch-run__stage">
        <TurnView key={at} kind={kind} turn={t} at={at} total={trace.length} />

        <section className="ch-ledger" aria-label="Every card of this run">
          <h2 className="ch-title">The cards, turn by turn</h2>
          {ledger.length === 0 ? (
            <p className="ch-note">She filed no card in this run.</p>
          ) : (
            <>
              <ul className="ch-ledger__list">
                {ledgerShown.map(({ turn: i, card: c, k }) => (
                  <li key={`${i}-${k}`} data-here={i === at ? "" : undefined}>
                    <button type="button" className="ch-ledger__row focus-ring" onClick={() => stepByHand(i)}>
                      <StatusDot tone={OUTCOME_WORDS[c.outcome].tone} />
                      <span className="ch-data">{`Turn ${i + 1}`}</span>
                      <span className="ch-code">{c.key || c.action}</span>
                      <span className="ch-note">{OUTCOME_WORDS[c.outcome].word}</span>
                      <span className="ch-data ch-card__v">{cardValue(kind(c.action), c.valueUsd)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {ledger.length > LEDGER_SHOWN ? (
                <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
                  {all ? "Show fewer" : `Show all ${ledger.length} (showing ${LEDGER_SHOWN} of ${ledger.length})`}
                </Button>
              ) : null}
            </>
          )}
        </section>
      </div>

    </div>
  );
}
