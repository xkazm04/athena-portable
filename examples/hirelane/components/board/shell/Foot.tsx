"use client";

/**
 * The breadcrumb and the capability register.
 *
 * The register is two class bands rather than one row of pills, because seven
 * identically shaped chips in two hues fail the greyscale test — and the class
 * of a capability is exactly the thing that must survive being printed in black
 * and white. Grouped and set at opposite ends of the rule ladder, it passes.
 */
import { CAPABILITIES, isAuto } from "@/lib/manifest";
import type { BdCandidate, BdColumn, BdRole } from "../model";

/**
 * The manifest is not a drawer nobody opens (DESIGN-LAW §7.4), so the class of every capability is
 * on the surface — and it is the class of the capabilities THIS ROUTE HAS.
 *
 * Neither half of that used to be true. This was a hand-typed table of seven, under a comment
 * claiming it was derived. Then it was the board's own six, which was honest for as long as the
 * acts were mounted on a different route. They are mounted together now, on the one shipped route,
 * so the register is the union — `CAPABILITIES` in `lib/manifest.ts`, which is the same list both
 * registration files spread from. The class is computed, never typed, and the GATED band has three
 * rows in it because three of these acts reach a person and cannot be taken back.
 */
const REGISTER = CAPABILITIES.map((c) => ({ name: c.name, auto: isAuto(c) }));

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
      </div>
      {/*
       * The register, in its two classes rather than as a row of equal pills.
       *
       * DESIGN-LAW §7.1 asks for the distinction to survive the greyscale
       * test, and a strip where every entry carried the same 3px rule in a
       * different hue did not — remove the colour and the two classes were
       * identical. Grouped, labelled and set at opposite ends of the rule
       * ladder, it reads as the things that can be taken back against the
       * things that reach a person, which is the only sentence this app is
       * trying to say.
       *
       * The empty-band case is kept and it still renders when it happens: an
       * empty band is the honest answer to "what can an agent do here", and
       * omitting it would leave the reader to assume the acts that end
       * somebody's application are simply elsewhere on the page.
       */}
      <div className="bd-register">
        <div className="bd-register-group" data-class="AUTO">
          <p className="bd-block-label">AUTO — reversible</p>
          <ul>
            {REGISTER.filter((t) => t.auto).map((tool) => (
              <li key={tool.name}>{tool.name}</li>
            ))}
          </ul>
        </div>
        <div className="bd-register-group" data-class="GATED">
          <p className="bd-block-label">GATED — reaches a person, and cannot be taken back</p>
          <ul>
            {REGISTER.filter((t) => !t.auto).map((tool) => (
              <li key={tool.name}>{tool.name}</li>
            ))}
            {REGISTER.every((t) => t.auto) ? (
              <li data-empty="true">none here — the acts that reach a candidate are in the dossier</li>
            ) : null}
          </ul>
        </div>
      </div>
    </footer>
  );
}
