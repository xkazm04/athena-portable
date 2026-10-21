/**
 * Types for `@athena/bridge/gate`, which is JSDoc-annotated JavaScript.
 *
 * The bridge package publishes `bridge.d.ts` for its page half but no declaration for the gate,
 * and TypeScript does not read JSDoc out of a package under `node_modules`. Declaring the module
 * once here types every desktop import of it; the shapes are transcribed from
 * `packages/athena-bridge/gate.js` and nothing else.
 */
declare module "@athena/bridge/gate" {
  export type SideEffects = "none" | "internal" | "external";
  export type ToolClass = "AUTO" | "GATED";
  export interface Flags {
    reversible: boolean;
    side_effects: SideEffects;
    basis: string;
  }
  /** What a page said about a tool; `flagsOf` reads only the flag signals, so the name is optional there. */
  export interface FlagSource {
    name?: string;
    /** `unknown` on purpose: the page wrote both, and `flagsOf` checks each field before trusting it. */
    athena?: unknown;
    annotations?: unknown;
  }
  export interface GateTool extends FlagSource {
    name: string;
    description?: string | null;
    inputSchema?: unknown;
  }
  export interface PageIdentity {
    origin?: string;
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
  export const REFUSAL_REASONS: readonly string[];
  export function flagsOf(tool: FlagSource | null | undefined): Flags;
  export function classify(flags: { reversible?: unknown; side_effects?: unknown }): ToolClass;
  export function manifestOf(page: PageIdentity, tools: GateTool[], generatedAt?: string): HostManifest;
}
