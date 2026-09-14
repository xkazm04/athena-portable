"use client";

/**
 * THE LENS RAIL — seventeen claims this repository makes, each one a way of looking at the
 * machine.
 *
 * Choosing a claim is not navigation and it does not change level: it is a LIGHT. The concept
 * names the components that carry it, those name their systems, those name their strata
 * (`lensFor` in `@/data`, one derivation, memoised), and the whole set goes to `nav.highlight` —
 * the kit model's own answer to "what is something pointing at" — so every renderer asks the
 * SAME question and a block cannot be lit in one variant and dark in another.
 *
 * WHY A RAIL AND NOT A SCENE OBJECT. Round 2's Atlas made the claims the L0 population and the
 * owner's correction is that the machine is the subject; a claim is a question you ask ABOUT the
 * machine. A rail is what a question asked about a picture looks like: beside it, secondary, and
 * never occluding the thing it is a question about.
 *
 * The count on each row is the answer before you click — how many of the sixty-eight components
 * carry the claim — which makes the rail a small piece of evidence in its own right: invariant 3
 * lights eight modules, and a claim that lit one would be a claim this repository is not really
 * making.
 */
import { CONCEPTS, COUNTS, lensFor, type ConceptKind, type Lens } from "@/data";

/** The four kinds, in the order the model declares them, with the heading each one prints. */
const KINDS: { kind: ConceptKind; head: string; note: string }[] = [
  { kind: "invariant", head: "Invariants", note: "README §2 — what makes the features trustworthy" },
  { kind: "tier", head: "The ladder", note: "README §1 — the rungs a new user climbs" },
  { kind: "act", head: "The demo", note: "README §1 — the four acts" },
  { kind: "decision", head: "Standing decisions", note: "README §3.4, §3.5, §4" },
];

/** How many components carry a concept. Computed from the one lens derivation, never counted twice. */
const carriers = (id: string): number => lensFor(id).components.size;

export function Claims({
  lens,
  setLens,
}: {
  lens: Lens;
  setLens: (id: string | null) => void;
}) {
  return (
    <aside className="at-claims" aria-label="Claims">
      <header className="at-claims-head">
        <h2>Claims</h2>
        <p className="at-label">
          Choose one to light what carries it. {COUNTS.concepts} claims over {COUNTS.components}{" "}
          modules.
        </p>
      </header>

      {KINDS.map(({ kind, head, note }) => {
        const rows = CONCEPTS.filter((c) => c.kind === kind);
        if (rows.length === 0) return null;
        return (
          <section key={kind} className="at-claims-group">
            <h3 className="at-claims-group-head">
              {head}
              <span className="at-claims-group-note">{note}</span>
            </h3>
            <ul>
              {rows.map((c) => {
                const n = carriers(c.id);
                const on = lens.concept?.id === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="at-claim"
                      data-on={on ? "" : undefined}
                      aria-pressed={on}
                      onClick={() => setLens(c.id)}
                      title={c.claim}
                    >
                      <span className="at-part">{c.part}</span>
                      <span className="at-claim-name">{c.name}</span>
                      <span className="at-fig at-claim-n">{n}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </aside>
  );
}
