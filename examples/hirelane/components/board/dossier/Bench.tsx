"use client";

/**
 * The rest of the field, ranked beside the one being read.
 *
 * A score on its own is not a decision — 2.6 means nothing until you know
 * whether the other nine are above or below it. The unscored sit last and are
 * marked as unscored, because an absent measurement is not a low one and
 * sorting it as though it were would quietly bury the people nobody has read.
 */
import { fmtScore } from "../format";
import type { BdCandidate } from "../model";

export function DossierBench({
  bench,
  stage,
  candidate,
  onFocus,
}: {
  bench: BdCandidate[];
  /** What this queue is called, so the rail says where the field is standing. */
  stage: string;
  candidate: BdCandidate;
  onFocus: (id: string) => void;
}) {
  return (
    <aside className="bd-bench">
      <p className="bd-block-label">
        The field · {bench.length} at {stage}
      </p>
      <ul className="bd-bench-list">
        {bench.map((peer, i) => (
          <li key={peer.id}>
            <button
              type="button"
              className="bd-bench-row"
              data-self={peer.id === candidate.id}
              onClick={() => onFocus(peer.id)}
            >
              <span className="bd-rank">{i + 1}</span>
              <span className="bd-bench-name">{peer.name}</span>
              <span className="bd-bench-score">
                {fmtScore(peer.scored, peer.overall)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="bd-hand">
        ranked on the weighted score; the unscored sit last because an absent
        measurement is not a low one
      </p>
    </aside>
  );
}
