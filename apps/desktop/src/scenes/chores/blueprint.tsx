/**
 * A playbook's blueprint — README section 3.5, ADR 0096.
 *
 * The preview's hero: the process drawn flat, as a plan is, from the playbook's own data and
 * nothing else. The portals she reads are the sources on the left, each with its role, joined by
 * one bus to the spine; the spine is her steps in order, numbered, each kept to one line with the
 * whole sentence on hover; the gates sit on the spine as checkpoints, the places she stops and asks
 * for a signature; the flow ends in what she filed on the bench (or, unbenched, the bar it will be
 * held to), with the traps she walked past as a guard on it.
 *
 * Why the end sits under the spine and not in a third column: the pane is about 440px wide, and a
 * three-column plan at that width leaves a step about twenty characters, which says nothing. The
 * flow still runs one way, sources to spine to end. HTML, not SVG, so its type is the app's type at
 * every width; the lines are borders in theme tokens, so it reads in both themes.
 */
import type { PlaybookView } from "@/modules/playbooks/model";

import { blueprintOf } from "./model";

export default function Blueprint({ view }: { view: PlaybookView }) {
  const plan = blueprintOf(view);
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

  return (
    <figure className="ch-plan">
      <div className="ch-plan__sheet">
        <div className="ch-plan__in">
          <p className="ch-plan__head">Reads</p>
          <ul className="ch-plan__portals">
            {plan.portals.map((a) => (
              <li key={a.name} className="ch-plan__portal">
                <span className="ch-plan__name">{a.name}</span>
                {a.role ? (
                  <span className="ch-plan__role" title={a.role}>
                    {a.role}
                  </span>
                ) : null}
              </li>
            ))}
            {plan.morePortals ? (
              <li className="ch-plan__portal ch-plan__portal--more">
                <span className="ch-plan__role">{`and ${n(plan.morePortals, "more portal")}`}</span>
              </li>
            ) : null}
          </ul>
        </div>

        <div className="ch-plan__run">
          <p className="ch-plan__head">Works</p>
          <ol className="ch-plan__spine">
            {plan.steps.map((s, i) => (
              <li key={i} className="ch-plan__step">
                <span className="ch-plan__n" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="ch-plan__text" title={s}>
                  {s}
                </span>
              </li>
            ))}
            {plan.more ? (
              <li className="ch-plan__step ch-plan__step--more">
                <span className="ch-plan__n" aria-hidden="true">
                  …
                </span>
                <span className="ch-plan__text">{`and ${n(plan.more, "more step")}`}</span>
              </li>
            ) : null}
            {plan.gates.map((g) => (
              <li key={g.label} className="ch-plan__step ch-plan__gate" title={g.why}>
                <span className="ch-plan__n" aria-hidden="true" />
                <span className="ch-plan__text">
                  <span className="ch-plan__ask">You sign</span> {g.label}
                </span>
              </li>
            ))}
            {plan.moreGates ? (
              <li className="ch-plan__step ch-plan__step--more">
                <span className="ch-plan__n" aria-hidden="true">
                  …
                </span>
                <span className="ch-plan__text">{`and ${n(plan.moreGates, "more signature")}`}</span>
              </li>
            ) : null}
          </ol>
          <div className="ch-plan__end" data-measured={plan.result.measured ? "" : undefined}>
            <p className="ch-plan__head">{plan.result.measured ? "Filed on the bench" : "Will be held to"}</p>
            <p className="ch-plan__figure">{plan.result.figure}</p>
            <p className="ch-plan__role">{plan.result.line}</p>
            {plan.guard ? (
              <p className="ch-plan__guard">{`${plan.guard.avoided} of ${n(plan.guard.of, "trap")} walked past`}</p>
            ) : null}
          </div>
        </div>
      </div>
      <figcaption className="ch-note">
        {`Drawn from the playbook: ${n(plan.portals.length + plan.morePortals, "portal")} she reads, ${n(plan.steps.length + plan.more, "step")}, ${n(plan.gates.length + plan.moreGates, "signature")} she stops for.`}
      </figcaption>
    </figure>
  );
}
