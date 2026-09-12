/**
 * README section 3.2 step 6 and section 3.3 — the surface's approval step, as a fake.
 *
 * The real path is a row in `core/approvals.py`, a `decision.requested` event, a card in the
 * panel and a `POST /decisions/<id>` that replays the gate with the approval id. The runner has
 * no daemon, so it models the same three moments and no fewer: a card is *requested* before
 * anything runs, a person *answers* it, and the gate *proves* the answer covers this action with
 * these parameters before the call leaves the surface.
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
    readonly reason: "user_denied" | "pending_approval" | "unknown_ref",
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

export class Approvals {
  private readonly cards = new Map<string, Card>();

  /** A card, pending. Nothing has run; a GATED call may not proceed until this is answered. */
  request(origin: string, tool: string, params: Record<string, unknown>): Card {
    const card: Card = { id: `apr_${randomUUID().slice(0, 12)}`, origin, tool, describe: describe(origin, tool, params), status: "pending" };
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

  /**
   * Prove the approval was granted for *this* action and *these* parameters. Throws otherwise —
   * a GATED tool never executes without a resolved, matching decision (invariant 3).
   */
  prove(id: string | null, origin: string, tool: string, params: Record<string, unknown>): Card {
    if (!id) throw new ApprovalError(`${tool} is GATED and no approval was cited`, "pending_approval");
    const card = this.cards.get(id);
    if (!card) throw new ApprovalError(`no approval ${id}`, "unknown_ref");
    if (card.status === "pending") throw new ApprovalError(`${card.id} is still pending`, "pending_approval");
    if (card.status === "denied") throw new ApprovalError(`${card.id} was declined`, "user_denied");
    const wanted = describe(origin, tool, params);
    if (card.describe !== wanted) {
      throw new ApprovalError(`${card.id} was granted for ${card.describe}, not ${wanted}`, "unknown_ref");
    }
    return card;
  }
}
