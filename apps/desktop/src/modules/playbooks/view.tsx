/**
 * The Playbooks module's surface — a pure function of `PlaybooksModel` (ADR 0029, ADR 0040).
 *
 * Two layers. The overview reads: **the edge**, a map of every playbook between how hard it is
 * for anyone else and how much it is worth to the person, with the corner the cycles push into
 * marked "only Athena"; then one tile per playbook, its value the loudest thing on it and its
 * bench verdict in the corner. The second layer opens one playbook: on the left what it is and
 * how to start it, on the right what the bench proved — the cards the gate filed, scored against
 * the hidden truth, and the money they were worth.
 *
 * Which layer is open is view-local (ADR 0029, decision 3); the open playbook is looked up from
 * the model on every render.
 */
import { useState, type ReactNode } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import Layer, { LayerColumns } from "@/components/Layer";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import PageSection from "@/components/PageSection";
import SectionCard from "@/components/SectionCard";
import StatusDot from "@/components/StatusDot";
import Tile from "@/components/Tile";
import { minutes, usd, type Bench, type Playbook } from "@/lib/playbooks";

import "./playbooks.css";
import { OUTCOME_WORDS, type PlaybookView, type PlaybooksModel } from "./model";

export default function PlaybooksView({
  model,
  initialOpen = null,
}: {
  model: PlaybooksModel;
  /** Preview only: open this playbook's layer on first render. */
  initialOpen?: string | null;
}) {
  const [open, setOpen] = useState<string | null>(initialOpen);
  const current = model.items.find((v) => v.id === open) ?? null;
  const { totals } = model;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Playbooks"
        title="What only Athena does"
        caption="Chores worth real money, run on the real gate before they are shown."
        meta={
          totals.count ? (
            <>
              <Badge tone={totals.benched ? "success" : "neutral"}>
                {`${totals.benched} of ${totals.count} benched`}
              </Badge>
              {totals.availableUsd ? (
                <Badge tone="info">{`${usd(totals.foundUsd)} of ${usd(totals.availableUsd)} found`}</Badge>
              ) : null}
            </>
          ) : null
        }
      />

      {model.items.length === 0 ? (
        <EmptyState
          title="No playbooks in this build"
          line="A playbook is a directory under playbooks/; the bench writes its proof beside it."
        />
      ) : (
        <>
          <section className="pb-hero" aria-label="The edge">
            <EdgeMap items={model.items} onOpen={setOpen} />
            <EdgeNotes model={model} />
          </section>

          <PageSection title="Playbooks" note="Hardest for anyone else and most useful first.">
            <div className="pb-grid">
              {model.items.map((v, i) => (
                <Tile
                  key={v.id}
                  accent={v.onEdge}
                  emblem={
                    <span className="pb-tile-head">
                      <span className="pb-rank" data-verdict={v.verdict.word} aria-hidden="true">
                        {i + 1}
                      </span>
                      <span className="typo-label">{v.playbook.domain}</span>
                    </span>
                  }
                  title={v.title}
                  pill={<Badge tone={v.verdict.tone}>{v.verdict.label}</Badge>}
                  figure={v.value}
                  figureNote={v.per}
                  line={v.playbook.promise}
                  foot={<TileFoot view={v} />}
                  onOpen={() => setOpen(v.id)}
                />
              ))}
            </div>
          </PageSection>
        </>
      )}

      {current ? (
        <Layer
          eyebrow={current.playbook.domain || "Playbook"}
          title={current.title}
          onClose={() => setOpen(null)}
          actions={
            <>
              <Button variant="secondary" onClick={() => model.actions.copy(current.playbook.command)}>
                Copy the command
              </Button>
              <Button variant="primary" onClick={() =>
                  model.actions.hand(current.playbook.command, {
                    id: current.playbook.id,
                    title: current.title,
                  })
                }>
                Hand it to Athena
              </Button>
            </>
          }
        >
          <PlaybookLayer view={current} model={model} />
        </Layer>
      ) : null}
    </PageShell>
  );
}

function TileFoot({ view }: { view: PlaybookView }) {
  return (
    <>
      {view.manual ? <span className="pb-chip">{view.manual}</span> : null}
      {view.measured ? <span className="pb-chip pb-chip--athena">{view.measured}</span> : null}
      {view.speed ? <span className="pb-chip pb-chip--speed">{view.speed}</span> : null}
      <span className="pb-chip">{`${view.playbook.apps.length} portals`}</span>
    </>
  );
}

// -- the edge ------------------------------------------------------------------------------------

const W = 520;
const H = 340;
const PAD = { l: 44, r: 16, t: 30, b: 40 };
/** The scale runs half a step past each end, so a mark on a 1 or a 5 is never cut by the frame. */
const LO = 0.5;
const HI = 5.5;
const sx = (v: number) => PAD.l + ((v - LO) / (HI - LO)) * (W - PAD.l - PAD.r);
const sy = (v: number) => H - PAD.b - ((v - LO) / (HI - LO)) * (H - PAD.t - PAD.b);

function EdgeMap({ items, onOpen }: { items: readonly PlaybookView[]; onOpen: (id: string) => void }) {
  const edgeX = sx(3.5);
  const edgeY = sy(3.5);
  return (
    <figure className="pb-map">
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Playbooks by difficulty for others and usefulness">
        <defs>
          <linearGradient id="pb-edge" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.02" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <rect
          x={edgeX}
          y={PAD.t}
          width={W - PAD.r - edgeX}
          height={edgeY - PAD.t}
          rx="10"
          className="pb-map__edge"
          fill="url(#pb-edge)"
        />
        <text x={W - PAD.r} y={PAD.t - 10} textAnchor="end" className="pb-map__edge-label">
          ONLY ATHENA
        </text>
        {[1, 2, 3, 4, 5].map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={H - PAD.b} className="pb-map__grid" />
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} className="pb-map__grid" />
            <text x={sx(t)} y={H - PAD.b + 16} textAnchor="middle" className="pb-map__tick">
              {t}
            </text>
            <text x={PAD.l - 10} y={sy(t) + 4} textAnchor="end" className="pb-map__tick">
              {t}
            </text>
          </g>
        ))}
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 6} textAnchor="middle" className="pb-map__axis">
          Difficulty for anyone else →
        </text>
        <text
          x={12}
          y={(PAD.t + H - PAD.b) / 2}
          textAnchor="middle"
          className="pb-map__axis"
          transform={`rotate(-90 12 ${(PAD.t + H - PAD.b) / 2})`}
        >
          Usefulness to you →
        </text>
        {items.map((v, i) => {
          const cx = sx(v.point.x);
          const cy = sy(v.point.y);
          const r = 9 + 9 * v.point.weight;
          const right = cx < W * 0.62;
          return (
            <g
              key={v.id}
              className="pb-map__mark focus-ring"
              data-verdict={v.verdict.word}
              role="button"
              tabIndex={0}
              aria-label={`${v.title}: ${v.value} ${v.per}, ${v.verdict.label}`}
              onClick={() => onOpen(v.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(v.id);
                }
              }}
            >
              <circle cx={cx} cy={cy} r={r + 6} className="pb-map__halo" />
              <circle cx={cx} cy={cy} r={r} className="pb-map__dot" />
              <text x={cx} y={cy + 4} textAnchor="middle" className="pb-map__n">
                {i + 1}
              </text>
              <text
                x={right ? cx + r + 8 : cx - r - 8}
                y={cy + 4}
                textAnchor={right ? "start" : "end"}
                className="pb-map__label"
              >
                {v.title}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="pb-map__legend typo-caption">
        <span>
          <span className="pb-map__swatch" aria-hidden="true" /> only Athena: hard for anyone else,
          worth real money
        </span>
        <span>
          <StatusDot tone="success" /> exceeds the bar
        </span>
        <span>
          <StatusDot tone="warning" /> falls short
        </span>
        <span>
          <StatusDot tone="neutral" /> not benched
        </span>
        <span>size: value a year</span>
      </figcaption>
    </figure>
  );
}

function EdgeNotes({ model }: { model: PlaybooksModel }) {
  const { totals } = model;
  const best = model.items[0];
  return (
    <div className="pb-notes">
      <p className="pb-notes__lede">
        Each playbook spans portals no integration reaches and ends in something you sign. Athena
        does the reading, the cross-checking and the paperwork; the gate keeps the signature yours.
      </p>
      <dl className="pb-stats">
        <div>
          <dt className="typo-label">On the edge</dt>
          <dd className="pb-stats__n">{`${totals.onEdge} of ${totals.count}`}</dd>
        </div>
        <div>
          <dt className="typo-label">Beat their bar</dt>
          <dd className="pb-stats__n">{`${totals.exceeds} of ${totals.benched || 0}`}</dd>
        </div>
        <div>
          <dt className="typo-label">Money the bench found</dt>
          <dd className="pb-stats__n">{totals.availableUsd ? usd(totals.foundUsd) : "–"}</dd>
        </div>
      </dl>
      {best ? (
        <p className="typo-caption">
          {`Furthest out: ${best.title}, ${best.playbook.edge.difficulty}/5 hard and ${best.playbook.edge.usefulness}/5 useful.`}
        </p>
      ) : null}
    </div>
  );
}

// -- one playbook --------------------------------------------------------------------------------

function PlaybookLayer({ view, model }: { view: PlaybookView; model: PlaybooksModel }) {
  const p = view.playbook;
  return (
    <LayerColumns
      left={
        <>
          <p className="pb-promise">{p.promise}</p>

          <PageSection title="The chore today">
            {p.persona ? <p className="typo-label pb-persona">{p.persona}</p> : null}
            <p className="typo-body">{p.chore}</p>
          </PageSection>

          <PageSection title="Tell Athena" note="Handed over, it waits in her composer until you send it.">
            <blockquote className="pb-command">{p.command}</blockquote>
          </PageSection>

          <PageSection title="Where it happens" note={`${p.apps.length} portals, no shared API`}>
            <ul className="pb-portals">
              {p.apps.map((a) => (
                <li key={a.name} className="pb-portal">
                  <span className="typo-title">{a.name}</span>
                  <span className="typo-caption">{a.role}</span>
                  {a.api ? <span className="pb-chip">{a.api}</span> : null}
                  {a.url ? (
                    <Button size="sm" variant="ghost" onClick={() => model.actions.open(a.url)}>
                      Open
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </PageSection>

          {p.steps.length ? (
            <PageSection title="How she works it">
              <ol className="pb-steps">
                {p.steps.map((s) => (
                  <li key={s} className="typo-body">
                    {s}
                  </li>
                ))}
              </ol>
            </PageSection>
          ) : null}

          {p.gates.length ? (
            <PageSection title="Where she stops for your signature">
              <ul className="pb-list">
                {p.gates.map((g) => (
                  <li key={g.action} className="pb-gate">
                    <span className="pb-gate__tag typo-label">GATED</span>
                    <span>
                      <span className="typo-title">{g.label}</span>
                      <span className="typo-caption"> — {g.why}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </PageSection>
          ) : null}

          {p.traps.length ? (
            <PageSection title="What she must not fall for">
              <ul className="pb-list pb-list--traps">
                {p.traps.map((t) => (
                  <li key={t} className="typo-body">
                    {t}
                  </li>
                ))}
              </ul>
            </PageSection>
          ) : null}

          {p.memory.length ? (
            <PageSection title="What she learns once">
              <ul className="pb-list pb-list--memory">
                {p.memory.map((m) => (
                  <li key={m} className="typo-body">
                    {m}
                  </li>
                ))}
              </ul>
            </PageSection>
          ) : null}
        </>
      }
      right={
        <>
          <Proof view={view} />
          <Money playbook={p} onOpen={model.actions.open} />
          <EdgeWhy playbook={p} />
        </>
      }
    />
  );
}

function Proof({ view }: { view: PlaybookView }) {
  const b = view.playbook.bench;
  const expect = view.playbook.expectation;
  if (b === null) {
    return (
      <SectionCard title="Proof" posture="absent">
        <p className="typo-body">{view.verdict.sentence}</p>
        <p className="typo-caption">
          {`The bar it will be held to: ${Math.round(expect.recall * 100)}% of the money, ${expect.falseClaims} false claims, under ${minutes(expect.minutes)}.`}
        </p>
      </SectionCard>
    );
  }
  const pct = b.valueTotalUsd ? Math.round((b.valueFoundUsd / b.valueTotalUsd) * 100) : 0;
  return (
    <SectionCard
      title="Proof"
      note={`bench, ${b.runAt.slice(0, 10)}`}
      action={<Badge tone={view.verdict.tone}>{view.verdict.label}</Badge>}
    >
      <div className="pb-proof">
        <div className="pb-proof__meter" style={{ ["--pct" as string]: `${pct}%` }}>
          <span className="pb-proof__big">{usd(b.valueFoundUsd)}</span>
          <span className="typo-caption">{`of ${usd(b.valueTotalUsd)} there to find`}</span>
          <span className="pb-proof__bar" aria-hidden="true">
            <span />
          </span>
        </div>
        <dl className="pb-proof__stats">
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
      </div>
      <p className="typo-body">
        {view.verdict.sentence}
        {b.found ? ` ${b.exact} of ${b.found} at the exact amount the rules allow.` : ""}
      </p>
      <Keep bench={b} feePct={view.playbook.economics.incumbentFeePct} />
      <ul className="pb-cards" aria-label="The cards the gate filed">
        {b.cards.map((c, i) => {
          const o = OUTCOME_WORDS[c.outcome];
          return (
            <li key={`${c.key}-${i}`} className="pb-card" data-outcome={c.outcome}>
              <StatusDot tone={o.tone} />
              <span className="typo-code">{c.key || c.action}</span>
              <span className="typo-caption">{c.why || o.word}</span>
              <span className="pb-card__v typo-data">
                {c.valueUsd ? usd(c.valueUsd) : ""}
              </span>
            </li>
          );
        })}
        {b.missed.map((m) => (
          <li key={`missed-${m.key}`} className="pb-card" data-outcome="missed">
            <StatusDot tone="pending" />
            <span className="typo-code">{m.key}</span>
            <span className="typo-caption">Missed</span>
            <span className="pb-card__v typo-data">{m.valueUsd !== null ? usd(m.valueUsd) : ""}</span>
          </li>
        ))}
      </ul>
      {b.closingWords ? (
        <figure className="pb-quote">
          <blockquote className="typo-body">
            <Prose text={b.closingWords} />
          </blockquote>
          <figcaption className="typo-caption">{`Athena, at the end of the run (${b.engine} ${b.model})`}</figcaption>
        </figure>
      ) : null}
      {b.proseAudit && !b.proseAudit.agrees ? (
        <p className="pb-audit typo-body" role="note">
          <StatusDot tone="warning" />
          {`Her summary says ${usd(b.proseAudit.saidUsd)} in total; the cards she filed add up to ${usd(b.proseAudit.recordUsd)}. The record is what you sign, so the record is what counts.`}
        </p>
      ) : null}
      {b.history.length ? <Runs bench={b} /> : null}
      <p className="typo-caption">
        Scored from the cards the gate filed, against answers Athena never saw. Nothing was sent:
        every card waited for a signature.
        {b.rescoredAt ? ` Rescored ${b.rescoredAt.slice(0, 10)} from the run's own cards.` : ""}
      </p>
    </SectionCard>
  );
}

/** Every run of this playbook, oldest first and the latest last: the story, not only the score. */
function Runs({ bench }: { bench: Bench }) {
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
    <ol className="pb-runs" aria-label="Every run of this playbook">
      {[...bench.history, latest].map((r, i, all) => (
        <li key={`${r.runAt}-${i}`} className="pb-run" data-latest={i === all.length - 1 ? "1" : undefined}>
          <StatusDot tone={tone[r.verdict]} />
          <span className="typo-data">{r.runAt.slice(5, 16).replace("T", " ")}</span>
          <span className="typo-label">{r.verdict}</span>
          <span className="typo-caption">
            {`${r.found} of ${r.eligible}, ${usd(r.valueFoundUsd)}, ${r.falseClaims} false`}
            {r.note ? ` — ${r.note}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What a contingency service would have kept of the money found, against what the run cost. */
function Keep({ bench, feePct }: { bench: Bench; feePct: number | null }) {
  if (!feePct || !bench.valueFoundUsd) return null;
  const fee = (bench.valueFoundUsd * feePct) / 100;
  return (
    <div className="pb-keep">
      <span>
        <span className="typo-label">{`A ${feePct}% service keeps`}</span>
        <span className="pb-keep__n pb-keep__n--them">{usd(fee)}</span>
      </span>
      <span aria-hidden="true" className="pb-keep__vs">
        vs
      </span>
      <span>
        <span className="typo-label">Athena's model cost</span>
        <span className="pb-keep__n">{bench.costUsd === null ? "not reported" : usd(bench.costUsd)}</span>
      </span>
    </div>
  );
}

/**
 * Her closing words, with the two marks a model's prose leans on — `**bold**` and `- ` bullets —
 * read as what they mean. Built as nodes, never as HTML: the words are model output.
 */
function Prose({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      out.push(
        <ul key={`ul-${out.length}`} className="pb-prose-list">
          {bullets.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const line of lines) {
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

function Stat({ term, value, bad = false }: { term: string; value: string; bad?: boolean }) {
  return (
    <div className={bad ? "is-bad" : undefined}>
      <dt className="typo-label">{term}</dt>
      <dd className="typo-data">{value}</dd>
    </div>
  );
}

function Money({ playbook, onOpen }: { playbook: Playbook; onOpen: (url: string) => void }) {
  const e = playbook.economics;
  return (
    <SectionCard title="The money" posture="flat">
      <p className="typo-body">
        <strong>{usd(e.valueUsd)}</strong>
        {` ${e.per === "run" ? "a run" : `a ${e.per}`} for ${lowerFirst(playbook.persona) || "this person"}, against `}
        <strong>{minutes(e.manualMinutes)}</strong>
        {" by hand."}
      </p>
      {e.incumbent ? <p className="typo-body">{e.incumbent}</p> : null}
      {e.sources.length ? (
        <ul className="pb-sources">
          {e.sources.map((s) => (
            <li key={s.url}>
              <a
                href={s.url}
                className="typo-caption"
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
    </SectionCard>
  );
}

/** "A store shipping…" read mid-sentence: "a store shipping…". An acronym ("SaaS", "EU") stays. */
function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function EdgeWhy({ playbook }: { playbook: Playbook }) {
  const e = playbook.edge;
  return (
    <SectionCard title="Why it is on the edge" posture="flat">
      <Meter label="Difficulty for anyone else" score={e.difficulty} why={e.difficultyWhy} />
      <Meter label="Usefulness to you" score={e.usefulness} why={e.usefulnessWhy} />
    </SectionCard>
  );
}

function Meter({ label, score, why }: { label: string; score: number; why: string }) {
  return (
    <div className="pb-meter">
      <span className="typo-label">{label}</span>
      <span className="pb-meter__pips" aria-label={`${score} of 5`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} data-on={i <= score ? "1" : undefined} />
        ))}
      </span>
      {why ? <span className="typo-caption">{why}</span> : null}
    </div>
  );
}
