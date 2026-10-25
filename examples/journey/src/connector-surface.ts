/**
 * README section 4 — tier 3 at the same gate as tier 1 (section 3.4, "one gate, one approval
 * table").
 *
 * This is `Surface` for a connector: the same `decide` over the same flags, the same approval
 * table, the same ledger, and one thing a page does not have — an egress allow-list checked from
 * the arguments after the approval is proved. Both surfaces run one pipeline (`gate-pipeline.ts`);
 * this class supplies the transport, the allow-list and the read cap. A connector cannot argue itself out of GATED any
 * more than a page can, so nothing here reads a preference.
 */
import { decide, freshNonce, manifestOf, type Decision, type GateTool, type HostManifest } from "@athena/bridge/gate";
import type { Approvals, Card } from "./approvals.ts";
import { EgressRefused, type ConnectorPort } from "./connectors/port.ts";
import { GateRefusal, READ_CAP, runGate, type GateResult } from "./gate-pipeline.ts";
import type { Ledger, LedgerRow } from "./ledger.ts";
import { parse } from "./surface.ts";

export interface ConnectorResult extends GateResult {
  readonly target: string | null;
}

export interface ConnectorRefused {
  readonly reason: string;
  readonly message: string;
  readonly row: LedgerRow;
}

export class ConnectorSurface {
  private readonly decisions: Map<string, Decision>;
  /** One nonce for the whole session, as on a page surface: every read is fenced with it. */
  readonly nonce = freshNonce();

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
    const target = this.port.targetOf(name, params);
    // The same pipeline as a page: validate against the published schema, prove and spend the
    // card, then the allow-list (after the approval, as the service checks it), then the call, a
    // read capped at READ_CAP inside the fence, and one row for every outcome.
    const result = await runGate(
      { approvals: this.approvals, ledger: this.ledger, nonce: this.nonce },
      {
        app: this.origin,
        origin: this.origin,
        tier: 3,
        name,
        cls: this.classOf(name),
        schema: this.port.listTools().find((tool) => tool.name === name)?.inputSchema,
        params,
        approval,
        target,
        egress: (to) => (this.port.allowed.has(to) ? null : new EgressRefused(this.port.id, to).message),
        transport: async () => ({ ok: true, output: String(await this.port.call(name, params)) }),
        label: this.port.id,
        readCap: READ_CAP,
      },
    );
    return { ...result, target };
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
      // `run` wrote the row when it refused; this only hands it back. A service that failed is not
      // the gate holding, so it is not reported as one.
      if (error instanceof GateRefusal && error.stage !== "transport") {
        return { reason: error.reason, message: error.message, row: error.row };
      }
      throw error;
    }
    throw new Error(`${name} ran when it should have been refused; the gate did not hold`);
  }
}
