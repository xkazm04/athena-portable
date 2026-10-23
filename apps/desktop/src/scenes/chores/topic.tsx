/**
 * A chore's topic page — README section 3.5, ADR 0096.
 *
 * One playbook as a product page. A hero (the brief beside
 * its first still and three figures), the run drawn as a blueprint, every still of the run large,
 * and what to do with it. Escape, or the crumb, goes back to the catalogue.
 *
 * "Your case" (ADR 0123): the chore's saved cases, asked of the daemon through the studio's deps
 * (`GET /adopt/cases`), each opened in the studio with its approved brief and no re-interview. Each
 * state is said: no daemon in this window, looking, none saved yet, could not be looked up.
 *
 * "Your runs" (ADR 0124): under each case, the receipts of its runs (`./runs.tsx`).
 *
 * "When it comes due" (ADR 0131): under each case, the cadence she set and the review a due
 * occurrence opened, with "Open and prepare" (`./due.tsx`).
 *
 * Honest numbers (fix wave chores-uat, ADR 0133): one money headline, the example case's money back,
 * labelled as the invented example's; the author's estimate on one secondary line that opens on its
 * basis, sources and caveat (the basis and the caveat are markdown bullets, drawn by `Rich`, refilm-prep); the time saved with the person's review in it; the verdict and the runs
 * it stands on; and "Where it fits" from the playbook's `fit`, absent when it has none.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import Button from "@/components/Button";
import StatusDot from "@/components/StatusDot";
import type { Path } from "@/depth/model";
import type { CaseSummary } from "@/lib/adopt";
import { categoryLabel, jobLabel } from "@/lib/playbook-taxonomy";
import type { PlaybookView, PlaybooksModel } from "@/modules/playbooks/model";

import type { AdoptDeps } from "./adopt/deps";
import { why } from "./adopt/session";
import { dayOf } from "./adopt/state";
import { adoptPath, casePath, lowerFirst, runPath } from "./model";
import { beforeAfterOf, blueprintOf, fitRows, worthOf } from "./worth";
import Lightbox from "./lightbox";
import { scrolls } from "./memory";
import Rich from "./rich";
import { stillsOf } from "./facts";
import Flow from "./flow";
import Glyph from "./glyphs";
import Due from "./due";
import Runs from "./runs";

/** Where the two times come from: the hand figure is typed by the author, hers is measured (spark chores-uat recertify). */
const TIME_SOURCE = "by hand is the author's estimate, hers is from the test run";

/** What the topic page knows of the chore's saved cases (ADR 0123). */
export type CasesState =
  | { kind: "no-daemon" }
  | { kind: "looking" }
  | { kind: "found"; cases: CaseSummary[]; footer: string }
  | { kind: "failed"; offline: boolean; detail: string };

/** The saved cases of `playbookId`, asked once per mount. Without deps, it says there is no daemon. */
export function useCases(deps: AdoptDeps | undefined, playbookId: string): CasesState {
  // The answer is kept with what it answered, so a later chore or client never shows an old one.
  const [answer, set] = useState<{ for: string; client: unknown; state: CasesState } | null>(null);
  useEffect(() => {
    if (!deps) return;
    let live = true;
    const done = (state: CasesState) => live && set({ for: playbookId, client: deps.client, state });
    deps.client.cases(playbookId).then(
      (reply) => done({ kind: "found", cases: reply.cases, footer: reply.footer }),
      (error: unknown) => {
        const w = why(error);
        done({ kind: "failed", offline: w.reason === "offline", detail: w.detail || w.reason });
      },
    );
    return () => {
      live = false;
    };
  }, [deps, playbookId]);
  if (!deps) return { kind: "no-daemon" };
  if (answer === null || answer.for !== playbookId || answer.client !== deps.client) return { kind: "looking" };
  return answer.state;
}

/** The one line the "Your case" block says when it has no case to show, or "" when it has. */
export function casesLine(state: CasesState): string {
  switch (state.kind) {
    case "no-daemon":
      return "Saved cases are kept by Athena's daemon, and no daemon is connected to this window.";
    case "looking":
      return "Looking for a case you saved…";
    case "failed":
      return state.offline
        ? "Your saved case could not be looked up: the daemon is not running."
        : `Your saved case could not be looked up: ${state.detail}`;
    case "found":
      return state.cases.length
        ? ""
        : "No saved case yet. Approve a brief with her and she keeps it here, so next time nothing is asked twice.";
  }
}

export default function Topic({
  view,
  model,
  go,
  back,
  deps,
}: {
  view: PlaybookView;
  model: PlaybooksModel;
  go: (to: Path) => void;
  back: () => void;
  /** The studio's client; the page asks it only for the saved cases (ADR 0123). */
  deps?: AdoptDeps;
}) {
  const p = view.playbook;
  const saved = useCases(deps, p.id);
  const cases = saved.kind === "found" ? saved.cases : [];
  const latest = cases[0];
  const stills = stillsOf(view);
  const [at, setAt] = useState<number | null>(null);
  // What the last press of "Copy the command" came to. Only the latest press may answer, so a
  // slow refusal never overwrites a later success.
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const press = useRef(0);
  const band = beforeAfterOf(view);
  const guard = blueprintOf(view).guard;
  const worth = worthOf(view);
  const fit = fitRows(p.fit);
  const trace = p.bench?.trace ?? [];

  // Escape goes back, unless the lightbox holds it (it stops the key itself), a field is typed in,
  // or this is a leaving layer (inert). An open lightbox that has lost the focus (a click on the
  // stage's chrome) is closed by it, never left open over the catalogue. It claims the key, so the
  // stage does not rise a second time.
  const root = useRef<HTMLDivElement>(null);
  const open = at !== null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (root.current?.closest("[inert]")) return;
      e.preventDefault();
      if (open) setAt(null);
      else back();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [back, open]);

  // Back from the studio or the replay, the page is where the person left it, not at its top.
  useLayoutEffect(() => {
    const top = scrolls.get(p.id);
    if (top && root.current) root.current.scrollTop = top;
  }, [p.id]);

  const hero = stills[0];

  return (
    <div className="pa-page" ref={root} onScroll={(e) => scrolls.set(p.id, e.currentTarget.scrollTop)}>
      <div className="pa-wrap pa-topic">
        <button type="button" className="pa-crumb focus-ring" onClick={back}>
          <span aria-hidden="true">←</span> All playbooks
        </button>

        <section className="pa-hero" aria-labelledby="pa-title">
          <div className="pa-hero__text">
            <p className="pa-eyebrow">
              <Glyph id={p.category} size={18} />
              {`${categoryLabel(p.category)} · ${jobLabel(p.job)}`}
            </p>
            <h1 id="pa-title" className="pa-title">
              {p.shortTitle}
            </h1>
            {p.brief.trim() ? (
              <>
                <p className="pa-tag">Invented example case: its names and figures are not yours</p>
                <Rich md={p.brief} className="pa-brief" />
              </>
            ) : (
              <p className="pa-brief pa-brief--promise">{p.promise}</p>
            )}
          </div>

          <div className="pa-hero__side">
            {hero ? (
              <button
                type="button"
                className="pa-shot focus-ring"
                onClick={() => setAt(0)}
                aria-label={`Enlarge: ${hero.caption}`}
              >
                <img src={hero.url} alt={hero.caption} decoding="async" />
                <span className="pa-shot__enlarge" aria-hidden="true">
                  ⤢ Enlarge
                </span>
              </button>
            ) : (
              <div className="pa-shot pa-shot--none">
                <Glyph id={p.category} size={48} />
                <span>No screens captured for this run yet.</span>
              </div>
            )}

            <div className="pa-kpis">
              <div className="pa-kpi">
                <span className="pa-kpi__label">In the example case</span>
                {worth.example ? (
                  <>
                    <span className="pa-kpi__n">{worth.example}</span>
                    <span className="pa-kpi__line">back, in the invented example</span>
                  </>
                ) : (
                  <span className="pa-kpi__line pa-kpi__line--words">{worth.instead}</span>
                )}
              </div>
              <div className="pa-kpi">
                <span className="pa-kpi__label">Time saved</span>
                <span className="pa-kpi__n pa-kpi__n--pair">
                  {band.manual.figure}
                  <span className="pa-kpi__to" aria-hidden="true">
                    →
                  </span>
                  {band.athena?.figure ?? "–"}
                </span>
                <span className="pa-kpi__line">
                  {band.athena
                    ? [band.athena.review, band.ratio, TIME_SOURCE].filter(Boolean).join(" · ")
                    : "not tested yet"}
                </span>
              </div>
              <div className="pa-kpi">
                <span className="pa-kpi__label">Mistakes avoided</span>
                <span className="pa-kpi__n">{guard ? `${guard.avoided}/${guard.of}` : p.traps.length || "–"}</span>
                <span className="pa-kpi__line">{guard ? "in the test run" : "known mistakes, not tested"}</span>
              </div>
            </div>

            <p className="pa-verdict">
              <StatusDot tone={view.verdict.tone} />
              <span className="pa-verdict__label">{view.verdict.label}</span>
              <span className="pa-verdict__text">{view.verdict.sentence}</span>
            </p>

            <details className="pa-estimate">
              <summary className="pa-estimate__sum focus-ring">{worth.estimate}</summary>
              <div className="pa-estimate__body">
                {worth.basis ? <Rich md={worth.basis} className="pa-estimate__basis" /> : <p className="pa-muted">The author gave no basis for this estimate.</p>}
                {worth.sources.length ? (
                  <ul className="pa-estimate__sources" aria-label="Sources">
                    {worth.sources.map((s) => (
                      <li key={s.url}>
                        <button type="button" className="pa-link focus-ring" onClick={() => model.actions.open(s.url)}>
                          {s.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {worth.caveat ? <Rich md={worth.caveat} className="pa-estimate__caveat pa-muted" /> : null}
              </div>
            </details>
          </div>
        </section>

        {fit.length ? (
          <section className="pa-fit" aria-labelledby="pa-fit-h">
            <h2 id="pa-fit-h" className="pa-h2">
              Where it fits
            </h2>
            <dl className="pa-fit__rows">
              {fit.map((r) => (
                <div key={r.label} className="pa-fit__row">
                  <dt>{r.label}</dt>
                  <dd>{r.text}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <Flow view={view} />

        <section className="pa-gallery" aria-labelledby="pa-gallery-h">
          <div className="pa-sechead">
            <h2 id="pa-gallery-h" className="pa-h2">
              See it run
            </h2>
            <p className="pa-muted">Screens of the test run, on invented portals</p>
          </div>
          {stills.length ? (
            <ul className="pa-grid">
              {stills.map((s, i) => (
                <li key={s.url}>
                  <button type="button" className="pa-frame focus-ring" onClick={() => setAt(i)} aria-label={`Enlarge: ${s.caption}`}>
                    <img src={s.url} alt="" loading="lazy" decoding="async" />
                  </button>
                  <p className="pa-frame__cap">
                    <span className="pa-frame__n">{i + 1}</span>
                    {s.caption}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pa-muted">No step screens captured for this run yet.</p>
          )}
        </section>

        <section className="pa-adopt" aria-labelledby="pa-adopt-h">
          <div className="pa-adopt__head">
            <h2 id="pa-adopt-h" className="pa-h2">
              Make it yours
            </h2>
            <p className="pa-muted">{`This page shows an invented example case${p.persona ? `: ${lowerFirst(p.persona.replace(/^(A|An|The) /, (w) => w.toLowerCase()))}` : ""}. Tell her what differs in yours; she looks up the rest and shows you the run before anything is real.`}</p>
          </div>
          <div className="pa-adopt__case" aria-labelledby="pa-case-h">
            <h3 id="pa-case-h" className="pa-kpi__label">
              Your case
            </h3>
            {cases.length ? (
              <ul className="pa-cases">
                {cases.map((c) => (
                  <li key={c.case_id} className="pa-case">
                    <span className="pa-case__title">{c.title || p.shortTitle}</span>
                    <span className="pa-case__when">{`Last approved ${dayOf(c.approved_at)} · draft ${c.approved_rev} · ${c.confirmed} of ${c.slots} confirmed`}</span>
                    {cases.length > 1 ? (
                      <Button variant="ghost" size="sm" onClick={() => go(casePath(p.id, c.case_id))}>
                        Open this case
                      </Button>
                    ) : null}
                    {deps?.chores ? <Due chores={deps.chores} caseId={c.case_id} actions={model.actions} /> : null}
                    {deps ? <Runs deps={deps} caseId={c.case_id} /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pa-muted" role="status">
                {casesLine(saved)}
              </p>
            )}
            {saved.kind === "found" && saved.footer ? <p className="pa-muted">{saved.footer}</p> : null}
          </div>
          <div className="pa-adopt__row">
            {latest ? (
              <Button variant="primary" onClick={() => go(casePath(p.id, latest.case_id))}>
                Open your case
              </Button>
            ) : null}
            <Button variant={latest ? "secondary" : "primary"} onClick={() => go(adoptPath(p.id))}>
              Talk it through with her
            </Button>
            {trace.length ? (
              <Button variant="secondary" onClick={() => go(runPath(p.id, 0))}>
                Watch the run turn by turn
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => {
                const n = ++press.current;
                const answer = (result: "copied" | "failed") => () => {
                  if (n === press.current) setCopied(result);
                };
                void model.actions.copy(p.command).then(answer("copied"), answer("failed"));
              }}
            >
              Copy the command
            </Button>
          </div>
          <p className="pa-muted pa-said" role="status">
            {copied === "copied"
              ? "Sent the command to the clipboard."
              : copied === "failed"
                ? "Copying did not work here. Select the command below and copy it yourself."
                : ""}
          </p>
          {copied === "failed" ? (
            <pre className="pa-command" aria-label="The command">
              {p.command}
            </pre>
          ) : null}
        </section>
      </div>

      <Lightbox stills={stills} at={at} onAt={setAt} onClose={() => setAt(null)} />
    </div>
  );
}
