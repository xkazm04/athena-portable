/**
 * README section 3.4 ("one gate, one approval table") — the one pipeline every tier runs through.
 *
 * A page's own tool (tier 1), a shell hand (tier 2) and a connector (tier 3) differ in exactly two
 * places: how the call leaves (the transport) and whether an egress allow-list stands between the
 * approval and the call. Everything else is the same rule in the same order, so it is written once
 * here and both `Surface` and `ConnectorSurface` delegate to it:
 *
 *   validate -> prove + spend -> egress -> admit -> transport -> cap + fence -> row
 *
 * which is the daemon's order: the harness validates arguments before the gate looks at the card,
 * the gate spends the card as it lets the call through (`harness/hooks.py` `_check_grant`, ADR
 * 0038), and only then does a connector's service check egress (`connectors/service.py`), so an
 * approved send to a recipient nobody allow-listed is refused `foreign_origin` with the card
 * already spent. Every outcome, refusals included, is exactly one ledger row (invariant 6), and
 * every refusal is a `GateRefusal` that carries the row it wrote.
 *
 * The transport is injected, so this file never sees a Playwright `Page` and the whole gate is
 * testable offline (`tests/gate-pipeline.spec.ts`).
 */
import { fence } from "@athena/bridge/gate";
import { argumentErrors } from "../../demo-kit/src/webmcp/door.ts";
import { ApprovalError, type Approvals, type Card } from "./approvals.ts";
import type { Ledger, LedgerRow, Tier } from "./ledger.ts";

/**
 * The cap every connector read is held to before it is fenced: `connectors/service.py` READ_CAP,
 * itself `core.catalog.READ_CAP`.
 */
export const READ_CAP = 1600;

/** `cut_text` (src/athena/contracts/channel.py): cut to `limit` with the cut announced, or whole. */
export function cutText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n(showing ${limit} of ${text.length})`;
}

/** Where in the pipeline a call was refused; a caller decides which of these it reports as a refusal. */
export type GateStage = "validate" | "approval" | "egress" | "admit" | "transport";

/** A refusal, with the reason from the closed vocabulary and the ledger row it wrote first. */
export class GateRefusal extends Error {
  constructor(
    message: string,
    readonly reason: string,
    readonly stage: GateStage,
    readonly row: LedgerRow,
  ) {
    super(message);
    this.name = "GateRefusal";
  }
}

/** What a transport hands back: the tool's text, or why it would not answer. */
export type TransportAnswer =
  | { readonly ok: true; readonly output: string }
  | { readonly ok: false; readonly error: string; readonly reason?: string | null };

/** The state every call on one surface shares: the approval table, the record and the fence nonce. */
export interface GatePlane {
  readonly approvals: Approvals;
  readonly ledger: Ledger;
  readonly nonce: string;
}

/** One call, as the surface that owns the transport describes it. */
export interface GateStep {
  /** The ledger's `app` column. */
  readonly app: string;
  /** The origin an approval card is bound to. */
  readonly origin: string;
  readonly tier: Tier;
  readonly name: string;
  readonly cls: "AUTO" | "GATED";
  /** The schema the tool published; the arguments are checked against this and nothing looser. */
  readonly schema: unknown;
  readonly params: Record<string, unknown>;
  readonly approval: Card | null;
  /** The outbound target this call names, recorded on every row it writes. */
  readonly target?: string | null;
  /** The allow-list, asked after the card is spent: a message when `target` may not be reached. */
  readonly egress?: (target: string) => string | null;
  /** A last admission check before the call leaves (a per-origin budget): a refusal, or `null`. */
  readonly admit?: () => { readonly reason: string; readonly message: string } | null;
  readonly transport: () => Promise<TransportAnswer>;
  /** The fence's label: a slug. `untrusted` unless the surface names its source. */
  readonly label?: string;
  /** Cut an AUTO call's output to this many characters inside the fence (connector reads). */
  readonly readCap?: number;
}

export interface GateResult {
  readonly output: string;
  /** What a prompt would actually carry: the output, capped where the tier caps it, then fenced. */
  readonly fenced: string;
  readonly row: LedgerRow;
  readonly approval: Card | null;
}

/**
 * The first mismatch between `params` and the published `schema`, or `null`.
 *
 * The demo kit's door verdict (`argumentErrors`, the same function every kit page runs at its own
 * door), with one allowance: an argument the schema does not name is refused only when the schema
 * is closed (`additionalProperties: false`). That is production's `check_schema` rule, and it is
 * what keeps a shell hand, whose schema is open, from being refused here for a key the daemon
 * would pass. The connector fakes and every kit page publish closed schemas, so for them this is
 * the kit's verdict exactly.
 */
export function argumentProblem(params: Record<string, unknown>, schema: unknown): string | null {
  const closed = typeof schema === "object" && schema !== null && (schema as { additionalProperties?: unknown }).additionalProperties === false;
  const problems = argumentErrors(params, schema ?? { type: "object" }).filter(
    (problem) => closed || problem.code !== "unknown",
  );
  return problems[0]?.message ?? null;
}

export async function runGate(plane: GatePlane, step: GateStep): Promise<GateResult> {
  const target = step.target ?? null;
  const refuse = (message: string, reason: string, stage: GateStage): GateRefusal =>
    new GateRefusal(
      message,
      reason,
      stage,
      plane.ledger.write({
        app: step.app,
        tier: step.tier,
        tool: step.name,
        cls: step.cls,
        outcome: "refused",
        reason,
        // The card the caller cited, which is the card a granted call would have recorded.
        approval: step.cls === "GATED" ? (step.approval?.id ?? null) : null,
        target,
      }),
    );

  const problem = argumentProblem(step.params, step.schema);
  if (problem !== null) throw refuse(`${step.name}: ${problem}`, "validator_failed", "validate");

  let card: Card | null = null;
  if (step.cls === "GATED") {
    try {
      card = plane.approvals.prove(step.approval?.id ?? null, step.origin, step.name, step.params);
    } catch (error) {
      if (error instanceof ApprovalError) throw refuse(error.message, error.reason, "approval");
      throw error;
    }
  }

  // Only after the card: the allow-list layers on the approval, it never replaces it.
  if (target !== null && step.egress) {
    const refused = step.egress(target);
    if (refused !== null) throw refuse(refused, "foreign_origin", "egress");
  }

  const admitted = step.admit?.() ?? null;
  if (admitted !== null) throw refuse(admitted.message, admitted.reason, "admit");

  let answer: TransportAnswer;
  try {
    answer = await step.transport();
  } catch (error) {
    throw refuse(error instanceof Error ? error.message : String(error), "unknown", "transport");
  }
  if (answer.ok !== true) throw refuse(`${step.name}: ${answer.error}`, answer.reason ?? "unknown", "transport");

  const row = plane.ledger.write({
    app: step.app,
    tier: step.tier,
    tool: step.name,
    cls: step.cls,
    outcome: "ok",
    reason: null,
    approval: card?.id ?? null,
    target,
  });
  const shown = step.cls === "AUTO" && step.readCap !== undefined ? cutText(answer.output, step.readCap) : answer.output;
  return { output: answer.output, fenced: fence(shown, step.label ?? "untrusted", plane.nonce), row, approval: card };
}
