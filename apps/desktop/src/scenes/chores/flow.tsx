/**
 * "How it runs" — README section 3.5, ADR 0096.
 *
 * The playbook drawn as a blueprint, from its own data only. The
 * portals it reads are the sources down the left, the steps a numbered spine that wraps to a
 * second row past four, every gate an amber "asks you first" diamond on the spine before the step
 * it guards, and the result node on the right: what her test run found, money back only as dollars
 * (ADR 0133), or the bar it will be held to.
 */
import type { PlaybookView } from "@/modules/playbooks/model";

import { shortLine } from "./model";
import { blueprintOf } from "./worth";
import { gateSlots } from "./facts";

type Mark = { kind: "step"; n: number; text: string; portals: string[] } | { kind: "gate"; label: string; why: string };

export default function Flow({ view }: { view: PlaybookView }) {
  const p = view.playbook;
  const plan = blueprintOf(view);
  const slots = gateSlots(p.steps, p.gates);

  // The spine in reading order: each gate just before the step it guards, the unplaced ones last.
  const marks: Mark[] = [];
  p.steps.forEach((text, i) => {
    p.gates.forEach((g, gi) => {
      if (slots[gi] === i) marks.push({ kind: "gate", label: g.label, why: g.why });
    });
    const portals = p.apps.filter((a) => text.includes(a.name)).map((a) => a.name);
    marks.push({ kind: "step", n: i + 1, text, portals });
  });
  p.gates.forEach((g, gi) => {
    if (slots[gi] === -1) marks.push({ kind: "gate", label: g.label, why: g.why });
  });

  const steps = p.steps.length;
  // Up to four steps in a row; past that, rows of an even share (5 is 3 + 2, 6 is 3 + 3, 9 is 3 + 3 + 3).
  const cap = p.gates.length >= 2 && steps > 3 ? 3 : 4;
  const perRow = steps <= cap ? Math.max(steps, 1) : Math.ceil(steps / Math.ceil(steps / cap));
  const rows: Mark[][] = [];
  let row: Mark[] = [];
  let inRow = 0;
  for (const m of marks) {
    if (m.kind === "step" && inRow === perRow) {
      rows.push(row);
      row = [];
      inRow = 0;
    }
    row.push(m);
    if (m.kind === "step") inRow += 1;
  }
  if (row.length) rows.push(row);

  return (
    <section className="pa-flow" aria-labelledby="pa-flow-h">
      <div className="pa-sechead">
        <h2 id="pa-flow-h" className="pa-h2">
          How it runs
        </h2>
        <p className="pa-legend">
          <span className="pa-legend__item">
            <span className="pa-legend__sw pa-legend__sw--portal" aria-hidden="true" />
            Portal she reads
          </span>
          <span className="pa-legend__item">
            <span className="pa-legend__sw pa-legend__sw--step" aria-hidden="true" />
            Step
          </span>
          <span className="pa-legend__item">
            <span className="pa-legend__sw pa-legend__sw--gate" aria-hidden="true" />
            Athena asks you first
          </span>
        </p>
      </div>

      <div className="pa-blueprint">
        <ol className="pa-sources" aria-label="Portals">
          {p.apps.map((a) => (
            <li key={a.name} className="pa-source">
              <span className="pa-source__name">{a.name}</span>
              <span className="pa-source__role">{shortLine(a.role, 70)}</span>
            </li>
          ))}
        </ol>

        <div className="pa-spine" aria-label="Steps">
          {rows.map((r, ri) => (
            <ol key={ri} className="pa-spine__row">
              {r.map((m, mi) =>
                m.kind === "step" ? (
                  <li key={`s${m.n}`} className="pa-step">
                    <span className="pa-step__n" aria-hidden="true">
                      {m.n}
                    </span>
                    <span className="pa-step__text">{m.text}</span>
                    {m.portals.length ? (
                      <span className="pa-step__via">
                        {m.portals.map((name) => (
                          <span key={name} className="pa-step__portal">
                            {name}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </li>
                ) : (
                  <li key={`g${mi}`} className="pa-gate" title={m.why}>
                    <span className="pa-gate__diamond" aria-hidden="true">
                      !
                    </span>
                    <span className="pa-gate__ask">Athena asks you first</span>
                    <span className="pa-gate__label">{m.label}</span>
                  </li>
                ),
              )}
            </ol>
          ))}
          {plan.guard ? (
            <p className="pa-spine__note">{`In the test run she avoided ${plan.guard.avoided} of ${plan.guard.of} mistakes the example case set up.`}</p>
          ) : null}
          <div className="pa-result" data-measured={plan.result.measured ? "" : undefined}>
            <span className="pa-result__eyebrow">{plan.result.measured ? "Found in the test run" : "Not tested yet"}</span>
            <span className="pa-result__n">{plan.result.figure}</span>
            <span className="pa-result__line">{plan.result.line}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
