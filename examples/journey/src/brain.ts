/**
 * README section 2 invariant 2 — "a fact that does not cite live episodes is rejected at write".
 *
 * The runner's brain is three fields and a rule: a fact carries the ledger rows it was learned
 * from, and a write with no citation is refused here rather than filtered later. That is the
 * whole point of the invariant — the citation is a precondition of the write, not a column
 * somebody may leave empty — and it is what makes act 4's record checkable: every fact the
 * journey carries from one app to the next names the call in another app that taught it.
 *
 * This is a fake of `core/brain/`, not a port of it: markdown on disk and the rebuildable index
 * are the daemon's business. What is faithful is the refusal.
 */
import { render, type LedgerRow } from "./ledger.ts";

export interface Fact {
  readonly id: string;
  /** One sentence, as a person would read it in the origins module. */
  readonly claim: string;
  /** Ledger sequence numbers: the runner's episodes. Never empty. */
  readonly cites: readonly number[];
  /** The app the fact was learned in. */
  readonly learnedIn: string;
}

export class Brain {
  readonly facts: Fact[] = [];

  /** Write a fact, citing live ledger rows. No citation, no write — not even for a test. */
  writeFact(claim: string, cites: readonly LedgerRow[], learnedIn: string): Fact {
    return this.admit(claim, cites.map((c) => c.seq), learnedIn);
  }

  /** The one door every fact comes through, live or restored: no citation, no fact. */
  private admit(claim: string, cites: readonly number[], learnedIn: string): Fact {
    if (cites.length === 0) throw new Error(`write_fact refused: "${claim}" cites no episode`);
    const fact: Fact = { id: `fct_${this.facts.length + 1}`, claim, cites: [...cites], learnedIn };
    this.facts.push(fact);
    return fact;
  }

  /** The facts as plain data, for a checkpoint (`src/checkpoint.ts`). */
  snapshot(): Fact[] {
    return this.facts.map((f) => ({ ...f, cites: [...f.cites] }));
  }

  /**
   * Put a checkpoint's facts back through the same door as `writeFact`, so a hand-edited checkpoint
   * cannot carry a fact that cites nothing, and the ids are re-derived rather than trusted.
   */
  restore(facts: readonly Fact[]): void {
    if (this.facts.length > 0) throw new Error(`brain: restore into a brain that already holds ${this.facts.length} facts`);
    for (const fact of facts) {
      const admitted = this.admit(fact.claim, fact.cites, fact.learnedIn);
      if (admitted.id !== fact.id) throw new Error(`brain: checkpoint fact ${fact.id} restores as ${admitted.id}`);
    }
  }

  /** The act 4 view: every fact with the rows it cites. */
  table(): string {
    const head = ["fact", "learned in", "cites", "claim"];
    const body = this.facts.map((f) => [f.id, f.learnedIn, f.cites.join(","), f.claim]);
    return render([head, ...body]);
  }

  /** The one fact whose claim contains `needle`, for an act that has to recall across apps. */
  recall(needle: string): Fact {
    const hit = this.facts.find((f) => f.claim.toLowerCase().includes(needle.toLowerCase()));
    if (!hit) throw new Error(`recall: no fact mentioning ${needle}`);
    return hit;
  }
}
