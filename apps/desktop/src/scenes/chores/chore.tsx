/**
 * One chore, composed — README section 3.5, ADR 0040, 0053, 0055, 0087 and 0089.
 *
 * The item level of the Chores depth. The chore's own drawing and its name in display type, its
 * promise, the caveat that must be read before it is used, the bench at a glance with the standing
 * line, and the two things a person does with it: copy the command, or hand it to Athena. Under
 * that, the old layer's facets, all one click away and none hidden behind hover: the chore side
 * (what it asks, the portals each with Open, the method, where she stops for a signature) and the
 * proof side (what she filed, the traps, the run, the film with its currency check, what it taught
 * her, why it is worth it). The replay itself is the next level down.
 *
 * Which facet is open, and what was just copied or opened, is the view's own state.
 */
import { useState } from "react";

import ChoreArt from "@/art/chore";
import Badge from "@/components/Badge";
import Button from "@/components/Button";
import StatusDot from "@/components/StatusDot";
import type { Path } from "@/depth/model";
import { minutes } from "@/lib/playbooks";
import { facetsOf, visitsOf, type Facet, type FacetId, type PlaybookView, type PlaybooksModel } from "@/modules/playbooks/model";

import { artFor, firstSentence, runPath } from "./model";
import { Film, Glance, Lessons, Money, Proof, Prose, Runs, TrapLedger } from "./parts";

const GROUPS: { id: Facet["group"]; title: string }[] = [
  { id: "chore", title: "The chore" },
  { id: "proof", title: "The proof" },
];

export default function Chore({
  view,
  model,
  go,
  initialFacet = null,
}: {
  view: PlaybookView;
  model: PlaybooksModel;
  go: (to: Path) => void;
  /** Preview only: the facet open on first render. */
  initialFacet?: FacetId | null;
}) {
  const p = view.playbook;
  const facets = facetsOf(view);
  const [facet, setFacet] = useState<FacetId>(
    initialFacet !== null && facets.some((f) => f.id === initialFacet) ? initialFacet : "chore",
  );
  const [said, setSaid] = useState("");
  const current = facets.find((f) => f.id === facet) ?? facets[0]!;

  return (
    <div className="chores ch-chore">
      <header className="ch-chore__top">
        <div className="ch-chore__art">
          <ChoreArt facts={artFor(view)} size={340} float />
          <p className="ch-note">Stylised drawing of this chore: its portals, her route, the seal where she stops. Not a screenshot.</p>
        </div>

        <div className="ch-chore__intro">
          <p className="ch-eyebrow">{[p.domain, p.persona].filter(Boolean).join(" · ") || "Chore"}</p>
          <h1 className="ch-marquee ch-marquee--chore">{view.title}</h1>
          <p className="ch-promise">{p.promise}</p>
          {p.caveat ? (
            <p className="ch-body ch-flag" role="note">
              <StatusDot tone="warning" />
              {firstSentence(p.caveat)}
            </p>
          ) : null}
          <div className="ch-worth">
            <span className="ch-worth__n">{view.value}</span>
            <span className="ch-note">{`${view.per}, author's estimate`}</span>
            <Badge tone={view.verdict.tone}>{view.verdict.label}</Badge>
            {view.onEdge ? <span className="ch-edge-flag">On the edge</span> : null}
            {view.speed ? <span className="ch-data">{view.speed}</span> : null}
          </div>
          <div className="ch-actions">
            <Button
              variant="secondary"
              onClick={() => {
                model.actions.copy(p.command);
                setSaid("Sent the command to the clipboard.");
              }}
            >
              Copy the command
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                model.actions.hand(p.command, { id: p.id, title: view.title });
                setSaid("Handed to her. It waits in her composer until you send it.");
              }}
            >
              Hand it to Athena
            </Button>
            <span className="ch-note" role="status">
              {said}
            </span>
          </div>
        </div>

        <Glance view={view} onOpen={() => setFacet("result")} />
      </header>

      <div className="ch-chore__body">
        <nav className="ch-facets" aria-label="Parts of this playbook">
          {GROUPS.map((g) => (
            <section key={g.id} className="ch-facets__group" aria-label={g.title}>
              <h2 className="ch-label ch-facets__title">{g.title}</h2>
              <ul className="ch-facets__list">
                {facets
                  .filter((f) => f.group === g.id)
                  .map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        className="ch-facet focus-ring"
                        aria-current={f.id === facet ? "page" : undefined}
                        onClick={() => setFacet(f.id)}
                      >
                        <span className="ch-facet__text">
                          <span className="ch-facet__title">{f.title}</span>
                          <span className="ch-note">{f.summary}</span>
                        </span>
                        {f.figure ? <span className="ch-facet__figure ch-data">{f.figure}</span> : null}
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </nav>

        <section className="ch-panel" aria-label={current.title} key={facet}>
          <h2 className="ch-panel__title">{current.title}</h2>
          <FacetBody view={view} model={model} facet={facet} go={go} />
        </section>
      </div>
    </div>
  );
}

function FacetBody({
  view,
  model,
  facet,
  go,
}: {
  view: PlaybookView;
  model: PlaybooksModel;
  facet: FacetId;
  go: (to: Path) => void;
}) {
  const p = view.playbook;
  const b = p.bench;
  // What the last "Open" did, said under the list: a tab was made in the Browser.
  const [opened, setOpened] = useState("");
  const open = (url: string, name: string) => {
    model.actions.open(url);
    setOpened(`Opened ${name} in a Browser tab.`);
  };

  switch (facet) {
    case "chore":
      return (
        <>
          {p.persona ? <p className="ch-label">{p.persona}</p> : null}
          <p className="ch-body ch-reading">{p.chore}</p>
          <h3 className="ch-title">Tell Athena</h3>
          <p className="ch-note">Handed over, it waits in her composer until you send it.</p>
          <blockquote className="ch-command">{p.command}</blockquote>
          {p.caveat ? (
            <p className="ch-body ch-flag" role="note">
              <StatusDot tone="warning" />
              {p.caveat}
            </p>
          ) : null}
        </>
      );
    case "portals":
      return (
        <>
          <ul className="ch-portals">
            {p.apps.map((a) => (
              <li key={a.name} className="ch-portal">
                <span className="ch-portal__text">
                  <span className="ch-title">{a.name}</span>
                  <span className="ch-note">{a.role}</span>
                </span>
                {a.api ? <span className="ch-chip">{a.api}</span> : null}
                {a.url ? (
                  <Button size="sm" variant="ghost" onClick={() => open(a.url, a.name)}>
                    Open
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="ch-note" role="status">
            {opened}
          </p>
        </>
      );
    case "method":
      return (
        <>
          {p.steps.length ? (
            <ol className="ch-steps">
              {p.steps.map((s) => (
                <li key={s} className="ch-body">
                  {s}
                </li>
              ))}
            </ol>
          ) : null}
          {p.memory.length ? (
            <>
              <h3 className="ch-title">What she learns once</h3>
              <ul className="ch-list">
                {p.memory.map((m) => (
                  <li key={m} className="ch-body">
                    {m}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      );
    case "gates":
      return (
        <ul className="ch-list ch-list--bare">
          {p.gates.map((g) => (
            <li key={g.action} className="ch-gate">
              <span className="ch-gate__tag ch-label">GATED</span>
              <span>
                <span className="ch-title">{g.label}</span>
                <span className="ch-note">{` — ${g.why}`}</span>
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
            <>
              <h3 className="ch-title">What she must not fall for</h3>
              <ul className="ch-list">
                {p.traps.map((t) => (
                  <li key={t} className="ch-body">
                    {t}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      );
    case "run":
      return b?.trace.length ? (
        <>
          <RunTeaser view={view} go={go} />
          {b.closingWords ? (
            <figure className="ch-quote-figure">
              <blockquote className="ch-quote ch-body">
                <Prose text={b.closingWords} />
              </blockquote>
              <figcaption className="ch-note">{`Athena, at the end of the run (${b.engine} ${b.model})`}</figcaption>
            </figure>
          ) : null}
          {b.history.length ? (
            <>
              <h3 className="ch-title">Every run</h3>
              <Runs bench={b} />
            </>
          ) : null}
        </>
      ) : null;
    case "evidence":
      return view.evidence ? <Film film={view.evidence} /> : null;
    case "lessons":
      return <Lessons playbook={p} />;
    case "money":
      return (
        <>
          <Money playbook={p} onOpen={(url) => open(url, "the source")} />
          <p className="ch-note" role="status">
            {opened}
          </p>
        </>
      );
  }
}

/** The run as a route of tab visits, with the way into the replay at its first turn. */
function RunTeaser({ view, go }: { view: PlaybookView; go: (to: Path) => void }) {
  const b = view.playbook.bench;
  if (!b) return null;
  const visits = visitsOf(b.trace);
  return (
    <div className="ch-teaser">
      <p className="ch-body">
        {`${b.trace.length} turns across ${visits.length} tab visits, ${minutes(b.wallS / 60)} on the bench.`}
      </p>
      <ol className="ch-route" aria-label="Tab visits, in order">
        {visits.map((v) => (
          <li key={`${v.portal}-${v.from}`} className="ch-route__visit">
            <span className="ch-label" title={v.portal}>
              {v.portal}
            </span>
            <span className="ch-note">{v.to === v.from ? `turn ${v.from + 1}` : `turns ${v.from + 1} to ${v.to + 1}`}</span>
          </li>
        ))}
      </ol>
      <Button variant="primary" onClick={() => go(runPath(view.id, 0))}>
        Watch the run
      </Button>
    </div>
  );
}

