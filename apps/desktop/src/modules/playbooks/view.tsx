/**
 * The Playbooks module's surface — a pure function of `PlaybooksModel` (ADR 0029, ADR 0040).
 *
 * Two layers. The overview reads: **the edge**, a map of every playbook between how hard it is
 * for anyone else and how much it is worth to the person, with the corner the cycles push into
 * marked "only Athena"; then one tile per playbook: its value the loudest thing on it, its bench
 * verdict in the corner, two chips and no prose. The second layer opens one playbook on an
 * abstract (ADR 0053): the promise, the proof in three numbers, and one line for each part of it.
 * A part opens in place as the third level — the chore, the portals, the cards the gate filed,
 * the traps, the run — and Back returns to the abstract before it closes the layer.
 *
 * Which layer and which part are open is view-local (ADR 0029, decision 3); the open playbook is
 * looked up from the model on every render.
 */
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import Layer from "@/components/Layer";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import PageSection from "@/components/PageSection";
import PillGroup from "@/components/PillGroup";
import SectionCard from "@/components/SectionCard";
import StatusDot from "@/components/StatusDot";
import Tile from "@/components/Tile";
import { minutes, usd, type Bench, type Playbook, type TraceTurn } from "@/lib/playbooks";

import "./playbooks.css";
import {
  OUTCOME_WORDS,
  arrange,
  foundBy,
  readsOf,
  turnState,
  visitsOf,
  facetsOf,
  type AudienceFilter,
  type Facet,
  type FacetId,
  type PlaybookView,
  type PlaybooksModel,
  type SortBy,
} from "./model";

export default function PlaybooksView({
  model,
  initialOpen = null,
  initialFacet = null,
  initialTurn = 0,
}: {
  model: PlaybooksModel;
  /** Preview only: open this playbook's layer on first render. */
  initialOpen?: string | null;
  /** Preview only: open the layer on this part instead of its abstract. */
  initialFacet?: FacetId | null;
  /** Preview only: the replay's turn on first render, from 0. */
  initialTurn?: number;
}) {
  const [open, setOpenState] = useState<string | null>(initialOpen);
  const [facet, setFacet] = useState<FacetId | null>(initialFacet);
  const setOpen = (id: string | null) => {
    setOpenState(id);
    setFacet(null);
  };
  const [audience, setAudience] = useState<AudienceFilter>("all");
  const [by, setBy] = useState<SortBy>("edge");
  const grid = arrange(model.items, audience, by);
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

          <PageSection title="Playbooks" note={SORT_NOTES[by]}>
            <div className="pb-toolbar">
              <PillGroup
                ariaLabel="Whose chore"
                value={audience}
                onChange={setAudience}
                options={[
                  { value: "all", label: `All ${model.items.length}` },
                  { value: "home", label: `At home ${count(model.items, "home")}` },
                  { value: "work", label: `At work ${count(model.items, "work")}` },
                ]}
              />
              <PillGroup
                ariaLabel="Order"
                value={by}
                onChange={setBy}
                options={[
                  { value: "edge", label: "Hardest first", hint: SORT_NOTES.edge },
                  { value: "money", label: "Most money", hint: SORT_NOTES.money },
                  { value: "time", label: "Most time saved", hint: SORT_NOTES.time },
                ]}
              />
            </div>
            <div className="pb-grid">
              {grid.map(({ view: v, rank }) => (
                <Tile
                  key={v.id}
                  accent={v.onEdge}
                  emblem={
                    <span className="pb-tile-head">
                      <span className="pb-rank" data-verdict={v.verdict.word} aria-hidden="true">
                        {rank}
                      </span>
                      <span className="typo-label">{v.playbook.domain}</span>
                    </span>
                  }
                  title={v.title}
                  pill={<Badge tone={v.verdict.tone}>{v.verdict.label}</Badge>}
                  figure={v.value}
                  figureNote={v.per}
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
          eyebrow={facet ? current.title : current.playbook.domain || "Playbook"}
          title={facet ? (facetsOf(current).find((f) => f.id === facet)?.title ?? current.title) : current.title}
          onClose={() => (facet ? setFacet(null) : setOpen(null))}
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
          {facet ? (
            <FacetLayer
              view={current}
              model={model}
              facet={facet}
              onFacet={setFacet}
              initialTurn={initialTurn}
            />
          ) : (
            <Abstract view={current} onFacet={setFacet} />
          )}
        </Layer>
      ) : null}
    </PageShell>
  );
}

const SORT_NOTES: Record<SortBy, string> = {
  edge: "Hardest for anyone else and most useful first.",
  money: "Most money a year first.",
  time: "Most hours by hand first.",
};

const count = (items: readonly PlaybookView[], audience: "home" | "work") =>
  items.filter((v) => v.playbook.audience === audience).length;

/** Two chips: the time it saves, measured where it was benched, and how many portals it spans. */
function TileFoot({ view }: { view: PlaybookView }) {
  const by = view.manual.replace(/ by hand$/, "");
  const run = view.measured.replace(/ with Athena$/, "");
  return (
    <>
      {view.manual ? (
        <span className="pb-chip pb-chip--athena" title={[view.manual, view.measured].filter(Boolean).join(", ")}>
          {run ? `${by} → ${run}` : view.manual}
        </span>
      ) : null}
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
          <dt className="typo-label">Money the bench found</dt>
          <dd className="pb-stats__n">{totals.availableUsd ? usd(totals.foundUsd) : "–"}</dd>
          <dd className="typo-caption">
            {totals.availableUsd ? `of ${usd(totals.availableUsd)} there to find` : "nothing benched yet"}
          </dd>
        </div>
        <div>
          <dt className="typo-label">Traps walked past</dt>
          <dd className="pb-stats__n">
            {totals.trapsTotal ? `${totals.trapsTotal - totals.trapsFiled} of ${totals.trapsTotal}` : "–"}
          </dd>
          <dd className="typo-caption">
            {totals.falseClaims === 1 ? "1 false claim" : `${totals.falseClaims} false claims`}
          </dd>
        </div>
        <div>
          <dt className="typo-label">Her time</dt>
          <dd className="pb-stats__n">{totals.athenaMinutes ? minutes(totals.athenaMinutes) : "–"}</dd>
          <dd className="typo-caption">
            {totals.manualMinutes ? `against ${minutes(totals.manualMinutes)} by hand` : ""}
          </dd>
        </div>
        <div>
          <dt className="typo-label">Beat their bar</dt>
          <dd className="pb-stats__n">{`${totals.exceeds} of ${totals.benched || 0}`}</dd>
          <dd className="typo-caption">
            {totals.costUsd ? `${usd(totals.costUsd)} of model time in all` : ""}
          </dd>
        </div>
        <div>
          <dt className="typo-label">Fixes they taught Athena</dt>
          <dd className="pb-stats__n">{String(totals.lessons)}</dd>
          <dd className="typo-caption">each a decision record</dd>
        </div>
        <div>
          <dt className="typo-label">On the edge</dt>
          <dd className="pb-stats__n">{`${totals.onEdge} of ${totals.count}`}</dd>
          <dd className="typo-caption">hard for anyone else, worth real money</dd>
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

// -- one playbook: the abstract -------------------------------------------------------------------

const GROUPS: { id: Facet["group"]; title: string }[] = [
  { id: "chore", title: "The chore" },
  { id: "proof", title: "The proof" },
];

/**
 * The layer's first view: the promise, the proof in three numbers, and a line per part. Nothing
 * here is longer than a sentence; every part opens in place.
 */
function Abstract({ view, onFacet }: { view: PlaybookView; onFacet: (f: FacetId) => void }) {
  const p = view.playbook;
  const facets = facetsOf(view);
  return (
    <div className="pb-abstract">
      <div className="pb-abstract__top">
        <div className="pb-abstract__lede">
          <p className="pb-promise">{p.promise}</p>
          {p.caveat ? (
            <p className="pb-abstract__caveat typo-caption" role="note">
              <StatusDot tone="warning" />
              {firstSentence(p.caveat)}
            </p>
          ) : null}
        </div>
        <ProofGlance view={view} onOpen={() => onFacet("result")} />
      </div>
      <div className="pb-facets">
        {GROUPS.map((g) => (
          <section key={g.id} className="pb-facets__group" aria-label={g.title}>
            <h3 className="typo-label pb-facets__title">{g.title}</h3>
            <ul className="pb-facets__list">
              {facets
                .filter((f) => f.group === g.id)
                .map((f) => (
                  <li key={f.id}>
                    <FacetRow facet={f} onOpen={() => onFacet(f.id)} />
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function FacetRow({ facet, onOpen }: { facet: Facet; onOpen: () => void }) {
  return (
    <button type="button" className="pb-facet focus-ring" onClick={onOpen}>
      <span className="pb-facet__text">
        <span className="typo-title pb-facet__title">{facet.title}</span>
        <span className="typo-caption pb-facet__summary">{facet.summary}</span>
      </span>
      {facet.figure ? <span className="typo-data pb-facet__figure">{facet.figure}</span> : null}
      <svg className="pb-facet__chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** The proof at a glance: the money found against what was there, the verdict, three numbers. */
function ProofGlance({ view, onOpen }: { view: PlaybookView; onOpen: () => void }) {
  const b = view.playbook.bench;
  const expect = view.playbook.expectation;
  if (b === null) {
    return (
      <div className="pb-glance" data-absent="1">
        <span className="pb-glance__head">
          <span className="typo-label">Bench</span>
          <Badge tone={view.verdict.tone}>{view.verdict.label}</Badge>
        </span>
        <p className="typo-body">{view.verdict.sentence}</p>
        <p className="typo-caption">
          {`The bar: ${Math.round(expect.recall * 100)}% of the money, ${expect.falseClaims} false claims, under ${minutes(expect.minutes)}.`}
        </p>
      </div>
    );
  }
  const pct = b.valueTotalUsd ? Math.round((b.valueFoundUsd / b.valueTotalUsd) * 100) : 0;
  return (
    <button type="button" className="pb-glance focus-ring" onClick={onOpen} aria-label="Open what she filed">
      <span className="pb-glance__head">
        <span className="typo-label">{`Bench, ${b.runAt.slice(0, 10)}`}</span>
        <Badge tone={view.verdict.tone}>{view.verdict.label}</Badge>
      </span>
      <span className="pb-proof__big">{usd(b.valueFoundUsd)}</span>
      <span className="typo-caption">{`of ${usd(b.valueTotalUsd)} there to find`}</span>
      <span className="pb-proof__bar" style={{ ["--pct" as string]: `${pct}%` }} aria-hidden="true">
        <span />
      </span>
      <span className="pb-glance__stats">
        <Glance term="Claims right" value={`${b.found} of ${b.eligible}`} />
        <Glance
          term="Traps avoided"
          value={b.trapsTotal ? `${b.trapsTotal - b.trapsFiled} of ${b.trapsTotal}` : "–"}
          bad={b.trapsFiled > 0}
        />
        <Glance
          term="Her time"
          value={view.manual ? `${minutes(b.wallS / 60)} vs ${view.manual.replace(/ by hand$/, "")}` : minutes(b.wallS / 60)}
        />
      </span>
    </button>
  );
}

function Glance({ term, value, bad = false }: { term: string; value: string; bad?: boolean }) {
  return (
    <span className={`pb-glance__stat${bad ? " is-bad" : ""}`}>
      <span className="typo-label">{term}</span>
      <span className="typo-data">{value}</span>
    </span>
  );
}

/** The caveat's first sentence carries the warning; the whole of it waits in "The chore today". */
function firstSentence(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text.trim());
  return m ? m[1] : text.trim();
}

// -- one playbook: a part, opened ------------------------------------------------------------------

function FacetLayer({
  view,
  model,
  facet,
  onFacet,
  initialTurn,
}: {
  view: PlaybookView;
  model: PlaybooksModel;
  facet: FacetId;
  onFacet: (f: FacetId) => void;
  initialTurn: number;
}) {
  return (
    <div className="pb-part">
      <nav className="pb-part__nav" aria-label="Parts of this playbook">
        {facetsOf(view).map((f) => (
          <button
            key={f.id}
            type="button"
            className="pb-part__tab focus-ring"
            aria-current={f.id === facet ? "page" : undefined}
            onClick={() => onFacet(f.id)}
          >
            {f.title}
          </button>
        ))}
      </nav>
      <div className="pb-part__body" key={facet}>
        <FacetBody view={view} model={model} facet={facet} initialTurn={initialTurn} />
      </div>
    </div>
  );
}

function FacetBody({
  view,
  model,
  facet,
  initialTurn,
}: {
  view: PlaybookView;
  model: PlaybooksModel;
  facet: FacetId;
  initialTurn: number;
}) {
  const p = view.playbook;
  const b = p.bench;
  switch (facet) {
    case "chore":
      return (
        <>
          {p.persona ? <p className="typo-label pb-persona">{p.persona}</p> : null}
          <p className="typo-body pb-reading">{p.chore}</p>
          <PageSection title="Tell Athena" note="Handed over, it waits in her composer until you send it.">
            <blockquote className="pb-command">{p.command}</blockquote>
          </PageSection>
          {p.caveat ? (
            <p className="pb-caveat typo-body" role="note">
              <StatusDot tone="warning" />
              {p.caveat}
            </p>
          ) : null}
        </>
      );
    case "portals":
      return (
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
      );
    case "method":
      return (
        <>
          {p.steps.length ? (
            <ol className="pb-steps">
              {p.steps.map((s) => (
                <li key={s} className="typo-body">
                  {s}
                </li>
              ))}
            </ol>
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
      );
    case "gates":
      return (
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
      );
    case "result":
      return <Proof view={view} />;
    case "traps":
      return (
        <>
          {b?.trapLedger.length ? <TrapLedger ledger={b.trapLedger} /> : null}
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
        </>
      );
    case "run":
      return b?.trace.length ? (
        <>
          <Replay trace={b.trace} initialTurn={initialTurn} />
          {b.closingWords ? (
            <figure className="pb-quote">
              <blockquote className="typo-body">
                <Prose text={b.closingWords} />
              </blockquote>
              <figcaption className="typo-caption">{`Athena, at the end of the run (${b.engine} ${b.model})`}</figcaption>
            </figure>
          ) : null}
          {b.history.length ? (
            <PageSection title="Every run">
              <Runs bench={b} />
            </PageSection>
          ) : null}
        </>
      ) : null;
    case "lessons":
      return <Lessons playbook={p} />;
    case "money":
      return (
        <>
          <Money playbook={p} onOpen={model.actions.open} />
          <EdgeWhy playbook={p} />
        </>
      );
  }
}

/** What she filed, scored: the six numbers, every card, and the audit of her prose. */
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
  return (
    <SectionCard
      title="Proof"
      note={`bench, ${b.runAt.slice(0, 10)}`}
      action={<Badge tone={view.verdict.tone}>{view.verdict.label}</Badge>}
    >
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
              <span className="pb-card__v typo-data">{c.valueUsd ? usd(c.valueUsd) : ""}</span>
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
      {b.proseAudit && !b.proseAudit.agrees ? (
        <p className="pb-audit typo-body" role="note">
          <StatusDot tone="warning" />
          {`Her summary says ${usd(b.proseAudit.saidUsd)} in total; the cards she filed add up to ${usd(b.proseAudit.recordUsd)}. The record is what you sign, so the record is what counts.`}
        </p>
      ) : null}
      <p className="typo-caption">
        Scored from the cards the gate filed, against answers Athena never saw. Nothing was sent:
        every card waited for a signature.
        {b.rescoredAt ? ` Rescored ${b.rescoredAt.slice(0, 10)} from the run's own cards.` : ""}
      </p>
    </SectionCard>
  );
}

/**
 * The traps the world held, each by its own id with why it was one: what she was right to leave
 * alone. Folded to the first few; a filed trap is listed first and in the error colour.
 */
function TrapLedger({ ledger }: { ledger: Bench["trapLedger"] }) {
  const [all, setAll] = useState(false);
  const ordered = [...ledger].sort((a, b) => Number(b.filed) - Number(a.filed));
  const avoided = ledger.filter((t) => !t.filed).length;
  const SHOWN = 5;
  const shown = all ? ordered : ordered.slice(0, SHOWN);
  return (
    <div className="pb-traps">
      <div className="pb-traps__head">
        <span className="typo-title">What she was right to leave alone</span>
        <span className="typo-caption">{`${avoided} of ${ledger.length} traps walked past`}</span>
      </div>
      <ul className="pb-traps__list">
        {shown.map((t) => (
          <li key={`${t.action}-${t.key}`} className="pb-trap" data-filed={t.filed ? "" : undefined}>
            <span className="pb-trap__mark" aria-hidden="true">
              {t.filed ? "✕" : "✓"}
            </span>
            <span className="typo-code">{t.key}</span>
            <span className="typo-caption">{t.filed ? `Filed anyway. ${t.why}` : t.why}</span>
          </li>
        ))}
      </ul>
      {ordered.length > SHOWN ? (
        <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${ordered.length} (showing ${SHOWN} of ${ordered.length})`}
        </Button>
      ) : null}
    </div>
  );
}

/** How long the replay holds a turn before the next, when it plays on its own. */
const REPLAY_STEP_MS = 2800;

/**
 * The latest run, turn by turn: the portal she was in, what the person said, what she read and
 * what she filed, each card in the colour the scorer gave it. A rail of the portal visits above;
 * play, step, or pick a turn. The money found so far rises as the run goes.
 */
function Replay({ trace, initialTurn = 0 }: { trace: readonly TraceTurn[]; initialTurn?: number }) {
  const last = trace.length - 1;
  const [at, setAt] = useState(Math.max(0, Math.min(last, initialTurn)));
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || at >= last) return;
    const timer = window.setTimeout(() => {
      setAt(Math.min(at + 1, last));
      // Reaching the last turn ends the play; the button then offers a replay.
      if (at + 1 >= last) setPlaying(false);
    }, REPLAY_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [playing, at, last]);

  const visits = visitsOf(trace);
  const turn = trace[Math.min(at, last)];
  const go = (i: number) => {
    setPlaying(false);
    setAt(Math.max(0, Math.min(last, i)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") go(at + 1);
    else if (e.key === "ArrowLeft") go(at - 1);
    else return;
    e.preventDefault();
  };
  const play = () => {
    if (at >= last) {
      setAt(0);
      setPlaying(true);
    } else setPlaying((p) => !p);
  };
  const found = foundBy(trace, at);
  const reads = readsOf(turn);

  return (
    <SectionCard
      title="Watch the run"
      note={`${trace.length} turns, ${visits.length} tab visits`}
      action={
        <Button size="sm" variant={playing ? "ghost" : "primary"} onClick={play}>
          {playing ? "Pause" : at >= last ? "Replay" : "Play"}
        </Button>
      }
    >
      <div className="pb-replay" tabIndex={0} onKeyDown={onKey} aria-label="The run, turn by turn">
        <ol className="pb-rail" aria-label="Turns, by tab">
          {visits.map((v) => (
            <li
              key={`${v.portal}-${v.from}`}
              className="pb-rail__visit"
              data-here={at >= v.from && at <= v.to ? "" : undefined}
            >
              <span className="pb-rail__name typo-label" title={v.portal}>
                {v.portal}
              </span>
              <span className="pb-rail__dots">
                {trace.slice(v.from, v.to + 1).map((t, k) => {
                  const i = v.from + k;
                  return (
                    <button
                      key={i}
                      type="button"
                      className="pb-rail__dot"
                      data-state={turnState(t)}
                      data-past={i < at ? "" : undefined}
                      aria-current={i === at ? "step" : undefined}
                      aria-label={`Turn ${i + 1}, ${t.portal}`}
                      onClick={() => go(i)}
                    />
                  );
                })}
              </span>
            </li>
          ))}
        </ol>

        <div className="pb-turn" key={at} aria-live="polite">
          <div className="pb-turn__head">
            <span className="typo-label">{`Turn ${at + 1} of ${trace.length}`}</span>
            <span className="pb-chip">{turn.portal}</span>
            <span className="pb-turn__found typo-data" title="What her right cards were worth so far">
              {usd(found)}
            </span>
          </div>
          {turn.user ? (
            <p className="pb-turn__you typo-body">
              <span className="pb-turn__who typo-label">You</span>
              {turn.user}
            </p>
          ) : turn.continued ? (
            <p className="pb-turn__you pb-turn__you--loop typo-caption">
              <span className="pb-turn__who typo-label">Page</span>
              The tools she called answered, and the run loop handed her their results.
            </p>
          ) : null}
          {turn.said ? (
            <div className="pb-turn__her typo-body">
              <span className="pb-turn__who typo-label">Athena</span>
              <div className="pb-turn__words">
                <Prose text={turn.said} />
                {turn.saidChars > turn.said.length ? (
                  <span className="typo-caption">{`… (showing ${turn.said.length} of ${turn.saidChars} characters)`}</span>
                ) : null}
              </div>
            </div>
          ) : null}
          {reads.length ? (
            <p className="pb-turn__reads">
              <span className="typo-label">Read</span>
              {reads.map((r) => (
                <span key={r.name} className="pb-chip">
                  {r.times > 1 ? `${r.name} ×${r.times}` : r.name}
                </span>
              ))}
            </p>
          ) : null}
          {turn.cards.length ? (
            <ul className="pb-turn__cards" aria-label="Cards filed this turn">
              {turn.cards.map((c, i) => {
                const o = OUTCOME_WORDS[c.outcome];
                return (
                  <li key={`${c.key}-${i}`} className="pb-card" data-outcome={c.outcome}>
                    <StatusDot tone={o.tone} />
                    <span className="typo-code">{c.key || c.action}</span>
                    <span className="typo-caption">{`${c.action.replace(/_/g, " ")} · ${o.word}`}</span>
                    <span className="pb-card__v typo-data">{c.valueUsd ? usd(c.valueUsd) : ""}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <div className="pb-replay__nav">
          <Button size="sm" variant="ghost" onClick={() => go(at - 1)} disabledReason={at === 0 ? "This is the first turn" : undefined}>
            Previous
          </Button>
          <span className="pb-replay__progress" aria-hidden="true">
            <span style={{ width: `${trace.length > 1 ? (at / last) * 100 : 100}%` }} />
          </span>
          <Button size="sm" variant="ghost" onClick={() => go(at + 1)} disabledReason={at >= last ? "This is the last turn" : undefined}>
            Next
          </Button>
        </div>
      </div>
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

/** What this playbook's runs taught Athena: the product fixes they uncovered. */
function Lessons({ playbook }: { playbook: Playbook }) {
  return (
    <SectionCard title="What it taught Athena" note="Fixes its runs uncovered" posture="flat">
      <ol className="pb-lessons">
        {playbook.lessons.map((l) => (
          <li key={`${l.adr}-${l.title}`} className="pb-lesson">
            <span className="pb-lesson__adr typo-label">{l.adr ? `ADR ${l.adr}` : "finding"}</span>
            <span className="stack" style={{ gap: 2 }}>
              <span className="typo-title">{l.title}</span>
              <span className="typo-caption">{l.found}</span>
            </span>
          </li>
        ))}
      </ol>
    </SectionCard>
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
