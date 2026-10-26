/**
 * The featured band on the catalogue — ADR 0300, spike 00 of the featured-chores program.
 *
 * A featured chore reads its world through a Meta sense (a letter filmed, a call, a walk-through)
 * and earns its standing on its proofs (`senses/proofs.json`), never by being authored: the band
 * draws every playbook that carries a `featured` block, each with its senses, the status its
 * proofs earn in words and a dot, and how many of them passed. Proven on Meta leads; a chore
 * rehearsed on fixtures says so and wears the info dot, never the success one, because it has not
 * yet run on the models it is featured for. A press opens the chore as a ledger row does. With no
 * featured chore the band is not drawn at all: there is nothing to say about an absence here.
 */
import Badge from "@/components/Badge";
import type { Tone } from "@/components/StatusDot";
import type { FeaturedStatus, Sense } from "@/lib/playbooks";
import type { PlaybookView, PlaybooksModel } from "@/modules/playbooks/model";

/** The status in the house's words and its dot. Only `proven` is good news. */
export const STATUS_WORDS: Record<FeaturedStatus, { label: string; tone: Tone; why: string }> = {
  proven: {
    label: "Proven on Meta",
    tone: "success",
    why: "Every proof passed on a build where a sense ran on Meta's models.",
  },
  rehearsed: {
    label: "Rehearsed on fixtures",
    tone: "info",
    why: "Every proof passed, on recorded fixtures or Claude: not yet on Meta's models.",
  },
  failing: { label: "Proof failing", tone: "error", why: "At least one proof missed its bar on the last build." },
  unproven: { label: "Unproven", tone: "neutral", why: "No proof has been measured yet." },
};

/** Each sense's name on the band and what it reads, for its title. */
export const SENSE_WORDS: Record<Sense, { label: string; why: string }> = {
  paper: { label: "Paper", why: "Reads letters, bills and forms from a filmed flip-through" },
  call: { label: "Call", why: "Turns a recorded phone call into cited turns" },
  object: { label: "Objects", why: "Finds and counts things in the household's photos" },
  walk: { label: "Walk", why: "Counts what is installed from a filmed walk-through" },
  circle: { label: "Circle", why: "Knows who in the family decides what" },
};

const ORDER: readonly FeaturedStatus[] = ["proven", "rehearsed", "failing", "unproven"];

/** The featured chores, proven first, then rehearsed, failing and unproven; within a status the
 *  model's own order (the edge). Pure. */
export function featuredRows(model: PlaybooksModel): PlaybookView[] {
  const rank = (v: PlaybookView) => ORDER.indexOf(v.playbook.featured!.status);
  return model.items.filter((v) => v.playbook.featured !== null).sort((a, b) => rank(a) - rank(b));
}

/** "3 of 4 proofs passed", or "No proofs yet". */
export function proofsLine(p: { passed: number; total: number }): string {
  if (p.total === 0) return "No proofs yet";
  return `${p.passed} of ${p.total} ${p.total === 1 ? "proof" : "proofs"} passed`;
}

export default function FeaturedBand({
  model,
  open,
}: {
  model: PlaybooksModel;
  /** What a press does: the same as picking the chore's ledger row. */
  open: (view: PlaybookView) => void;
}) {
  const rows = featuredRows(model);
  if (rows.length === 0) return null;
  return (
    <section className="pa-featured" aria-labelledby="pa-featured-h">
      <h2 id="pa-featured-h" className="pa-kpi__label">
        Featured chores
      </h2>
      <ul className="pa-cases">
        {rows.map((v) => {
          const f = v.playbook.featured!;
          const s = STATUS_WORDS[f.status];
          return (
            <li key={v.id} className={`pa-case pa-featured__row pa-featured__row--${f.status}`}>
              <button
                type="button"
                className="pa-link pa-featured__chore focus-ring"
                title={`Open the page of ${v.playbook.shortTitle}`}
                onClick={() => open(v)}
              >
                {v.playbook.shortTitle}
              </button>
              <span className="pa-featured__senses" aria-label="Senses">
                {f.senses.map((sense) => (
                  <Badge key={sense} title={SENSE_WORDS[sense].why}>
                    {SENSE_WORDS[sense].label}
                  </Badge>
                ))}
              </span>
              <Badge tone={s.tone} title={s.why}>
                {s.label}
              </Badge>
              <span className="pa-case__when">{proofsLine(f.proofs)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
