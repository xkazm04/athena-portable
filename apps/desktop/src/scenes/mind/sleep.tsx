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
 *   kept or forgotten here. Each shows the memory's words, the sentence it was learned from and how
 *   it was used; a contradiction sets its two side by side with "Forget this one" under each, so the
 *   choice is made on what they say, never on an id. An answer is staged, not sent: the rows it
 *   covers leave the list and a bar says what will happen, with an Undo and the seconds left, until
 *   the store sends it. Keep all, shown once two or more forget offers wait, keeps them all in one
 *   press; a forget is only ever one row's;
 * - "Sleep now", whose refusal is the daemon's sentence, shown as it came.
 *
 * {@link SleepSection} is a pure function of a {@link SleepModel} (the store's mirror plus `now`)
 * and of two facts of presentation kept here: which journals are open and which contradiction is
 * asking "which one". {@link LiveSleep} builds the model from `stores/sleep.ts`, started when the
 * section mounts and stopped when it goes. Both are in the Mind depth's lazy chunk; the store is
 * imported from nowhere else.
 */
import { useEffect, useId, useState, type ReactNode } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import ProblemNote from "@/components/ProblemNote";
import type { Tone } from "@/components/StatusDot";
import type { CycleStats, CycleStatus, CycleView, ProposalMemory, ProposalView, SleepPhase, SleepView } from "@/lib/sleep";
import { clockOf, parseStamp, whenAgo } from "@/lib/time";
import {
  loadSleep,
  openProposals,
  readJournal,
  sleepNow,
  stage,
  stageAll,
  startSleep,
  undo,
  useSleep,
  type SleepState,
  type StagedBatch,
} from "@/stores/sleep";

import { Meter } from "./vitals";
import { Refusal } from "./wizard";

/** What the section reads: the store's mirror, the clock, and the acts. */
export interface SleepModel {
  state: Pick<SleepState, "view" | "cycles" | "proposals" | "loaded" | "missing" | "problem" | "journals" | "busy" | "errors" | "answer" | "staged" | "committing">;
  now: number;
  actions: {
    load: () => Promise<void>;
    readJournal: (cycleId: string) => Promise<void>;
    sleepNow: () => Promise<void>;
    /** Answer one proposal, behind the Undo window. */
    stage: (proposalId: string, action: "keep" | "forget", nodeId?: string | null) => void;
    /** Keep every open forget offer, behind one Undo. */
    stageAll: (action: "keep") => void;
    undo: () => void;
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
    n("barred") ? `${figure(n("barred"))} you had her forget left forgotten` : "",
    n("skipped") ? `passed over ${plural(n("skipped"), "episode")} she could not distil` : "",
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

/**
 * The last cycle in a line: when, how it ended, why it ran, and what it did. `stopped` is a
 * `running` row that is not the sleep under way (the app closed on it), read as the journal reads it.
 */
export function lastWords(cycle: CycleView, now: number, stopped = false): string {
  const why = cycle.reason ? (REASON_WORDS[cycle.reason] ?? cycle.reason) : null;
  const head = stopped
    ? `Last sleep, ${whenAgo(endOf(cycle), now)}: stopped before it finished; the app closed while she slept.`
    : cycle.status === "failed"
      ? `Last sleep, ${whenAgo(endOf(cycle), now)}: failed${why ? ` (${why})` : ""}.`
      : `Last sleep, ${whenAgo(endOf(cycle), now)}: ${STATUS_WORD[cycle.status]}${why ? `, because ${why}` : ""}.`;
  const did = statsWords(cycle.stats, cycle.status);
  return did ? `${head} She ${did}.` : head;
}

/** How many steps a memory fades before it is offered to forget (`FADE_MAX`, core/sleep). */
const FADE_STEPS = 3;

/** The day a memory was learned, as "12 Oct"; the stamp as sent when it does not parse. */
function dayWords(raw: string): string {
  const at = parseStamp(raw);
  return at === null ? raw : at.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** How a memory was used: when recall last showed it, or never, and how far it has faded. */
export function usedWords(memory: ProposalMemory, now: number): string {
  const used = memory.recalled_at ? `used ${whenAgo(memory.recalled_at, now)}` : "never used";
  return memory.faded > 0 ? `${used} · faded ${memory.faded} of ${FADE_STEPS}` : used;
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
  return { state, now, actions: { load: loadSleep, readJournal, sleepNow, stage, stageAll, undo } };
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
  const open = openProposals(state);
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
          {/* Until the read shows the cycle this answer began: once it is her last sleep, the
              answer is history, and the state line above says what came of it. */}
          {answer?.admitted && !sleeping && view.last?.id !== answer.cycle_id ? (
            <span className="typo-caption" role="status">
              She is falling asleep.
            </span>
          ) : null}
        </div>
        <Refusal text={state.errors.run} />
      </div>
      {view.last ? (
        <p className="sleep__last typo-body" data-status={view.last.status}>
          {lastWords(view.last, now, view.last.status === "running" && !sleeping)}
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
  const staged = model.state.staged;
  const offers = open.filter((p) => p.kind === "forget").length;
  return (
    <div className="sleep__block">
      <h3 className="sleep__title">Waiting for you</h3>
      {staged ? <UndoBar key={staged.until} staged={staged} onUndo={model.actions.undo} /> : null}
      {offers >= 2 ? (
        <div className="mind__row">
          <Button size="sm" variant="secondary" onClick={() => model.actions.stageAll("keep")}>
            {`Keep all ${offers}`}
          </Button>
          <span className="typo-caption">Every memory offered to forget stays; the disagreements still ask.</span>
        </div>
      ) : null}
      {open.length === 0 ? (
        staged ? null : (
        <p className="typo-caption">
          Nothing waits for you. When a sleep finds a memory she has not used in a long time, or two that disagree, it asks here
          before anything is forgotten.
        </p>
        )
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
  const pair = proposal.kind === "contradiction";
  // An older daemon sends ids only; then the card falls back to naming each side by its place.
  const memories = proposal.memories && proposal.memories.length === proposal.node_ids.length ? proposal.memories : null;
  const answer = (action: "keep" | "forget", nodeId: string | null = null) => {
    onChoose(false);
    model.actions.stage(proposal.id, action, nodeId);
  };
  return (
    <li className="sleep__proposal" data-kind={proposal.kind}>
      <p className="typo-label">{pair ? "Two memories disagree" : "Forget this?"}</p>
      <p className="typo-body">{proposal.summary}</p>
      {memories ? (
        pair ? (
          <div className="sleep__pair" role="group" aria-label="The two memories, side by side">
            {memories.map((memory) => (
              <Memory key={memory.id} memory={memory} now={model.now}>
                {(textId) =>
                  memory.live ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-describedby={textId}
                      onClick={() => answer("forget", memory.id)}
                    >
                      Forget this one
                    </Button>
                  ) : null
                }
              </Memory>
            ))}
          </div>
        ) : (
          memories.map((memory) => <Memory key={memory.id} memory={memory} now={model.now} />)
        )
      ) : (
        <p className="sleep__ids typo-caption">
          {proposal.node_ids.map((id, i) => (
            <span key={id}>
              {i > 0 ? (pair ? " and " : ", ") : null}
              <code className="typo-code">{id}</code>
            </span>
          ))}
        </p>
      )}
      {choosing && !memories ? (
        <div className="mind__row" role="group" aria-label="Which one goes?">
          <span className="typo-body">Which one goes?</span>
          {proposal.node_ids.map((id, i) => (
            <Button key={id} size="sm" variant="secondary" onClick={() => answer("forget", id)}>
              {`Forget the ${ORDINAL[i] ?? `number ${i + 1}`}`}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => onChoose(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mind__row">
          <Button size="sm" variant="secondary" onClick={() => answer("keep")}>
            {pair ? "Keep both" : "Keep"}
          </Button>
          {pair && memories ? null : (
            <Button size="sm" variant="ghost" onClick={() => (pair ? onChoose(true) : answer("forget"))}>
              {pair ? "Forget one…" : "Forget"}
            </Button>
          )}
        </div>
      )}
      <Refusal text={model.state.errors[proposal.id]} />
    </li>
  );
}

/**
 * What a staged batch will do, with its Undo and the seconds left, counted from when it was staged
 * on the store's clock. The count is the live region; the seconds tick beside it, outside it, so a
 * screen reader hears the decision once, not each second.
 */
function UndoBar({ staged, onUndo }: { staged: StagedBatch; onUndo: () => void }) {
  const [ticked, setTicked] = useState<number | null>(null);
  useEffect(() => {
    const beat = setInterval(() => setTicked(Date.now()), 1000);
    return () => clearInterval(beat);
  }, []);
  const clock = ticked !== null && ticked > staged.at ? ticked : staged.at;
  const left = Math.max(0, Math.ceil((staged.until - clock) / 1000));
  const n = staged.ids.length;
  return (
    <div className="sleep__undo mind__row">
      <span className="typo-body" role="status">
        {`${staged.action === "forget" ? "Forgetting" : "Keeping"} ${figure(n)} · `}
      </span>
      <Button size="sm" variant="secondary" onClick={onUndo}>
        Undo
      </Button>
      <span className="typo-caption">{`${left} s left`}</span>
    </div>
  );
}

/** An older daemon's contradiction names its two sides by place, never by id. */
const ORDINAL: readonly string[] = ["first", "second"];

/**
 * One memory as a person weighs it: its words, the day it was learned and the sentence it came
 * from, and how it has been used. `children` gets the id of the words, for a button they describe.
 */
function Memory({ memory, now, children }: { memory: ProposalMemory; now: number; children?: (textId: string) => ReactNode }) {
  const textId = useId();
  const shown = memory.live && memory.text !== null;
  return (
    <div className="sleep__side" data-live={memory.live ? undefined : "false"}>
      <p id={textId} className={shown ? "sleep__text typo-body" : "typo-caption"}>
        {shown ? memory.text : "This memory is no longer there."}
      </p>
      {shown ? (
        <>
          <p className="typo-caption">
            {memory.created_at ? `learned ${dayWords(memory.created_at)}` : "learned"}
            {memory.quote ? " from:" : memory.sources > 0 ? `, from ${plural(memory.sources, "episode")}` : ""}
          </p>
          {memory.quote ? <blockquote className="sleep__quote typo-caption">{`"${memory.quote}"`}</blockquote> : null}
          <p className="typo-caption">{usedWords(memory, now)}</p>
        </>
      ) : null}
      {children ? children(textId) : null}
    </div>
  );
}

function Journal({ model, opening }: { model: SleepModel; opening: SleepOpening }) {
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set(opening.journal ? [opening.journal] : []));
  const { cycles, view } = model.state;
  // Only the newest running row is a sleep under way, and only while she sleeps. Any other
  // `running` row is one the app closed on: the daemon keeps it as evidence (ADR 0143) and it
  // reads here as stopped, never as "still going" for good.
  const live = view?.state === "sleeping" ? (cycles.find((c) => c.status === "running")?.id ?? null) : null;
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
            <CycleRow
              key={cycle.id}
              model={model}
              cycle={cycle}
              stopped={cycle.status === "running" && cycle.id !== live}
              open={shown.has(cycle.id)}
              onToggle={() => toggle(cycle.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CycleRow({
  model,
  cycle,
  stopped,
  open,
  onToggle,
}: {
  model: SleepModel;
  cycle: CycleView;
  /** A `running` row that is not the sleep under way: the app closed before it finished. */
  stopped: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const body = useId();
  const journal = model.state.journals[cycle.id];
  const did = statsWords(cycle.stats, cycle.status);
  return (
    <li className="sleep__cycle" data-status={cycle.status}>
      <button type="button" className="sleep__row focus-ring" aria-expanded={open} aria-controls={open ? body : undefined} onClick={onToggle}>
        <span className="sleep__when typo-data">{startedWords(cycle)}</span>
        <Badge tone={stopped ? "warning" : STATUS_TONE[cycle.status]}>{stopped ? "stopped" : STATUS_WORD[cycle.status]}</Badge>
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
            <p className="typo-caption">{stopped
                ? "She stopped before finishing this one: the app closed while she slept."
                : cycle.status === "running"
                  ? "She is still writing this one."
                  : "No journal was written for this sleep."}</p>
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
