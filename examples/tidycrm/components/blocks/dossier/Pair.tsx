"use client";

/**
 * The identity pair, beside the rest.
 *
 * The one thing on this sheet no rule may resolve: merging destroys a record,
 * so the pair sits in its own region and says so in words, with the fields the
 * two records disagree about laid out side by side. The act that carries it out
 * is not here — it is behind the gate, where it belongs.
 */
import { CONFIDENT_AT } from "@/lib/constants";
import type { BkPair, BkTable } from "../model";
import { Band, SIDE_FIELDS } from "./parts";

export function DossierPair({
  table,
  pair,
  onPickPair,
}: {
  table: BkTable;
  pair: BkPair;
  onPickPair: (id: string) => void;
}) {
  return (
      <aside className="bk-pair-aside">
        <Band label="Unadjudicated identity pair" />
        <p className="bk-pair-why">
          No rule may resolve this. Merging destroys a record, so it waits for a person.
        </p>
        {table.pairs.length > 1 ? (
          <div className="bk-zone-strip" role="group" aria-label="Which pair">
            {table.pairs.map((p) => (
              <button
                key={p.id}
                type="button"
                className="bk-zone-chip"
                aria-pressed={p.id === pair.id}
                onClick={() => onPickPair(p.id)}
              >
                {p.id}
              </button>
            ))}
          </div>
        ) : null}
        <div className="bk-pair">
          <div className="bk-pair-sides">
            <div className="bk-side">
              <span className="bk-side-label">Survives</span>
              {SIDE_FIELDS.map((field) => {
                const differs = pair.conflicts.some((c) => c.field === field.key);
                return (
                  <span className="bk-field" key={field.key} data-differs={differs}>
                    <span className="bk-field-label">{field.label}</span>
                    {String(pair.keep[field.key] ?? "")}
                  </span>
                );
              })}
            </div>
            <div className="bk-side">
              <span className="bk-side-label">Folded in</span>
              {SIDE_FIELDS.map((field) => {
                const differs = pair.conflicts.some((c) => c.field === field.key);
                return (
                  <span className="bk-field" key={field.key} data-differs={differs}>
                    <span className="bk-field-label">{field.label}</span>
                    {String(pair.drop[field.key] ?? "")}
                  </span>
                );
              })}
            </div>
          </div>
          <p className="bk-lettering">
            Confidence is the sum of these weights — not a model score
          </p>
          <ul className="bk-evidence">
            {pair.evidence.map((rule) => (
              <li key={rule.rule}>
                <span className="bk-evidence-weight">+{rule.weight.toFixed(2)}</span>
                <span className="bk-evidence-detail">
                  <b>{rule.label}</b> — {rule.detail}
                </span>
              </li>
            ))}
            <li data-total="true">
              <span className="bk-evidence-weight">={pair.confidence.toFixed(2)}</span>
              <span className="bk-evidence-detail">
                {pair.confidence >= CONFIDENT_AT
                  ? "the rules agree; a person still signs it"
                  : "the rules do not agree; a person decides"}
              </span>
            </li>
          </ul>
        </div>
        {table.pairsHidden > 0 ? (
          <p className="bk-truncated">
            (showing {table.pairs.length} of {table.pairs.length + table.pairsHidden} pairs)
          </p>
        ) : null}
      </aside>
  );
}
