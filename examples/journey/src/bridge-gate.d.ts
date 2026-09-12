/**
 * README section 3.3 — types for `@athena/bridge/gate`, which is JSDoc-annotated JavaScript.
 *
 * The bridge package publishes `bridge.d.ts` for its page half but no declaration for the gate,
 * and TypeScript does not read JSDoc out of a package under `node_modules`. Declaring the module
 * here keeps the runner strict while still importing the one real gate every surface runs; the
 * shapes below are transcribed from `packages/athena-bridge/gate.js` and nothing else.
 */
declare module "@athena/bridge/gate" {
  export type SideEffects = "none" | "internal" | "external";
  export type ToolClass = "AUTO" | "GATED";
  export interface Flags {
    reversible: boolean;
    side_effects: SideEffects;
    basis: string;
  }
  export interface GateTool {
    name: string;
    title?: string;
    description?: string | null;
    inputSchema?: unknown;
    athena?: { reversible?: unknown; side_effects?: unknown } | null;
    annotations?: Record<string, unknown> | null;
  }
  export interface Decision {
    cls: ToolClass;
    declared: ToolClass;
    tightened: boolean;
    refused_loosening: boolean;
    flags: Flags;
  }
  export interface PageIdentity {
    origin?: string;
    href?: string;
    title?: string;
    app_id?: string | null;
    app_name?: string | null;
    app_version?: string | null;
    transport?: string;
    state_readables?: unknown[];
  }
  export interface ManifestTool {
    name: string;
    description: string;
    input_schema: unknown;
    reversible: boolean;
    side_effects: SideEffects;
    transport: string;
    inferred_from: string;
  }
  export interface HostManifest {
    app_id: string;
    app_version: string;
    page_origin: string;
    generated_at: string;
    origin_kind: string;
    transport_detected: string;
    state_readables: unknown[];
    tools: ManifestTool[];
  }
  export interface Refusal {
    ok: false;
    reason: string | null;
    message: string;
  }
  export interface BudgetTicket {
    ok: boolean;
    reason: string | null;
    message: string;
    origin: string;
    used: number;
    limit: number;
  }
  export const SIDE_EFFECTS: readonly SideEffects[];
  export const REFUSAL_REASONS: readonly string[];
  export const DEFAULT_CALL_BUDGET: number;
  export function flagsOf(tool: GateTool | null | undefined): Flags;
  export function classify(flags: { reversible?: unknown; side_effects?: unknown }): ToolClass;
  export function decide(tool: GateTool, overrides?: Record<string, string> | null): Decision;
  export function manifestOf(page: PageIdentity, tools: GateTool[], generatedAt?: string): HostManifest;
  export function normalizeReason(reason: string | null | undefined): string | null;
  export function refusal(reason: string, message: string): Refusal;
  export function fence(text: string, label?: string, nonce?: string | null): string;
  export function bounded(items: readonly string[], limit: number, separator?: string): string;
  export function freshNonce(): string;
  export class Budget {
    constructor(limit?: number);
    limit: number;
    used(origin: string): number;
    remaining(origin: string): number;
    take(origin: string): BudgetTicket;
    reset(origin?: string): void;
  }
}
