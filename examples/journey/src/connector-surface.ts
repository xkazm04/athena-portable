/**
 * README section 4 — tier 3 at the same gate as tier 1 (section 3.4, "one gate, one approval
 * table").
 *
 * This is `Surface` for a connector: the same `decide` over the same flags, the same approval
 * table, the same ledger, and one thing a page does not have — an egress allow-list checked from
 * the arguments after the approval is proved. A connector cannot argue itself out of GATED any
 * more than a page can, so nothing here reads a preference.
 */
import { decide, manifestOf, type Decision, type GateTool, type HostManifest } from "@athena/bridge/gate";
import { ApprovalError, type Approvals, type Card } from "./approvals.ts";
import { EgressRefused, type ConnectorPort } from "./connectors/port.ts";
import type { Ledger, LedgerRow } from "./ledger.ts";
import { parse, rowOf, withRow } from "./surface.ts";

export interface ConnectorResult {
  readonly output: string;
  readonly row: LedgerRow;
  readonly approval: Card | null;
  readonly target: string | null;
}

export interface ConnectorRefused {
  readonly reason: string;
  readonly message: string;
  readonly row: LedgerRow;
}

export class ConnectorSurface {
  private readonly decisions: Map<string, Decision>;

  constructor(
    readonly port: ConnectorPort,
    private readonly approvals: Approvals,
    private readonly ledger: Ledger,
  ) {
    this.decisions = new Map(port.listTools().map((tool) => [tool.name, decide(tool, null)]));
  }

  get origin(): string {
    return `connector:${this.port.id}`;
  }

  manifest(): HostManifest {
    return manifestOf(
      { origin: this.origin, app_id: this.port.id, app_version: "0", transport: "connector" },
      this.port.listTools(),
    );
  }

  names(): string[] {
    return [...this.decisions.keys()].sort();
  }

  classOf(name: string): "AUTO" | "GATED" {
    const found = this.decisions.get(name);
    if (!found) throw new Error(`${this.origin} has no tool named ${name}`);
    return found.cls;
  }

  tools(): GateTool[] {
    return this.port.listTools();
  }

  propose(name: string, params: Record<string, unknown> = {}): Card {
    if (this.classOf(name) !== "GATED") throw new Error(`${name} is AUTO; a card would be theatre`);
    return this.approvals.request(this.origin, name, params);
  }

  async run(name: string, params: Record<string, unknown> = {}, approval: Card | null = null): Promise<ConnectorResult> {
    const cls = this.classOf(name);
    const target = this.port.targetOf(name, params);
    // Every refusal writes its row before it throws (invariant 6, failures included): the gate's,
    // the allow-list's and the service's own. `refused` reads the row back rather than writing one.
    const refuse = (error: Error, reason: string): Error =>
      withRow(error, this.ledger.write({
        app: this.origin,
        tier: 3,
        tool: name,
        cls,
        outcome: "refused",
        reason,
        approval: cls === "GATED" ? (approval?.id ?? null) : null,
        target,
      }));
    let card: Card | null = null;
    if (cls === "GATED") {
      try {
        card = this.approvals.prove(approval?.id ?? null, this.origin, name, params);
      } catch (error) {
        throw error instanceof ApprovalError ? refuse(error, error.reason) : error;
      }
    }
    // Second, and only after the approval: the switch layers on the gate, it does not replace it.
    if (target !== null && !this.port.allowed.has(target)) {
      const egress = new EgressRefused(this.port.id, target);
      throw refuse(egress, egress.reason);
    }

    let output: string;
    try {
      output = String(await this.port.call(name, params));
    } catch (error) {
      throw refuse(error instanceof Error ? error : new Error(String(error)), "unknown");
    }
    const row = this.ledger.write({
      app: this.origin,
      tier: 3,
      tool: name,
      cls,
      outcome: "ok",
      reason: null,
      approval: card?.id ?? null,
      target,
    });
    return { output, row, approval: card, target };
  }

  async read<T = unknown>(name: string, params: Record<string, unknown> = {}): Promise<T> {
    return parse<T>((await this.run(name, params)).output);
  }

  async approveAndRun(name: string, params: Record<string, unknown> = {}): Promise<ConnectorResult> {
    const card = this.propose(name, params);
    this.approvals.approve(card.id);
    return this.run(name, params, card);
  }

  async declineAndRun(name: string, params: Record<string, unknown> = {}): Promise<ConnectorRefused> {
    const card = this.propose(name, params);
    this.approvals.decline(card.id);
    return this.refused(name, params, card);
  }

  /** An approved call to a target nobody allow-listed. Must refuse, and must leave no effect. */
  async runUnallowed(name: string, params: Record<string, unknown> = {}): Promise<ConnectorRefused> {
    const card = this.propose(name, params);
    this.approvals.approve(card.id);
    return this.refused(name, params, card);
  }

  private async refused(name: string, params: Record<string, unknown>, card: Card | null): Promise<ConnectorRefused> {
    try {
      await this.run(name, params, card);
    } catch (error) {
      const reason = error instanceof ApprovalError ? error.reason : error instanceof EgressRefused ? error.reason : null;
      // `run` wrote the row when it refused; this only hands it back.
      if (reason) return { reason, message: (error as Error).message, row: rowOf(error as Error) };
      throw error;
    }
    throw new Error(`${name} ran when it should have been refused; the gate did not hold`);
  }
}
