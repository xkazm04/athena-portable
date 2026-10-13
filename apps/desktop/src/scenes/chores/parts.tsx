/**
 * The parts of a chore's proof, drawn for the scene — README section 3.5, ADR 0040, 0053, 0055.
 *
 * What she filed and how it was scored, the traps she walked past, every run, what the film shows,
 * what the chore taught her, what it is worth. Each is a pure function of its piece of the
 * playbook; the same words the module's own view uses, because honest copy does not change with the
 * frame around it: the world was invented, the value and hand minutes are the author's estimate,
 * "not benched" claims nothing measured, a film of an earlier run says it is stale.
 */
import { useState, type ReactNode } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import StatusDot from "@/components/StatusDot";
import { minutes, usd, type Bench, type Playbook } from "@/lib/playbooks";
import { OUTCOME_WORDS, type EvidenceView, type PlaybookView } from "@/modules/playbooks/model";

import { SIMULATED_LINE, lowerFirst } from "./model";

export function Stat({ term, value, bad = false }: { term: string; value: string; bad?: boolean }) {
  return (
    <div className={bad ? "ch-stat is-bad" : "ch-stat"}>
      <dt>{term}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** The bench at a glance: the money found against what was planted, the verdict, the standing line. */
export function Glance({ view, onOpen }: { view: PlaybookView; onOpen: () => void }) {
  const b = view.playbook.bench;
  const expect = view.playbook.expectation;
  if (b === null) {
    return (
      <div className="ch-glance" data-absent="1">
        <span className="ch-glance__head">
          <span className="ch-label">Bench</span>
          <Badge tone={view.verdict.tone}>{view.verdict.label}</Badge>
        </span>
        <p className="ch-body">{view.verdict.sentence}</p>
        <p className="ch-note">
          {`The bar: ${Math.round(expect.recall * 100)}% of the money, ${expect.falseClaims} false claims, under ${minutes(expect.minutes)}.`}
        </p>
      </div>
    );
  }
  const share = b.valueTotalUsd ? Math.round((b.valueFoundUsd / b.valueTotalUsd) * 100) : 0;
  return (
    <button
      type="button"
      className="ch-glance focus-ring"
      onClick={onOpen}
      aria-label={`Bench, ${b.runAt.slice(0, 10)}: ${usd(b.valueFoundUsd)} of ${usd(b.valueTotalUsd)} planted in its world. Open what she filed`}
    >
      <span className="ch-glance__head">
        <span className="ch-label">{`Bench, ${b.runAt.slice(0, 10)}`}</span>
        <Badge tone={view.verdict.tone}>{view.verdict.label}</Badge>
      </span>
      <span className="ch-glance__big">{usd(b.valueFoundUsd)}</span>
      <span className="ch-note">{`of ${usd(b.valueTotalUsd)} planted in its world`}</span>
      <span className="ch-simulated">{SIMULATED_LINE}</span>
      <span className="ch-meter" style={{ ["--pct" as string]: `${share}%` }} aria-hidden="true">
        <span />
      </span>
      <span className="ch-glance__stats">
        <GlanceStat term="Claims right" value={`${b.found} of ${b.eligible}`} />
        <GlanceStat
          term="Traps avoided"
          value={b.trapsTotal ? `${b.trapsTotal - b.trapsFiled} of ${b.trapsTotal}` : "–"}
          bad={b.trapsFiled > 0}
        />
        <GlanceStat
          term="Her time"
          value={
            view.manual
              ? `${minutes(b.wallS / 60)} on the bench vs ${view.manual.replace(/ by hand$/, "")} by hand (author's estimate)`
              : `${minutes(b.wallS / 60)} on the bench`
          }
        />
      </span>
    </button>
  );
}

function GlanceStat({ term, value, bad = false }: { term: string; value: string; bad?: boolean }) {
  return (
    <span className={bad ? "ch-glance__stat is-bad" : "ch-glance__stat"}>
      <span className="ch-label">{term}</span>
      <span className="ch-data">{value}</span>
    </span>
  );
}

/** What she filed, scored: the six numbers, every card, and the audit of her prose. */
export function Proof({ view }: { view: PlaybookView }) {
  const b = view.playbook.bench;
  const expect = view.playbook.expectation;
  if (b === null) {
    return (
      <div className="ch-proof" data-absent="1">
        <p className="ch-body">{view.verdict.sentence}</p>
        <p className="ch-note">
          {`The bar it will be held to: ${Math.round(expect.recall * 100)}% of the money, ${expect.falseClaims} false claims, under ${minutes(expect.minutes)}.`}
        </p>
      </div>
    );
  }
  return (
    <div className="ch-proof">
      <p className="ch-note">{`Bench, ${b.runAt.slice(0, 10)}`}</p>
      <dl className="ch-stats">
        <Stat term="Claims right" value={`${b.found} of ${b.eligible}`} />
        <Stat
          term="Traps avoided"
          value={b.trapsTotal ? `${b.trapsTotal - b.trapsFiled} of ${b.trapsTotal}` : "–"}
          bad={b.trapsFiled > 0}
        />
        <Stat term="False claims" value={String(b.falseClaims)} bad={b.falseClaims > 0} />
        <Stat term="Athena's time" value={minutes(b.wallS / 60)} />
        <Stat term="Your time" value={`${b.cards.length} cards, ${minutes(b.yourTimeS / 60)}`} />
        <Stat term="Model cost" value={b.costUsd === null ? "not reported" : usd(b.costUsd)} />
      </dl>
      <p className="ch-body">
        {view.verdict.sentence}
        {b.found ? ` ${b.exact} of ${b.found} at the exact amount the rules allow.` : ""}
      </p>
      <Keep bench={b} feePct={view.playbook.economics.incumbentFeePct} />
      <ul className="ch-cards" aria-label="The cards the gate filed">
        {b.cards.map((c, i) => {
          const o = OUTCOME_WORDS[c.outcome];
          return (
            <li key={`${c.key}-${i}`} className="ch-card" data-outcome={c.outcome}>
              <StatusDot tone={o.tone} />
              <span className="ch-code">{c.key || c.action}</span>
              <span className="ch-note">{c.why || o.word}</span>
              <span className="ch-card__v ch-data">{c.valueUsd ? usd(c.valueUsd) : ""}</span>
            </li>
          );
        })}
        {b.missed.map((m) => (
          <li key={`missed-${m.key}`} className="ch-card" data-outcome="missed">
            <StatusDot tone="pending" />
            <span className="ch-code">{m.key}</span>
            <span className="ch-note">Missed</span>
            <span className="ch-card__v ch-data">{m.valueUsd !== null ? usd(m.valueUsd) : ""}</span>
          </li>
        ))}
      </ul>
      {b.proseAudit && !b.proseAudit.agrees ? (
        <p className="ch-body ch-flag" role="note">
          <StatusDot tone="warning" />
          {`Her summary says ${usd(b.proseAudit.saidUsd)} in total; the cards she filed add up to ${usd(b.proseAudit.recordUsd)}. The record is what you sign, so the record is what counts.`}
        </p>
      ) : null}
      <p className="ch-note">
        Scored from the cards the gate filed, against answers Athena never saw. Nothing was sent:
        every card waited for a signature.
        {b.rescoredAt ? ` Rescored ${b.rescoredAt.slice(0, 10)} from the run's own cards.` : ""}
      </p>
    </div>
  );
}

/** What a contingency service would have kept of the money found, against what the run cost. */
function Keep({ bench, feePct }: { bench: Bench; feePct: number | null }) {
  if (!feePct || !bench.valueFoundUsd) return null;
  const fee = (bench.valueFoundUsd * feePct) / 100;
  return (
    <div className="ch-keep">
      <span>
        <span className="ch-label">{`A ${feePct}% service keeps`}</span>
        <span className="ch-keep__n ch-keep__n--them">{usd(fee)}</span>
      </span>
      <span aria-hidden="true" className="ch-keep__vs">
        vs
      </span>
      <span>
        <span className="ch-label">Athena's model cost</span>
        <span className="ch-keep__n">{bench.costUsd === null ? "not reported" : usd(bench.costUsd)}</span>
      </span>
    </div>
  );
}

/** How many traps the ledger shows before it folds. */
export const TRAPS_SHOWN = 5;

/**
 * The traps the world held, each by its own id with why it was one: what she was right to leave
 * alone. Folded to the first few (and says how many); a filed trap is listed first.
 */
export function TrapLedger({ ledger }: { ledger: Bench["trapLedger"] }) {
  const [all, setAll] = useState(false);
  const ordered = [...ledger].sort((a, b) => Number(b.filed) - Number(a.filed));
  const avoided = ledger.filter((t) => !t.filed).length;
  const shown = all ? ordered : ordered.slice(0, TRAPS_SHOWN);
  return (
    <div className="ch-traps">
      <div className="ch-traps__head">
        <span className="ch-title">What she was right to leave alone</span>
        <span className="ch-note">{`${avoided} of ${ledger.length} traps walked past`}</span>
      </div>
      <ul className="ch-traps__list">
        {shown.map((t) => (
          <li key={`${t.action}-${t.key}`} className="ch-trap" data-filed={t.filed ? "" : undefined}>
            <span className="ch-trap__mark" aria-hidden="true">
              {t.filed ? "✕" : "✓"}
            </span>
            <span className="ch-code">{t.key}</span>
            <span className="ch-note">{t.filed ? `Filed anyway. ${t.why}` : t.why}</span>
          </li>
        ))}
      </ul>
      {ordered.length > TRAPS_SHOWN ? (
        <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${ordered.length} (showing ${TRAPS_SHOWN} of ${ordered.length})`}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The run filmed (ADR 0055): the film where something serves it, the committed still where nothing
 * does, and what the narration says. A film of an earlier run than the bench holds says so.
 */
export function Film({ film }: { film: EvidenceView }) {
  const [playable, setPlayable] = useState(film.videoUrl !== null);
  return (
    <div className="ch-film">
      <div className="ch-film__head">
        <span className="ch-note">{`captured ${film.capturedAt}`}</span>
        <Badge tone={film.standing.tone}>{film.standing.label}</Badge>
      </div>
      {playable && film.videoUrl ? (
        <video
          className="ch-film__media"
          controls
          preload="metadata"
          poster={film.thumbnailUrl || undefined}
          src={film.videoUrl}
          onError={() => setPlayable(false)}
        />
      ) : film.thumbnailUrl ? (
        <img className="ch-film__media" src={film.thumbnailUrl} alt="What she filed, at the end of the filmed run" />
      ) : null}
      {!playable ? (
        <p className="ch-note">The film stays in evidence/ on the machine that made it; the dev server plays it there.</p>
      ) : null}
      <dl className="ch-stats">
        <Stat term="Length" value={film.length} />
        <Stat term="Captured" value={film.capturedAt || "–"} />
        <Stat term="Voice" value={film.voice || "–"} />
      </dl>
      <p className="ch-body ch-flag">
        <StatusDot tone={film.standing.tone} />
        {film.standing.sentence}
      </p>
      <h4 className="ch-title">What the narration says</h4>
      <p className="ch-note">Written from the bench's own numbers, not by a model.</p>
      <blockquote className="ch-quote ch-body">{film.narration}</blockquote>
    </div>
  );
}

/** Every run of this chore, oldest first and the latest last: the story, not only the score. */
export function Runs({ bench }: { bench: Bench }) {
  const latest = {
    runAt: bench.runAt,
    model: bench.model,
    verdict: bench.verdict.word,
    found: bench.found,
    eligible: bench.eligible,
    valueFoundUsd: bench.valueFoundUsd,
    falseClaims: bench.falseClaims,
    note: bench.note,
  };
  const tone = { exceeds: "success", meets: "info", short: "warning" } as const;
  return (
    <ol className="ch-runs" aria-label="Every run of this playbook">
      {[...bench.history, latest].map((r, i, all) => (
        <li key={`${r.runAt}-${i}`} className="ch-past" data-latest={i === all.length - 1 ? "1" : undefined}>
          <StatusDot tone={tone[r.verdict]} />
          <span className="ch-data">{r.runAt.slice(5, 16).replace("T", " ")}</span>
          <span className="ch-label">{r.verdict}</span>
          <span className="ch-note">
            {`${r.found} of ${r.eligible}, ${usd(r.valueFoundUsd)}, ${r.falseClaims} false`}
            {r.note ? ` — ${r.note}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What this chore's runs taught Athena: the product fixes they uncovered. */
export function Lessons({ playbook }: { playbook: Playbook }) {
  return (
    <ol className="ch-lessons" aria-label="Fixes its runs uncovered">
      {playbook.lessons.map((l) => (
        <li key={`${l.adr}-${l.title}`} className="ch-lesson">
          <span className="ch-lesson__adr ch-label">{l.adr ? `ADR ${l.adr}` : "finding"}</span>
          <span className="ch-lesson__text">
            <span className="ch-title">{l.title}</span>
            <span className="ch-note">{l.found}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Money({ playbook, onOpen }: { playbook: Playbook; onOpen: (url: string) => void }) {
  const e = playbook.economics;
  return (
    <div className="ch-money">
      <p className="ch-body">
        <strong>{usd(e.valueUsd)}</strong>
        {` ${e.per === "run" ? "a run" : `a ${e.per}`} for ${lowerFirst(playbook.persona) || "this person"}, against `}
        <strong>{minutes(e.manualMinutes)}</strong>
        {" by hand."}
      </p>
      {e.incumbent ? <p className="ch-body">{e.incumbent}</p> : null}
      {e.sources.length ? (
        <ul className="ch-sources" aria-label="Sources">
          {e.sources.map((s) => (
            <li key={s.url}>
              <a
                href={s.url}
                className="ch-link focus-ring"
                onClick={(ev) => {
                  ev.preventDefault();
                  onOpen(s.url);
                }}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <h4 className="ch-title">Why it is on the edge</h4>
      <Meter label="Difficulty for anyone else" score={playbook.edge.difficulty} why={playbook.edge.difficultyWhy} />
      <Meter label="Usefulness to you" score={playbook.edge.usefulness} why={playbook.edge.usefulnessWhy} />
    </div>
  );
}

function Meter({ label, score, why }: { label: string; score: number; why: string }) {
  return (
    <div className="ch-edge">
      <span className="ch-label">{label}</span>
      <span className="ch-pips" role="img" aria-label={`${score} of 5`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} data-on={i <= score ? "1" : undefined} />
        ))}
      </span>
      {why ? <span className="ch-note">{why}</span> : null}
    </div>
  );
}

/**
 * Her words, with the two marks a model's prose leans on — `**bold**` and `- ` bullets — read as
 * what they mean. Built as nodes, never as HTML: the words are model output.
 */
export function Prose({ text }: { text: string }) {
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
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (/^[-*] /.test(t)) {
      bullets.push(t.slice(2));
      continue;
    }
    flush();
    if (t) out.push(<p key={`p-${out.length}`}>{inline(t)}</p>);
  }
  flush();
  return <>{out}</>;
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
