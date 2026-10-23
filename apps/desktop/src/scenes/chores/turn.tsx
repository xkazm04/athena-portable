/**
 * One turn of a run, drawn — README section 3.5, ADR 0040, 0089 and 0097.
 *
 * What the person said, her words, what she read, and the cards she proposed with the scorer's
 * word on each; a practice run's `proposed` card has no scorer's word and no value, and says so. Shared by the replay (`replay.tsx`) and the Adopt studio's showcase
 * (`adopt/showcase.tsx`), which plays the same turns with the person's portal names in them.
 */
import type { ReactNode } from "react";

import StatusDot from "@/components/StatusDot";
import type { TraceTurn, ValueKind } from "@/lib/playbooks";
import { OUTCOME_WORDS } from "@/modules/playbooks/model";
import { readsOf } from "@/modules/playbooks/replay";

import { cardValue } from "./worth";

export default function TurnView({
  turn: t,
  at,
  total,
  className = "",
  kind = () => "money_back",
}: {
  turn: TraceTurn;
  /** 0-based. */
  at: number;
  total: number;
  className?: string;
  /** Each card's kind by its tool (ADR 0133): a weight shows no dollars. Money back when not given. */
  kind?: (tool: string) => ValueKind;
}) {
  const reads = readsOf(t);
  return (
    <article
      className={`ch-turn ${className}`.trim()}
      aria-live="polite"
      aria-label={`Turn ${at + 1} of ${total}`}
    >
      {t.user ? (
        <p className="ch-turn__line ch-body">
          <span className="ch-turn__who ch-label">You</span>
          {t.user}
        </p>
      ) : t.continued ? (
        <p className="ch-turn__line ch-note">
          <span className="ch-turn__who ch-label">Page</span>
          The tools she called answered, and the run loop handed her their results.
        </p>
      ) : null}
      {t.said ? (
        <div className="ch-turn__line ch-turn__her ch-body">
          <span className="ch-turn__who ch-label">Athena</span>
          <div className="ch-turn__words">
            <Prose text={t.said} />
            {t.saidChars > t.said.length ? (
              <span className="ch-note">{`… (showing ${t.said.length} of ${t.saidChars} characters)`}</span>
            ) : null}
          </div>
        </div>
      ) : null}
      {reads.length ? (
        <p className="ch-turn__line ch-turn__reads">
          <span className="ch-turn__who ch-label">Read</span>
          {reads.map((r) => (
            <span key={r.name} className="ch-chip">
              {r.times > 1 ? `${r.name} ×${r.times}` : r.name}
            </span>
          ))}
        </p>
      ) : null}
      {t.cards.length ? (
        <ul className="ch-cards ch-cards--turn" aria-label="Cards she proposed this turn">
          {t.cards.map((c, i) => {
            const o = OUTCOME_WORDS[c.outcome];
            return (
              <li key={`${c.key}-${i}`} className="ch-card" data-outcome={c.outcome}>
                <StatusDot tone={o.tone} />
                <span className="ch-code">{c.key || c.action}</span>
                <span className="ch-note">{`${c.action.replace(/_/g, " ")} · ${o.word}`}</span>
                <span className="ch-card__v ch-data">{cardValue(kind(c.action), c.valueUsd)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="ch-note">No card on this turn.</p>
      )}
    </article>
  );
}

/**
 * Her words, with the two marks a model's prose leans on — `**bold**` and `- ` bullets — read as
 * what they mean. Built as nodes, never as HTML: the words are model output.
 */
function Prose({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      out.push(
        <ul key={`ul-${out.length}`} className="ch-prose-list">
          {bullets.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  let rows: string[][] = [];
  const flushTable = () => {
    if (rows.length) {
      const [head, ...body] = rows;
      out.push(
        <table key={`t-${out.length}`} className="ch-prose-table">
          <thead>
            <tr>
              {head.map((c, i) => (
                <th key={i}>{inline(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{inline(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      rows = [];
    }
  };
  for (const line of text.split("\n")) {
    const t = line.trim();
    // A markdown table row: her words often carry one. A separator row (|---|) only shapes it.
    if (t.startsWith("|")) {
      flush();
      if (!/^\|[\s:|-]+\|?$/.test(t)) rows.push(cells(t));
      continue;
    }
    flushTable();
    if (/^[-*] /.test(t)) {
      bullets.push(t.slice(2));
      continue;
    }
    flush();
    if (t) out.push(<p key={`p-${out.length}`}>{inline(t.replace(/^#{1,6} /, ""))}</p>);
  }
  flushTable();
  flush();
  return <>{out}</>;
}

/** The cells of one table row; a row cut short by the shown-of-total bound keeps what it has. */
export function cells(row: string): string[] {
  return row
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}
