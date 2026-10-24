/**
 * Her sleep, on the Brain level under Mind - device-vitals (ADR 0143, `src/athena/core/sleep/`).
 *
 * Each PC sleeps on the episodes it wrote itself: when enough new conversation has piled up, a
 * cycle distils it into facts and procedures, checks each against what she already knows, and lets
 * what has gone unused fade. This section is where a person sees that happen and is asked what a
 * cycle would not decide alone:
 *
 * - how near the next sleep is (a gauge of the characters waiting over the threshold), and the
 *   daemon's own sentence for why she is or is not asleep (the admission verdict);
 * - while she sleeps, which of the three phases she is in;
 * - the last cycle in a line, and the journal of each cycle, opened row by row;
 * - the proposals a cycle left - forget a memory gone unused, or settle two that disagree - each
 *   kept or forgotten here, a contradiction's forget asking which of the two goes;
 * - "Sleep now", whose refusal is the daemon's sentence, shown as it came.
 *
 * {@link SleepSection} is a pure function of a {@link SleepModel} (the store's mirror plus `now`)
 * and of two facts of presentation kept here: which journals are open and which contradiction is
 * asking "which one". {@link LiveSleep} builds the model from `stores/sleep.ts`, started when the
 * section mounts and stopped when it goes. Both are in the Mind depth's lazy chunk; the store is
 * imported from nowhere else.
 */
import { useEffect, useId, useState } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import ProblemNote from "@/components/ProblemNote";
import type { Tone } from "@/components/StatusDot";
import type { CycleStats, CycleStatus, CycleView, ProposalView, SleepPhase, SleepView } from "@/lib/sleep";
import { clockOf, parseStamp, whenAgo } from "@/lib/time";
import { decide, readJournal, sleepNow, startSleep, loadSleep, useSleep, type SleepState } from "@/stores/sleep";

import { Meter } from "./vitals";
import { Refusal } from "./wizard";

/** What the section reads: the store's mirror, the clock, and the acts. */
export interface SleepModel {
  state: Pick<SleepState, "view" | "cycles" | "proposals" | "loaded" | "missing" | "problem" | "journals" | "busy" | "errors" | "answer">;
  now: number;
  actions: {
    load: () => Promise<void>;
    readJournal: (cycleId: string) => Promise<void>;
    sleepNow: () => Promise<void>;
    decide: (proposalId: string, action: "keep" | "forget", nodeId?: string | null) => Promise<void>;
  };
}

/** What a test or a preview opens the section on; a person starts with every row closed. */
export interface SleepOpening {
  journal?: string;
  choosing?: string;
}

/** The three legs of a cycle, in order, and what each does in a person's words. */
export const PHASES: readonly SleepPhase[] = ["compress", "merge", "fade"];
const PHASE_NAME: Readonly<Record<SleepPhase, string>> = { compress: "Distil", merge: "Merge", fade: "Fade" };
export const PHASE_WORDS: Readonly<Record<SleepPhase, string>> = {
  compress: "turning her episodes into facts and procedures",
  merge: "checking them against what she already knows",
  fade: "letting what she has not used fade",
};

const STATUS_WORD: Readonly<Record<CycleStatus, string>> = {
  running: "still going",
  completed: "finished",
  partial: "finished in part",
  failed: "failed",
};
const STATUS_TONE: Readonly<Record<CycleStatus, Tone>> = {
  running: "pending",
  completed: "success",
  partial: "warning",
  failed: "error",
};

/** Why a cycle ran, from its admission reason; a reason this window does not know is shown as sent. */
const REASON_WORDS: Readonly<Record<string, string>> = {
  pressure: "enough had piled up",
  first: "her first",
  stale: "three days had passed",
  forced: "you asked",
};

const figure = (n: number) => Math.round(n).toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${figure(n)} ${n === 1 ? one : many}`;

/** What a cycle did, the parts that are not zero: "read 12 episodes · wrote 4 facts, 1 procedure · confirmed 2". */
export function statsWords(stats: Partial<CycleStats> | null, status: CycleStatus): string | null {
  if (!stats) return null;
  const n = (k: keyof CycleStats) => {
    const v = stats[k];
    return typeof v === "number" ? v : 0;
  };
  const read =
    n("episodes_in") === 0
      ? ""
      : status === "partial" && n("episodes_available") > n("episodes_in")
        ? `read ${figure(n("episodes_in"))} of ${plural(n("episodes_available"), "episode")}; the rest wait for the next`
        : `read ${plural(n("episodes_in"), "episode")}`;
  const wrote = [n("facts_written") ? plural(n("facts_written"), "fact") : "", n("procedurals_written") ? plural(n("procedurals_written"), "procedure") : ""]
    .filter(Boolean)
    .join(", ");
  const parts = [
    read,
    wrote ? `wrote ${wrote}` : "",
    n("duplicates") ? `confirmed ${figure(n("duplicates"))}` : "",
    n("supersedes") ? `replaced ${figure(n("supersedes"))}` : "",
    n("contradictions") ? plural(n("contradictions"), "disagreement") : "",
    n("faded") ? `${figure(n("faded"))} faded` : "",
    n("forget_proposed") ? `${figure(n("forget_proposed"))} offered to forget` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** When a cycle ended, or began while it runs. */
const endOf = (cycle: CycleView) => cycle.finished_at ?? cycle.started_at;

/** The state line at the top: asleep and in which phase, or when she last slept, or never. */
export function stateLine(view: SleepView, now: number): string {
  if (view.state === "sleeping") return `Sleeping now: ${view.phase ? PHASE_WORDS[view.phase] : "falling asleep"}.`;
  if (view.state === "never" || !view.last) return "She has not slept yet.";
  if (view.state === "failed") return `Her last sleep failed, ${whenAgo(endOf(view.last), now)}.`;
  return `She last slept ${whenAgo(endOf(view.last), now)}.`;
}

/** The gauge's caption: what is waiting and where she sleeps, in characters a person can picture. */
export function pressureWords(view: SleepView): string {
  const at = figure(view.threshold_chars);
  if (view.pressure_chars <= 0) return `Nothing new to sleep on yet; she sleeps at ${at} characters.`;
  const from = view.episodes_waiting > 0 ? `, from ${plural(view.episodes_waiting, "episode")}` : "";
  return `She has ${figure(view.pressure_chars)} characters of new conversation to sleep on${from}; she sleeps at ${at}.`;
}

/** The last cycle in a line: when, how it ended, why it ran, and what it did. */
export function lastWords(cycle: CycleView, now: number): string {
  const why = cycle.reason ? (REASON_WORDS[cycle.reason] ?? cycle.reason) : null;
  const head =
    cycle.status === "failed"
      ? `Last sleep, ${whenAgo(endOf(cycle), now)}: failed${why ? ` (${why})` : ""}.`
      : `Last sleep, ${whenAgo(endOf(cycle), now)}: ${STATUS_WORD[cycle.status]}${why ? `, because ${why}` : ""}.`;
  const did = statsWords(cycle.stats, cycle.status);
  return did ? `${head} She ${did}.` : head;
}

/** The day and clock a cycle began, for its journal row. */
function startedWords(cycle: CycleView): string {
  const at = parseStamp(cycle.started_at);
  if (at === null) return cycle.started_at;
  return `${at.toLocaleDateString([], { month: "short", day: "numeric" })}, ${clockOf(cycle.started_at)}`;
}

/** The store in, a model out: started while the section is shown, `now` moving each half minute. */
function useSleepModel(): SleepModel {
  const state = useSleep();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => startSleep(), []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return { state, now, actions: { load: loadSleep, readJournal, sleepNow, decide } };
}

/** The section on the live store. */
export function LiveSleep() {
  return <SleepSection model={useSleepModel()} />;
}

export default function SleepSection({ model, opening = {} }: { model: SleepModel; opening?: SleepOpening }) {
  const { state } = model;
  if (state.missing) return null;
  return (
    <section className="mind__section sleep" aria-labelledby="mind-sleep">
      <h2 id="mind-sleep">Sleep</h2>
      {state.view === null ? (
        state.problem ? (
          <ProblemNote
            title="Athena could not read how she sleeps."
            reason={state.problem}
            onRetry={() => void model.actions.load()}
            retryLabel="Read again"
          />
        ) : (
          <p className="typo-caption" role="status">
            Reading how she sleeps…
          </p>
        )
      ) : (
        <Sleep model={model} view={state.view} opening={opening} />
      )}
    </section>
  );
}

function Sleep({ model, view, opening }: { model: SleepModel; view: SleepView; opening: SleepOpening }) {
  const { state, now } = model;
  const sleeping = view.state === "sleeping";
  const pressure = view.threshold_chars > 0 ? view.pressure_chars / view.threshold_chars : null;
  const answer = state.answer;
  const open = state.proposals.filter((p) => p.status === "open");
  return (
    <>
      {state.problem ? (
        <ProblemNote
          title="What is shown may be out of date: the last read failed."
          reason={state.problem}
          onRetry={() => void model.actions.load()}
          retryLabel="Read again"
        />
      ) : null}
      <div className="sleep__now" data-state={view.state}>
        <p className="sleep__state typo-body" role="status" aria-live="polite">
          {stateLine(view, now)}
        </p>
        {sleeping ? <Phases phase={view.phase} /> : null}
        {view.state === "never" ? (
          <p className="typo-caption">
            She sleeps by herself once enough new conversation has piled up, while this computer is quiet, on mains power and has
            room.
          </p>
        ) : null}
        <Meter
          wide
          label="How close her next sleep is"
          value={pressure}
          text={pressure === null ? "unknown" : `${Math.round(pressure * 100)}%`}
          high={pressure !== null && pressure >= 1}
        />
        <p className="typo-caption">{pressureWords(view)}</p>
        {sleeping ? null : <p className="sleep__why typo-body">{view.verdict.text}</p>}
        <div className="mind__row">
          <Button
            size="sm"
            variant="secondary"
            disabledReason={sleeping ? "She is asleep now." : state.busy.run ? "Asking her…" : undefined}
            onClick={() => void model.actions.sleepNow()}
          >
            Sleep now
          </Button>
          {answer && !answer.admitted ? (
            <span className="typo-caption" role="status">
              {answer.text}
            </span>
          ) : null}
          {answer?.admitted && !sleeping ? (
            <span className="typo-caption" role="status">
              She is falling asleep.
            </span>
          ) : null}
        </div>
        <Refusal text={state.errors.run} />
      </div>
      {view.last ? (
        <p className="sleep__last typo-body" data-status={view.last.status}>
          {lastWords(view.last, now)}
        </p>
      ) : null}
      <Proposals model={model} open={open} opening={opening} />
      <Journal model={model} opening={opening} />
    </>
  );
}

/** The three legs as a small rail: the one she is in lit, the ones behind her done. */
function Phases({ phase }: { phase: SleepPhase | null }) {
  const at = phase ? PHASES.indexOf(phase) : -1;
  return (
    <ol className="sleep__phases" aria-label="The three parts of a sleep">
      {PHASES.map((p, i) => (
        <li key={p} data-state={i < at ? "done" : i === at ? "now" : "next"} aria-current={i === at ? "step" : undefined}>
          {PHASE_NAME[p]}
        </li>
      ))}
    </ol>
  );
}

function Proposals({ model, open, opening }: { model: SleepModel; open: readonly ProposalView[]; opening: SleepOpening }) {
  const [choosing, setChoosing] = useState<string | null>(opening.choosing ?? null);
  return (
    <div className="sleep__block">
      <h3 className="sleep__title">Waiting for you</h3>
      {open.length === 0 ? (
        <p className="typo-caption">
          Nothing waits for you. When a sleep finds a memory she has not used in a long time, or two that disagree, it asks here
          before anything is forgotten.
        </p>
      ) : (
        <ul className="sleep__proposals">
          {open.map((p) => (
            <Proposal
              key={p.id}
              model={model}
              proposal={p}
              choosing={choosing === p.id}
              onChoose={(on) => setChoosing(on ? p.id : null)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Proposal({
  model,
  proposal,
  choosing,
  onChoose,
}: {
  model: SleepModel;
  proposal: ProposalView;
  choosing: boolean;
  onChoose: (on: boolean) => void;
}) {
  const busy = model.state.busy[proposal.id] ? "Answering…" : undefined;
  const pair = proposal.kind === "contradiction";
  const answer = (action: "keep" | "forget", nodeId: string | null = null) => {
    onChoose(false);
    void model.actions.decide(proposal.id, action, nodeId);
  };
  return (
    <li className="sleep__proposal" data-kind={proposal.kind}>
      <p className="typo-label">{pair ? "Two memories disagree" : "Forget this?"}</p>
      <p className="typo-body">{proposal.summary}</p>
      <p className="sleep__ids typo-caption">
        {proposal.node_ids.map((id, i) => (
          <span key={id}>
            {i > 0 ? (pair ? " and " : ", ") : null}
            <code className="typo-code">{id}</code>
          </span>
        ))}
      </p>
      {choosing ? (
        <div className="mind__row" role="group" aria-label="Which one goes?">
          <span className="typo-body">Which one goes?</span>
          {proposal.node_ids.map((id) => (
            <Button key={id} size="sm" variant="secondary" disabledReason={busy} onClick={() => answer("forget", id)}>
              {`Forget ${id}`}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => onChoose(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mind__row">
          <Button size="sm" variant="secondary" disabledReason={busy} onClick={() => answer("keep")}>
            {pair ? "Keep both" : "Keep"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabledReason={busy}
            onClick={() => (pair ? onChoose(true) : answer("forget"))}
          >
            {pair ? "Forget one…" : "Forget"}
          </Button>
        </div>
      )}
      <Refusal text={model.state.errors[proposal.id]} />
    </li>
  );
}

function Journal({ model, opening }: { model: SleepModel; opening: SleepOpening }) {
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set(opening.journal ? [opening.journal] : []));
  const { cycles } = model.state;
  const toggle = (id: string) => {
    const next = new Set(shown);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      void model.actions.readJournal(id);
    }
    setShown(next);
  };
  return (
    <div className="sleep__block">
      <h3 className="sleep__title">Her journal</h3>
      {cycles.length === 0 ? (
        <p className="typo-caption">No sleep yet, so nothing is written here. Each sleep writes what it read and what it kept.</p>
      ) : (
        <ul className="sleep__cycles">
          {cycles.map((cycle) => (
            <CycleRow key={cycle.id} model={model} cycle={cycle} open={shown.has(cycle.id)} onToggle={() => toggle(cycle.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CycleRow({ model, cycle, open, onToggle }: { model: SleepModel; cycle: CycleView; open: boolean; onToggle: () => void }) {
  const body = useId();
  const journal = model.state.journals[cycle.id];
  const did = statsWords(cycle.stats, cycle.status);
  return (
    <li className="sleep__cycle" data-status={cycle.status}>
      <button type="button" className="sleep__row focus-ring" aria-expanded={open} aria-controls={open ? body : undefined} onClick={onToggle}>
        <span className="sleep__when typo-data">{startedWords(cycle)}</span>
        <Badge tone={STATUS_TONE[cycle.status]}>{STATUS_WORD[cycle.status]}</Badge>
        <span className="sleep__did typo-caption">{did ?? (cycle.status === "failed" && cycle.reason ? cycle.reason : "")}</span>
        <span className="sleep__chev" aria-hidden="true" />
      </button>
      {open ? (
        <div id={body} className="sleep__entry">
          {!journal || journal.loading ? (
            <p className="typo-caption" role="status">
              Reading the journal…
            </p>
          ) : journal.problem ? (
            <ProblemNote
              title="The journal could not be read."
              reason={journal.problem}
              onRetry={() => void model.actions.readJournal(cycle.id)}
              retryLabel="Read again"
            />
          ) : journal.text === null || journal.text.trim() === "" ? (
            <p className="typo-caption">{cycle.status === "running" ? "She is still writing this one." : "No journal was written for this sleep."}</p>
          ) : (
            <pre className="sleep__journal focus-ring" tabIndex={0} aria-label={`The journal of the sleep on ${startedWords(cycle)}`}>
              {journal.text}
            </pre>
          )}
        </div>
      ) : null}
    </li>
  );
}
