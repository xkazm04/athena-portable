/**
 * README section 4 — the connector seam, as the runner needs it.
 *
 * The real seam is `src/athena/connectors/port.py` and the real connectors (Gmail, Notion) are
 * built elsewhere; this repository reserves the seam and ships none of them. So the journey keeps
 * the *shape* and fakes the service: a connector presents a manifest of the same shape as a page,
 * its class is decided by the same `classify`, its reads are reads and its writes are GATED and
 * behind an egress allow-list gated from the arguments. Section 4 says the allow-list "layers on
 * the approval gate, never replaces it", which is why `ConnectorSurface` checks both and in that
 * order: a granted approval for a recipient nobody allow-listed still does not send.
 *
 * Nothing here holds a credential, because section 4 says no tool ever returns, lists, mints or
 * rotates one and a fake that did would be modelling the wrong thing.
 */
import type { GateTool } from "@athena/bridge/gate";

/** The `ConnectorPort` of section 4: list what this service offers, and run one of them. */
export interface ConnectorPort {
  /** `connector:<id>` in the catalog and in the ledger. */
  readonly id: string;
  listTools(): GateTool[];
  call(name: string, params: Record<string, unknown>): string | Promise<string>;
  /**
   * The outbound target this call names — a recipient, a page id — or `null` for a read.
   * Derived from the arguments, so the allow-list is checked against what will actually happen.
   */
  targetOf(name: string, params: Record<string, unknown>): string | null;
  /** Which targets this connection may ever reach. Off by default means empty by default. */
  readonly allowed: Set<string>;
}

/** A read: reversible, no side effects. `classify` makes this AUTO and nothing else has a say. */
export function readTool(name: string, description: string, properties: Record<string, unknown> = {}): GateTool {
  return {
    name,
    description,
    inputSchema: { type: "object", properties },
    athena: { reversible: true, side_effects: "none" },
    annotations: { readOnlyHint: true, consequentialHint: false },
  };
}

/** A write that leaves the application. `classify` makes this GATED whatever the service prefers. */
export function writeTool(name: string, description: string, properties: Record<string, unknown> = {}): GateTool {
  return {
    name,
    description,
    inputSchema: { type: "object", properties },
    athena: { reversible: false, side_effects: "external" },
    annotations: { readOnlyHint: false, consequentialHint: true },
  };
}

export class EgressRefused extends Error {
  readonly reason = "foreign_origin";

  constructor(
    readonly connector: string,
    readonly target: string,
  ) {
    super(`connector:${connector} may not reach ${target}: it is not on the egress allow-list`);
    this.name = "EgressRefused";
  }
}
