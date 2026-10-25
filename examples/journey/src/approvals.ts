/**
 * README section 3.2 step 6 and section 3.3 — the surface's approval step, as a fake.
 *
 * The real path is a row in `core/approvals.py`, a `decision.requested` event, a card in the
 * panel and a `POST /decisions/<id>` that replays the gate with the approval id. The runner has
 * no daemon, so it models the same three moments and no fewer: a card is *requested* before
 * anything runs, a person *answers* it, and the gate *proves* the answer covers this action with
 * these parameters before the call leaves the surface.
 *
 * A granted card is spent the moment the gate lets its call through (ADR 0038): `consumedAt` is
 * set once and a second citation is refused `approval_spent`. A citation whose parameters differ
 * from the card's is refused `validator_failed` and spends nothing, so a caller that guesses wrong
 * cannot use up the person's real approval - the daemon's order, `harness/hooks.py` `_check_grant`.
 *
 * `describe` is the load-bearing half. An approval that is only an id is a token a later call can
 * borrow; binding it to the tool and a canonical rendering of its parameters is what makes
 * "granted for this action" checkable, which is what the daemon does on the real path.
 */
import { randomUUID } from "node:crypto";

export type CardStatus = "pending" | "granted" | "denied";

export interface Card {
  readonly id: string;
  readonly origin: string;
  readonly tool: string;
  readonly describe: string;
  status: CardStatus;
  /** When the gate let this card's call through; `null` until then, and set once. */
  consumedAt: string | null;
}

/** Stable rendering of one proposed action: the same arguments always describe the same way. */
export function describe(origin: string, tool: string, params: Record<string, unknown>): string {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${key}=${JSON.stringify(params[key])}`)
    .join(",");
  return `${origin}/${tool}(${canonical})`;
}

export class ApprovalError extends Error {
  constructor(
    message: string,
    readonly reason: "user_denied" | "pending_approval" | "unknown_ref" | "validator_failed" | "approval_spent",
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

export class Approvals {
  private readonly cards = new Map<string, Card>();

  /** A card, pending. Nothing has run; a GATED call may not proceed until this is answered. */
  request(origin: string, tool: string, params: Record<string, unknown>): Card {
    const card: Card = { id: `apr_${randomUUID().slice(0, 12)}`, origin, tool, describe: describe(origin, tool, params), status: "pending", consumedAt: null };
    this.cards.set(card.id, card);
    return card;
  }

  approve(id: string): Card {
    return this.answer(id, "granted");
  }

  decline(id: string): Card {
    return this.answer(id, "denied");
  }

  private answer(id: string, status: CardStatus): Card {
    const card = this.cards.get(id);
    if (!card) throw new ApprovalError(`no approval ${id}`, "unknown_ref");
    card.status = status;
    return card;
  }

  get(id: string): Card | undefined {
    return this.cards.get(id);
  }

  all(): Card[] {
    return [...this.cards.values()];
  }

  /** The table as plain data, for a checkpoint (`src/checkpoint.ts`); spent cards stay spent. */
  snapshot(): Card[] {
    return this.all().map((card) => ({ ...card }));
  }

  /**
   * Put a checkpoint's cards back. Each must be a card this table could have produced: a known
   * status, a `describe` that names its own origin and tool, a `consumedAt` only on a granted card,
   * and an id not already here. A restored grant that was spent is still spent.
   */
  restore(cards: readonly Card[]): void {
    if (this.cards.size > 0) throw new Error(`approvals: restore into a table that already holds ${this.cards.size} cards`);
    for (const card of cards) {
      if (!["pending", "granted", "denied"].includes(card.status)) {
        throw new Error(`approvals: checkpoint card ${card.id} has status ${String(card.status)}`);
      }
      if (!card.describe.startsWith(`${card.origin}/${card.tool}(`)) {
        throw new Error(`approvals: checkpoint card ${card.id} describes ${card.describe}, not ${card.origin}/${card.tool}`);
      }
      if (card.consumedAt !== null && card.status !== "granted") {
        throw new Error(`approvals: checkpoint card ${card.id} was spent without being granted`);
      }
      if (this.cards.has(card.id)) throw new Error(`approvals: checkpoint card ${card.id} appears twice`);
      this.cards.set(card.id, { ...card });
    }
  }

  /**
   * Prove the approval was granted for *this* action and *these* parameters, and spend it. Throws
   * otherwise - a GATED tool never executes without a resolved, matching, unspent decision
   * (invariant 3). The checks run in the daemon's order: exists, answered, matches (a mismatch is
   * `validator_failed` and spends nothing), unspent (`approval_spent`), then the one spend.
   */
  prove(id: string | null, origin: string, tool: string, params: Record<string, unknown>): Card {
    if (!id) throw new ApprovalError(`${tool} is GATED and no approval was cited`, "pending_approval");
    const card = this.cards.get(id);
    if (!card) throw new ApprovalError(`no approval ${id}`, "unknown_ref");
    if (card.status === "pending") throw new ApprovalError(`${card.id} is still pending`, "pending_approval");
    if (card.status === "denied") throw new ApprovalError(`${card.id} was declined`, "user_denied");
    const wanted = describe(origin, tool, params);
    if (card.describe !== wanted) {
      throw new ApprovalError(`${card.id} was granted for ${card.describe}, not ${wanted}`, "validator_failed");
    }
    if (card.consumedAt !== null) {
      throw new ApprovalError(`${card.id} has already been spent on ${tool}`, "approval_spent");
    }
    card.consumedAt = new Date().toISOString();
    return card;
  }
}
