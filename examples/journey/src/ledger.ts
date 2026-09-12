/**
 * README section 2 invariant 6 ("cost is visible: one ledger row per invocation, failures
 * included, with a reason from a closed set") and act 4, "the record".
 *
 * One row per call the surface made, whichever tier it went to, refusals included. The reason
 * column is `REFUSAL_REASONS` from the real gate and nothing else, so a row a reader cannot
 * classify cannot be written. No row ever carries a credential or a message body.
 */
import { REFUSAL_REASONS } from "@athena/bridge/gate";

/**
 * The three tiers of README section 3.4: 1 is a page's own WebMCP tool, 2 a generic hand the shell
 * runs on a page that registered nothing, 3 a third-party connector.
 *
 * 2 arrives with the outside page the journey now boots. Until then the record could only show a
 * demo made of pages that had agreed to cooperate, which is the smaller half of the claim.
 */
export type Tier = 1 | 2 | 3;
export type Outcome = "ok" | "refused" | "skipped";

export interface LedgerRow {
  readonly seq: number;
  /** `ledgerbox`, `hirelane`, `tidycrm`, `connector:mail`, `connector:notes`. */
  readonly app: string;
  readonly tier: Tier;
  readonly tool: string;
  readonly cls: "AUTO" | "GATED";
  readonly outcome: Outcome;
  /** A member of the closed vocabulary, or `null` when nothing was refused. */
  readonly reason: string | null;
  /** Present on every GATED execution; `null` on an AUTO one. */
  readonly approval: string | null;
  /** For a connector write: the allow-listed recipient or page this call named. */
  readonly target: string | null;
}

export class Ledger {
  readonly rows: LedgerRow[] = [];

  write(row: Omit<LedgerRow, "seq">): LedgerRow {
    if (row.reason !== null && !REFUSAL_REASONS.includes(row.reason)) {
      throw new Error(`ledger: ${row.reason} is not in REFUSAL_REASONS`);
    }
    const written = { ...row, seq: this.rows.length + 1 };
    this.rows.push(written);
    return written;
  }

  byApp(app: string): LedgerRow[] {
    return this.rows.filter((r) => r.app === app);
  }

  withReason(reason: string): LedgerRow[] {
    return this.rows.filter((r) => r.reason === reason);
  }

  gatedExecutions(): LedgerRow[] {
    return this.rows.filter((r) => r.cls === "GATED" && r.outcome === "ok");
  }

  connectorWrites(): LedgerRow[] {
    return this.rows.filter((r) => r.tier === 3 && r.cls === "GATED");
  }

  /** The act 4 table. Plain text, fixed columns, so a terminal and a CI log read the same. */
  table(): string {
    const head = ["#", "app", "tier", "tool", "class", "outcome", "reason", "approval", "target"];
    const body = this.rows.map((r) => [
      String(r.seq),
      r.app,
      // The tier is what the record is *for*: it says where a call happened, and "on a page the
      // user is looking at" and "on a page that never offered us anything" are different answers.
      r.tier === 1 ? "1 page" : r.tier === 2 ? "2 hand" : "3 conn",
      r.tool,
      r.cls,
      r.outcome,
      r.reason ?? "-",
      r.approval ?? "-",
      r.target ?? "-",
    ]);
    return render([head, ...body]);
  }
}

export function render(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  const rule = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(rows[0]!), rule, ...rows.slice(1).map(line)].join("\n");
}
