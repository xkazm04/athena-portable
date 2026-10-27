/**
 * "When it comes due" on a chore's topic page — ADR 0131.
 *
 * Under each saved case: the cadence she set (or the one the playbook suggests, which is applied only
 * when she presses it), pause and resume, and the review a due occurrence opened. The review is the
 * daemon's, assembled with no model call from the case file and its last receipt: what to check
 * first, what was approved and declined, the next due date. "Open and prepare" opens the chore's
 * tabs and puts the case's command in Athena's composer; nothing is sent until she presses send.
 * A card's parameters and a "may have completed" record are page text: shown fenced, as text.
 */
import { useCallback, useEffect, useState } from "react";

import Button from "@/components/Button";
import type { CadenceReply, CadenceRule, CadenceKind, DueReview } from "@/lib/adopt";
import type { ChoresClient } from "@/lib/chores-client";
import type { PlaybookActions } from "@/modules/playbooks/model";

import { why } from "./adopt/session";
import { dayOf } from "./adopt/state";
import {
  LINE_WORDS,
  WEEKDAYS,
  dueLine,
  localWhen,
  localZone,
  openAndPrepare,
  orderedLines,
  portalsOf,
  ruleWords,
} from "./due-model";

type Loaded =
  | { kind: "looking" }
  | { kind: "found"; cadence: CadenceReply; review: DueReview | null }
  | { kind: "failed"; detail: string };

function failure(error: unknown): string {
  const w = why(error);
  return w.reason === "offline" ? "the daemon is not running" : w.detail || w.reason;
}

/** The pause-or-slow prompt, the review's head, its lines and its two buttons. Pure. */
export function ReviewView({
  review,
  onPrepare,
  onSkip,
  onPause,
  onSlow,
  said,
}: {
  review: DueReview;
  onPrepare: () => void;
  onSkip: () => void;
  onPause: () => void;
  onSlow: () => void;
  said: string;
}) {
  const lines = orderedLines(review.lines);
  const { unknown } = portalsOf(review);
  return (
    <div className="pa-run pa-due__review" aria-label="This chore is due">
      <span className="pa-case__title">{dueLine(review)}</span>
      {review.ask_slow ? (
        <div className="pa-run__line" role="note">
          <p>{`It came due ${review.unanswered} times without an answer. Pause or slow this chore?`}</p>
          <div className="pa-adopt__row">
            <Button size="sm" variant="secondary" onClick={onPause}>
              Pause it
            </Button>
            <Button size="sm" variant="ghost" onClick={onSlow}>
              Slow it
            </Button>
          </div>
        </div>
      ) : null}
      {review.last_run_at ? (
        <p className="pa-run__line">{`From your last run, closed ${dayOf(review.last_run_at)}:`}</p>
      ) : (
        <p className="pa-run__line">No run of this case has closed yet, so there is nothing to check from one.</p>
      )}
      {lines.length ? (
        <ul className="pa-run__cards">
          {lines.map((l, i) => (
            <li key={`${l.kind}-${i}`} className="pa-run__card" data-kind={l.kind}>
              <span className="pa-run__status">{LINE_WORDS[l.kind]}</span>
              {l.action ? <span className="pa-run__action">{l.action}</span> : null}
              {l.at ? <span className="pa-run__status">{dayOf(l.at)}</span> : null}
              {l.text || Object.keys(l.params).length ? (
                <pre className="pa-run__params" aria-label="What the record says">
                  {l.text ||
                    Object.entries(l.params)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join("\n")}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {review.lines_footer ? <p className="pa-muted">{review.lines_footer}</p> : null}
      {review.next_run_at ? (
        <p className="pa-run__line">{`Next due ${localWhen(review.next_run_at)}.`}</p>
      ) : null}
      {unknown.length ? (
        <p className="pa-muted">{`No address is known for ${unknown.join(", ")}: open ${unknown.length === 1 ? "it" : "them"} yourself.`}</p>
      ) : null}
      <div className="pa-adopt__row">
        <Button variant="primary" onClick={onPrepare}>
          Open and prepare
        </Button>
        <Button variant="ghost" onClick={onSkip}>
          Skip this one
        </Button>
      </div>
      <p className="pa-muted pa-said" role="status">
        {said}
      </p>
    </div>
  );
}

const KINDS: { kind: CadenceKind; label: string }[] = [
  { kind: "weekly", label: "Every week" },
  { kind: "monthly", label: "Every month" },
  { kind: "every_days", label: "Every N days" },
];

/** Her own rule: one kind, one number, one time. Saved only on her press. */
function RuleForm({
  start,
  onSave,
  onCancel,
}: {
  start: CadenceRule;
  onSave: (rule: CadenceRule) => void;
  onCancel: () => void;
}) {
  const [rule, setRule] = useState<CadenceRule>(start);
  const n = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.parseInt(v, 10) || lo));
  return (
    <div className="pa-due__form">
      <select
        aria-label="How often"
        value={rule.kind}
        onChange={(e) => setRule({ ...rule, kind: e.target.value as CadenceKind })}
      >
        {KINDS.map((k) => (
          <option key={k.kind} value={k.kind}>
            {k.label}
          </option>
        ))}
      </select>
      {rule.kind === "weekly" ? (
        <select
          aria-label="On"
          value={rule.weekday}
          onChange={(e) => setRule({ ...rule, weekday: Number(e.target.value) })}
        >
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
      ) : rule.kind === "monthly" ? (
        <input
          aria-label="Day of the month"
          type="number"
          min={1}
          max={31}
          value={rule.day}
          onChange={(e) => setRule({ ...rule, day: n(e.target.value, 1, 31) })}
        />
      ) : (
        <input
          aria-label="Every how many days"
          type="number"
          min={1}
          max={366}
          value={rule.every_days || 7}
          onChange={(e) => setRule({ ...rule, every_days: n(e.target.value, 1, 366) })}
        />
      )}
      <input aria-label="At" type="time" value={rule.at} onChange={(e) => setRule({ ...rule, at: e.target.value || "09:00" })} />
      <Button size="sm" variant="primary" onClick={() => onSave({ ...rule, every_days: rule.kind === "every_days" ? rule.every_days || 7 : 0 })}>
        {`Save: ${ruleWords(rule)}`}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

const DEFAULT_RULE: CadenceRule = { kind: "weekly", weekday: 0, day: 1, every_days: 0, start: "", at: "09:00" };

/** "When it comes due" for one saved case. */
export default function Due({
  chores,
  caseId,
  spaceId = "",
  actions,
}: {
  chores: ChoresClient;
  caseId: string;
  /** The Project the case is linked to (ADR 0225): "Open and prepare" enters it. */
  spaceId?: string;
  actions: Pick<PlaybookActions, "open" | "hand">;
}) {
  const [state, setState] = useState<Loaded>({ kind: "looking" });
  const [editing, setEditing] = useState(false);
  const [said, setSaid] = useState("");
  const load = useCallback(() => {
    let live = true;
    Promise.all([chores.cadence(caseId), chores.review(caseId)]).then(
      ([cadence, review]) => live && setState({ kind: "found", cadence, review }),
      (error: unknown) => live && setState({ kind: "failed", detail: failure(error) }),
    );
    return () => {
      live = false;
    };
  }, [chores, caseId]);
  useEffect(() => load(), [load]);

  // A change or an answer that went through clears what an earlier refusal said.
  const change = (body: { rule?: CadenceRule; timezone?: string; enabled?: boolean }) =>
    void chores.setCadence(caseId, body).then(
      () => {
        setSaid("");
        setEditing(false);
        load();
      },
      (error: unknown) => setSaid(`That was not saved: ${failure(error)}.`),
    );

  if (state.kind === "looking")
    return (
      <p className="pa-muted pa-due" role="status">
        Looking for when it comes due…
      </p>
    );
  if (state.kind === "failed")
    return (
      <p className="pa-muted pa-due" role="status">
        {`When it comes due could not be looked up: ${state.detail}.`}
      </p>
    );
  const { cadence: reply, review } = state;
  const c = reply.cadence;
  const open = review?.review && !review.review.answer ? review : null;
  return (
    <div className="pa-runs pa-due" aria-label="When it comes due">
      <h4 className="pa-kpi__label">When it comes due</h4>
      {c ? (
        <p className="pa-run__line">
          {c.enabled
            ? `Comes due ${reply.rule_text}; next ${localWhen(c.next_run_at)}.`
            : `Paused. When you resume it, it comes due ${reply.rule_text}.`}
          {reply.zone_note ? ` (${reply.zone_note}.)` : ""}
        </p>
      ) : reply.suggested ? (
        <p className="pa-run__line">{`Not set. Suggested: ${reply.suggested_text}, because ${reply.suggested_basis}. Nothing comes due until you choose.`}</p>
      ) : (
        <p className="pa-run__line">{`Not set: ${reply.suggested_basis}. Choose when it comes due, or leave it to you.`}</p>
      )}
      {editing ? (
        <RuleForm
          start={c?.rule ?? reply.suggested ?? DEFAULT_RULE}
          onSave={(rule) => change({ rule, timezone: localZone(), enabled: true })}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="pa-adopt__row">
          {!c && reply.suggested ? (
            <Button size="sm" variant="secondary" onClick={() => change({ rule: reply.suggested!, timezone: localZone(), enabled: true })}>
              Use the suggestion
            </Button>
          ) : null}
          {c ? (
            <Button size="sm" variant="secondary" onClick={() => change({ enabled: !c.enabled })}>
              {c.enabled ? "Pause" : "Resume"}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {c ? "Change" : "Choose when"}
          </Button>
        </div>
      )}
      {open ? (
        <ReviewView
          review={open}
          said={said}
          onPause={() => change({ enabled: false })}
          onSlow={() => setEditing(true)}
          onSkip={() =>
            void chores.answer(caseId, open.review!.due_at, "skip").then(
              () => {
                setSaid("");
                load();
              },
              (error: unknown) => setSaid(`That was not saved: ${failure(error)}.`),
            )
          }
          onPrepare={() =>
            void openAndPrepare(open, { open: actions.open, hand: actions.hand, answer: chores.answer.bind(chores) }, spaceId).then(
              ({ unknown }) => {
                setSaid(
                  `Her composer holds the case's command. Nothing is sent until you press send.${unknown.length ? ` Open ${unknown.join(", ")} yourself.` : ""}`,
                );
                load();
              },
              (error: unknown) => setSaid(`Nothing was prepared: ${failure(error)}.`),
            )
          }
        />
      ) : null}
      {c && c.log.length ? <p className="pa-muted">{`Last: ${c.log[c.log.length - 1].text}.`}</p> : null}
      {!open && said ? (
        <p className="pa-muted pa-said" role="status">
          {said}
        </p>
      ) : null}
    </div>
  );
}
