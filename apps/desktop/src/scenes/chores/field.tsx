/**
 * The field of chores — README section 3.5, ADR 0040, 0087 and 0089.
 *
 * The root of the Chores depth. The map is the hero: every chore between how hard it is for anyone
 * else and how much it is worth to the person, the corner the cycles push into marked "only
 * Athena". The chore under the pointer or the keyboard takes the centre of the frame, its name in
 * display type, and its card below lights with it. Under the map: the bench in numbers, then the
 * chores themselves, filtered by whose they are and ordered by edge, money or time. Marks are real
 * buttons (Enter and Space open them), the plot is HTML so its type never shrinks with the frame.
 *
 * Hover and focus are the view's own state; opening a chore is `go`. Nothing here fetches.
 */
import { useState } from "react";

import ChoreArt from "@/art/chore";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import PillGroup from "@/components/PillGroup";
import StatusDot from "@/components/StatusDot";
import type { Path } from "@/depth/model";
import { minutes, usd } from "@/lib/playbooks";
import {
  arrange,
  type AudienceFilter,
  type PlaybookView,
  type PlaybooksModel,
  type SortBy,
} from "@/modules/playbooks/model";

import {
  EDGE_FROM,
  NUMBERED_MARKS,
  SIMULATED_LINE,
  SORT_NOTES,
  artFor,
  chorePath,
  firstSentence,
  foundLine,
  markLabel,
  markPoints,
  markSize,
  marqueeOf,
  pct,
} from "./model";

const HERO = {
  eyebrow: "Chores",
  title: "What only Athena does",
  line: "Chores worth real money, run on the real gate before they are shown.",
};

const count = (items: readonly PlaybookView[], audience: "home" | "work") =>
  items.filter((v) => v.playbook.audience === audience).length;

export default function Field({ model, go }: { model: PlaybooksModel; go: (to: Path) => void }) {
  const [audience, setAudience] = useState<AudienceFilter>("all");
  const [by, setBy] = useState<SortBy>("edge");
  const [hotId, setHotId] = useState<string | null>(null);
  const { totals } = model;

  if (model.items.length === 0) {
    return (
      <div className="chores ch-field">
        <div className="ch-field__empty">
          <EmptyState
            title="No playbooks in this build"
            line="A playbook is a directory under playbooks/; the bench writes its proof beside it."
          />
        </div>
      </div>
    );
  }

  const hot = model.items.find((v) => v.id === hotId) ?? null;
  const words = hot ? marqueeOf(hot) : HERO;
  const grid = arrange(model.items, audience, by);
  const shown = new Set(grid.map((g) => g.view.id));
  const open = (id: string) => go(chorePath(id));
  const aim = (id: string) => ({
    onMouseEnter: () => setHotId(id),
    onMouseLeave: () => setHotId((h) => (h === id ? null : h)),
    onFocus: () => setHotId(id),
    onBlur: () => setHotId((h) => (h === id ? null : h)),
  });
  const best = model.items[0];
  const found = foundLine(model);
  const points = markPoints(model.items);

  return (
    <div className="chores ch-field" data-many={model.items.length > NUMBERED_MARKS ? "" : undefined}>
      <section className="ch-hero" aria-label="The edge">
        <div className="ch-words">
          <p className="ch-eyebrow">{words.eyebrow}</p>
          <h1 className="ch-marquee" data-hot={hot ? "" : undefined}>
            {words.title}
          </h1>
          <p className="ch-line">{words.line}</p>

          <div className="ch-totals">
            <Badge tone={totals.benched ? "success" : "neutral"}>{`${totals.benched} of ${totals.count} benched`}</Badge>
            {found ? <Badge tone="info">{found}</Badge> : null}
          </div>
          <p className="ch-simulated">{SIMULATED_LINE}</p>
          {hot ? (
            <p className="ch-hint" aria-hidden="true">
              Enter opens it
            </p>
          ) : (
            <p className="ch-hint">Point at a mark to read the chore. Enter opens it.</p>
          )}
        </div>

        <figure className="ch-map">
          <div className="ch-map__frame" role="group" aria-label="Playbooks by difficulty for others and usefulness">
            <svg className="ch-map__ground" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <rect
                className="ch-map__edge"
                x={pct(EDGE_FROM)}
                y="0"
                width={100 - pct(EDGE_FROM)}
                height={100 - pct(EDGE_FROM)}
                rx="1.5"
              />
              {[1, 2, 3, 4, 5].map((t) => (
                <g key={t}>
                  <line x1={pct(t)} x2={pct(t)} y1="0" y2="100" className="ch-map__grid" />
                  <line x1="0" x2="100" y1={100 - pct(t)} y2={100 - pct(t)} className="ch-map__grid" />
                </g>
              ))}
            </svg>
            <span className="ch-map__zone">Only Athena</span>
            {[1, 2, 3, 4, 5].map((t) => (
              <span key={t}>
                <span className="ch-map__tick ch-map__tick--x" style={{ left: `${pct(t)}%` }} aria-hidden="true">
                  {t}
                </span>
                <span className="ch-map__tick ch-map__tick--y" style={{ bottom: `${pct(t)}%` }} aria-hidden="true">
                  {t}
                </span>
              </span>
            ))}
            <span className="ch-map__axis ch-map__axis--x">Difficulty for anyone else →</span>
            <span className="ch-map__axis ch-map__axis--y">Usefulness to you →</span>
            {model.items.map((v, i) => (
              <button
                key={v.id}
                type="button"
                className="ch-mark focus-ring"
                data-verdict={v.verdict.word}
                data-hot={hotId === v.id ? "" : undefined}
                data-dim={shown.has(v.id) ? undefined : ""}
                style={{
                  left: `${pct(points[i]!.x)}%`,
                  bottom: `${pct(points[i]!.y)}%`,
                  ["--size" as string]: `${markSize(v.point.weight, model.items.length > NUMBERED_MARKS)}px`,
                }}
                aria-label={markLabel(v)}
                onClick={() => open(v.id)}
                {...aim(v.id)}
              >
                {model.items.length <= NUMBERED_MARKS ? <span aria-hidden="true">{i + 1}</span> : null}
              </button>
            ))}
          </div>
          <figcaption className="ch-legend">
            <span>
              <span className="ch-swatch" aria-hidden="true" /> only Athena: hard for anyone else, worth real money
            </span>
            <span>
              <StatusDot tone="success" /> exceeds the bar
            </span>
            <span>
              <StatusDot tone="info" /> meets it
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
      </section>

      <section className="ch-bench" aria-label="The bench">
        <p className="ch-lede">
          Each playbook spans portals no integration reaches and ends in something you sign. Athena does the
          reading, the cross-checking and the paperwork; the gate keeps the signature yours.
        </p>
        <dl className="ch-numbers">
          <Figure
            term="Money found on the bench"
            value={totals.availableUsd ? usd(totals.foundUsd) : "–"}
            note={
              totals.availableUsd
                ? `of ${usd(totals.availableUsd)} planted in its world, on the bench`
                : "nothing benched yet"
            }
          />
          <Figure
            term="Traps walked past"
            value={totals.trapsTotal ? `${totals.trapsTotal - totals.trapsFiled} of ${totals.trapsTotal}` : "–"}
            note={totals.falseClaims === 1 ? "1 false claim" : `${totals.falseClaims} false claims`}
          />
          <Figure
            term="Her time"
            value={totals.athenaMinutes ? minutes(totals.athenaMinutes) : "–"}
            note={
              totals.manualMinutes
                ? `on the bench, against ${minutes(totals.manualMinutes)} by hand (author's estimate)`
                : ""
            }
          />
          <Figure
            term="Beat their bar on the bench"
            value={`${totals.exceeds} of ${totals.benched || 0}`}
            note={totals.costUsd ? `${usd(totals.costUsd)} of model time in all` : ""}
          />
          <Figure term="Fixes they taught Athena" value={String(totals.lessons)} note="each a decision record" />
          <Figure
            term="On the edge"
            value={`${totals.onEdge} of ${totals.count}`}
            note="hard for anyone else, worth real money"
          />
        </dl>
        {best ? (
          <p className="ch-note">
            {`Furthest out: ${best.title}, ${best.playbook.edge.difficulty}/5 hard and ${best.playbook.edge.usefulness}/5 useful.`}
          </p>
        ) : null}
      </section>

      <section className="ch-roll" aria-label="Chores">
        <header className="ch-roll__head">
          <h2 className="ch-roll__title">Chores</h2>
          <p className="ch-note">{SORT_NOTES[by]}</p>
        </header>
        <div className="ch-toolbar">
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
        {grid.length === 0 ? (
          <p className="ch-body">No chore here is of that kind.</p>
        ) : (
          <ul className="ch-grid">
            {grid.map(({ view: v, rank }) => (
              <li key={v.id} className="ch-grid__item">
                <button
                  type="button"
                  className="ch-card-tile focus-ring"
                  data-verdict={v.verdict.word}
                  data-hot={hotId === v.id ? "" : undefined}
                  data-edge={v.onEdge ? "" : undefined}
                  onClick={() => open(v.id)}
                  {...aim(v.id)}
                >
                  <span className="ch-card-tile__art" title="Stylised drawing of this chore, not a screenshot">
                    <ChoreArt facts={artFor(v)} size={200} />
                  </span>
                  <span className="ch-card-tile__head">
                    <span className="ch-rank" aria-hidden="true">
                      {rank}
                    </span>
                    <span className="ch-label">{v.playbook.domain}</span>
                    {v.onEdge ? <span className="ch-edge-flag">On the edge</span> : null}
                  </span>
                  <span className="ch-card-tile__title">{v.title}</span>
                  <span className="ch-card-tile__verdict">
                    <Badge tone={v.verdict.tone}>{v.verdict.label}</Badge>
                    {v.speed ? <span className="ch-data">{v.speed}</span> : null}
                  </span>
                  <span className="ch-card-tile__figure">{v.value}</span>
                  <span className="ch-note">{`${v.per}, author's estimate`}</span>
                  <TileFoot view={v} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Figure({ term, value, note }: { term: string; value: string; note: string }) {
  return (
    <div className="ch-number">
      <dt>{term}</dt>
      <dd className="ch-number__n">{value}</dd>
      <dd className="ch-note">{note}</dd>
    </div>
  );
}

/** Two chips: the time it saves, measured where it was benched, and how many portals it spans. */
function TileFoot({ view }: { view: PlaybookView }) {
  const by = view.manual.replace(/ by hand$/, "");
  const run = view.measured.replace(/ with Athena$/, "");
  const film = view.evidence;
  return (
    <span className="ch-card-tile__foot">
      {film?.thumbnailUrl ? (
        <span className="ch-thumb" data-stale={film.current ? undefined : ""}>
          <img src={film.thumbnailUrl} alt="" loading="lazy" decoding="async" />
          <span className="ch-thumb__len ch-data">{film.current ? film.length : `${film.length}, stale`}</span>
        </span>
      ) : null}
      {view.manual ? (
        <span className="ch-chip" title={[view.manual, view.measured].filter(Boolean).join(", ")}>
          {run ? (
            <>
              <span>{`${by} by hand, author's estimate`}</span>
              {` → ${run} on the bench`}
            </>
          ) : (
            <span>{`${view.manual}, author's estimate`}</span>
          )}
        </span>
      ) : null}
      <span className="ch-chip">{`${view.playbook.apps.length} portals`}</span>
      {view.playbook.caveat ? <span className="ch-note">{firstSentence(view.playbook.caveat)}</span> : null}
    </span>
  );
}
