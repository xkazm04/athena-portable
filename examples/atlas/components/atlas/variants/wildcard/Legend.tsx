"use client";

/**
 * THE KEY — what a mark means, and the one number the whole direction exists to print.
 *
 * Archify's practice, adopted (study §2): the legend counts, and it shows only what is on the
 * field. Its own practice, NOT adopted: it is not a filter. This surface already has one filter —
 * the lens, which is the shell's and belongs to the claims rail — and the archify study's own
 * rule 13 is "one details destination, never a new panel per feature". A second, competing
 * dimming mode would make two things that both look like the answer.
 *
 * THE HEADLINE IS THE EMPTY TRIANGLE. `breaches` counts the marks standing in the fifteen blocks
 * where a module would be reaching back UP the stack. It is zero, which is README §3.1's promise
 * ("packages depend on ports, never on concrete classes") stated as a measurement rather than as
 * a sentence — and it is the number that would move if the architecture ever started to fold.
 */
import { useMemo } from "react";

import type { EdgeKind } from "@/data";

import { KIND_GLYPH } from "./Field";
import { MARKS, MATRIX_COUNTS, inDegree, outDegree } from "./matrix";

const SENSES = [
  { id: "down", label: "down the stack" },
  { id: "flat", label: "inside one layer" },
  { id: "up", label: "back up the stack" },
] as const;

const GRAINS = [
  { band: 0, label: "layers", n: MATRIX_COUNTS.layers },
  { band: 1, label: "systems", n: MATRIX_COUNTS.systems },
  { band: 2, label: "modules", n: MATRIX_COUNTS.axis },
] as const;

export interface LegendProps {
  band: 0 | 1 | 2;
  /** The open component's axis index, or −1. Its two degrees are drawn as bars. */
  row: number;
}

export function Legend({ band, row }: LegendProps) {
  const tallies = useMemo(() => {
    const sense = new Map<string, number>();
    const kind = new Map<EdgeKind, number>();
    for (const m of MARKS) {
      sense.set(m.sense, (sense.get(m.sense) ?? 0) + 1);
      for (const k of m.kinds) kind.set(k, (kind.get(k) ?? 0) + 1);
    }
    const top = Math.max(1, ...kind.values());
    return { sense, kind, top };
  }, []);

  const out = row >= 0 ? outDegree(row) : 0;
  const into = row >= 0 ? inDegree(row) : 0;
  const most = Math.max(1, out, into);

  return (
    <aside className="wc-legend" aria-label="What a mark means">
      <ol className="wc-grain" aria-label="The grain the field is drawn at">
        {GRAINS.map((g) => (
          <li key={g.label} className="wc-grain-step" data-on={g.band === band ? "" : undefined}>
            <span className="wc-grain-dot" aria-hidden />
            <span className="wc-grain-n">{g.n}</span>
            <span className="wc-grain-label">{g.label}</span>
          </li>
        ))}
      </ol>

      <ul className="wc-key" aria-label="Which way a mark runs">
        {SENSES.map((s) => (
          <li key={s.id} className="wc-key-row" data-empty={(tallies.sense.get(s.id) ?? 0) === 0 ? "" : undefined}>
            <span className="wc-key-swatch" data-sense={s.id} aria-hidden />
            <span className="wc-key-label">{s.label}</span>
            <span className="wc-key-n">{tallies.sense.get(s.id) ?? 0}</span>
          </li>
        ))}
      </ul>

      <ul className="wc-key wc-key-kinds" aria-label="What kind of relationship">
        {(Object.keys(KIND_GLYPH) as EdgeKind[]).map((k) => (
          <li key={k} className="wc-key-row">
            <span className="wc-key-glyph" aria-hidden>
              {KIND_GLYPH[k]}
            </span>
            <span className="wc-key-label">{k}</span>
            <span
              className="wc-key-bar"
              style={{ "--wc-w": (tallies.kind.get(k) ?? 0) / tallies.top } as never}
              aria-hidden
            />
            <span className="wc-key-n">{tallies.kind.get(k) ?? 0}</span>
          </li>
        ))}
      </ul>

      <p className="wc-claim" data-kept={MATRIX_COUNTS.breaches === 0 ? "" : undefined}>
        <span className="wc-claim-n">{MATRIX_COUNTS.breaches}</span>
        <span className="wc-claim-label">
          marks in the {MATRIX_COUNTS.zones} hatched blocks — a module reaching back up the stack
        </span>
      </p>

      {row >= 0 ? (
        <dl className="wc-degrees" aria-label="The open module's two degrees">
          <div className="wc-degree">
            <dt>asks</dt>
            <dd>
              <span className="wc-key-bar" style={{ "--wc-w": out / most } as never} aria-hidden />
              <span className="wc-key-n">{out}</span>
            </dd>
          </div>
          <div className="wc-degree">
            <dt>is asked</dt>
            <dd>
              <span className="wc-key-bar" style={{ "--wc-w": into / most } as never} aria-hidden />
              <span className="wc-key-n">{into}</span>
            </dd>
          </div>
        </dl>
      ) : null}
    </aside>
  );
}
