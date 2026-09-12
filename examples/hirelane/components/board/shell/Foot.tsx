"use client";

/**
 * The breadcrumb and the capability line.
 *
 * WHAT THIS USED TO BE. Two bands printing all sixteen tool names in monospace, across the full
 * width of the page, under two tracked-caps headings — `AUTO — REVERSIBLE` over
 * `navigate score_against_rubric add_note move_stage …`. It was a hundred and eighty pixels of
 * identifiers nobody reads, it took the room the carousel needed one level up, and it ran under
 * the dev overlay in the corner. `score_against_rubric` is a symbol in a protocol; a reader wants
 * to know how many acts an agent is offered here and how many of them reach a person.
 *
 * SO: the counts are the line, and the names are behind a disclosure — which is still "on the
 * surface" in the sense DESIGN-LAW §7.4 means, because the claim (sixteen, three of them gated)
 * is visible without interaction and it is the claim that matters. The names are the evidence for
 * it, one click away, and they keep their two class bands when opened.
 *
 * THE PRESENCE READING MOVED HERE. It used to be a sentence in the masthead; the masthead is
 * gone, because these surfaces are the environment an agent works in rather than a console a
 * person drives, and a line telling a reader "Athena is not connected" above the fold addresses
 * somebody who is not the audience. DESIGN-LAW §4.1 is amended to match and is explicit that the
 * reading may be MOVED and not deleted — §9.13 still requires it on the surface, without
 * interaction, computed rather than typed. This summary is now the one place that makes any claim
 * about whether an agent is here, and it reads the same `presence.ts` the masthead did.
 */
import { useAthenaPresence } from "../presence";
import type { BdCandidate, BdColumn, BdRole } from "../model";
import { CAPABILITY_COUNTS, REGISTER } from "../register";

export function BoardFoot({
  totals,
  role,
  column,
  candidate,
  level,
  nav,
}: {
  totals: { roles: number; applicants: number; scored: number; borderline: number };
  role: BdRole | undefined;
  column: BdColumn | undefined;
  candidate: BdCandidate | undefined;
  level: number;
  nav: { up: () => void };
}) {
  const presence = useAthenaPresence();
  return (
    <footer className="bd-foot">
      <div className="bd-crumbs">
        <span className="bd-crumb">
          <b>The pipeline</b>
          <i>
            {totals.roles} {totals.roles === 1 ? "role" : "roles"} · {totals.applicants}{" "}
            applicants
          </i>
        </span>
        {role && column ? (
          <span className="bd-crumb">
            <b>
              {role.title} · {column.label}
            </b>
            <i>
              {column.candidates.length} here · {column.scored} scored
            </i>
          </span>
        ) : null}
        {candidate ? (
          <span className="bd-crumb">
            <b>{candidate.name}</b>
            <i>{candidate.line}</i>
          </span>
        ) : null}
        {level > 0 ? (
          <button type="button" className="bd-back" onClick={nav.up}>
            <span aria-hidden>←</span> back <kbd>Esc</kbd>
          </button>
        ) : null}

        {/*
         * The register, as one sentence and a disclosure.
         *
         * The two classes still separate before any colour is spent: AUTO on a hairline, GATED on
         * the heaviest weight the direction has. Desaturate the page and the distinction survives,
         * which is what §7.1 asks and what a strip of identically-shaped badges in two hues could
         * not do.
         */}
        <details className="bd-register">
          <summary>
            <span className="bd-presence" data-on={presence.bridged}>
              {presence.bridged ? "Athena is connected" : "Athena is not connected"}
            </span>
            <span className="bd-register-count">
              {CAPABILITY_COUNTS.all} capabilities offered
            </span>
            <span className="bd-register-gated">{CAPABILITY_COUNTS.gated} gated</span>
          </summary>
          <div className="bd-register-body">
            <div className="bd-register-group" data-class="AUTO">
              <p className="bd-class" data-class="AUTO">
                Auto — reversible, and each writes an undo
              </p>
              <ul>
                {REGISTER.filter((t) => t.auto).map((tool) => (
                  <li key={tool.name}>{tool.name}</li>
                ))}
              </ul>
            </div>
            <div className="bd-register-group" data-class="GATED">
              <p className="bd-class" data-class="GATED">
                Gated — reaches a person, and cannot be taken back
              </p>
              <ul>
                {REGISTER.filter((t) => !t.auto).map((tool) => (
                  <li key={tool.name}>{tool.name}</li>
                ))}
                {/* An empty band still renders: "nothing here reaches anybody" is the honest
                    answer to what an agent can do, and omitting it would leave a reader to assume
                    the acts that end an application are simply somewhere else. */}
                {REGISTER.every((t) => t.auto) ? (
                  <li data-empty="true">
                    none here — the acts that reach a candidate are in the dossier
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </details>
      </div>
    </footer>
  );
}
