/**
 * A chore's topic page — README section 3.5, ADR 0096.
 *
 * One playbook as a product page. A hero (the brief beside
 * its first still and three figures), the run drawn as a blueprint, every still of the run large,
 * and what to do with it. Escape, or the crumb, goes back to the catalogue.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import Button from "@/components/Button";
import type { Path } from "@/depth/model";
import { categoryLabel, jobLabel } from "@/lib/playbook-taxonomy";
import type { PlaybookView, PlaybooksModel } from "@/modules/playbooks/model";

import { adoptPath, beforeAfterOf, blueprintOf, lowerFirst, runPath, valueCell } from "./model";
import Lightbox from "./lightbox";
import { scrolls } from "./memory";
import Rich from "./rich";
import { stillsOf } from "./facts";
import Flow from "./flow";
import Glyph from "./glyphs";

export default function Topic({
  view,
  model,
  go,
  back,
}: {
  view: PlaybookView;
  model: PlaybooksModel;
  go: (to: Path) => void;
  back: () => void;
}) {
  const p = view.playbook;
  const stills = stillsOf(view);
  const [at, setAt] = useState<number | null>(null);
  // What the last press of "Copy the command" came to. Only the latest press may answer, so a
  // slow refusal never overwrites a later success.
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const press = useRef(0);
  const band = beforeAfterOf(view);
  const guard = blueprintOf(view).guard;
  const worth = valueCell(view);
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
              <Rich md={p.brief} className="pa-brief" />
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
                <span className="pa-kpi__label">Value</span>
                <span className="pa-kpi__n">{worth.figure}</span>
                <span className="pa-kpi__line">{`${worth.per}, for the persona`}</span>
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
                <span className="pa-kpi__line">{band.ratio || (band.athena ? "measured" : "not benched yet")}</span>
              </div>
              <div className="pa-kpi">
                <span className="pa-kpi__label">Traps avoided</span>
                <span className="pa-kpi__n">{guard ? `${guard.avoided}/${guard.of}` : p.traps.length || "–"}</span>
                <span className="pa-kpi__line">{guard ? "on the bench" : "known traps, not run"}</span>
              </div>
            </div>
          </div>
        </section>

        <Flow view={view} />

        <section className="pa-gallery" aria-labelledby="pa-gallery-h">
          <div className="pa-sechead">
            <h2 id="pa-gallery-h" className="pa-h2">
              See it run
            </h2>
            <p className="pa-muted">Real screens of the bench run, on an invented portal world.</p>
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
            <p className="pa-muted">{`Worth ${view.value} ${view.per} for ${p.persona ? lowerFirst(p.persona.replace(/^(A|An|The) /, (w) => w.toLowerCase())) : "the playbook's own case"}. Tell her what differs in yours; she looks up the rest and shows you the run before anything is real.`}</p>
          </div>
          <div className="pa-adopt__row">
            <Button variant="primary" onClick={() => go(adoptPath(p.id))}>
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
