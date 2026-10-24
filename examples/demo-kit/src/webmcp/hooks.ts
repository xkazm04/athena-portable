"use client";

/**
 * `useWebMCPTool` — register one capability on `document.modelContext`, and nothing else.
 *
 * No provider, no zod, no runtime endpoint. A page that registers its capabilities here is
 * legible to any browser agent that speaks the standard, the Athena side panel included, without
 * hosting a chat of its own — tier 1 of the "Athena as the user's agent" ladder.
 *
 * Design 5.1's `reversible` / `side_effects` flags are carried two ways: as the standard WebMCP
 * annotations (`readOnlyHint`, `consequentialHint`) that a native browser preserves, and, for the
 * manifest, as the `athena` block a consumer may read when it is there. The block speaks the
 * contract's vocabulary (`athenaFor`): the kit's `data` goes out as `internal`, because a consumer
 * that does not recognise the value discards the whole block as unknown.
 *
 * The gate rule a consumer applies has FIVE branches, in this order — it is the rule the shipped
 * consumer runs (`packages/athena-bridge/gate.js`, `flagsOf`), and `classifyTool`
 * (./types.ts) agrees with it:
 *
 *   1. an `athena` block with both flags        => those flags, whatever the hints say;
 *   2. `consequentialHint: true`                => irreversible app data       => GATED;
 *   3. `readOnlyHint: true`                     => reversible, no side effects => AUTO;
 *   4. BOTH hints present and BOTH false        => a reversible app-data write => AUTO;
 *   5. annotations absent entirely              => unknown                     => GATED.
 *
 * Branch 4 is the commonest class in this repo — fifteen live declarations across the four host
 * apps — and it is the one a consumer gets wrong if it reads the rule as "anything that is not
 * `readOnlyHint` is gated". Unknown is gated, never the reverse; but *declared* reversible app
 * data is not unknown, and gating it would make the demo's whole point — that the environment
 * shapes capability — invisible.
 */
import { useEffect, useMemo, useRef } from "react";
import {
  parametersToJsonSchema,
  wireSideEffects,
  type HostParameter,
  type SideEffects,
  type WireSideEffects,
} from "./types";
import { runToolOutcome, settleOutcome, type DoorOptions, type ToolContext } from "./door";
import {
  ensureModelContext,
  type JsonSchemaObject,
  type ToolDescriptor,
  type WebMCPAnnotations,
} from "./modelContext";

export interface WebMCPToolSpec {
  name: string;
  description: string;
  parameters?: HostParameter[];
  /** Can the app put this back? */
  reversible: boolean;
  /** `none` = UI only, `data` = writes app data, `external` = reaches the outside world. */
  sideEffects: SideEffects;
  /**
   * Return value is what the calling agent reads. Objects are serialised. Announce truncation.
   * `context.signal` is the caller's abort: a long handler should stop when it fires.
   */
  handler: (args: Record<string, unknown>, context: ToolContext) => unknown | Promise<unknown>;
  /** Re-register when these change. */
  deps?: unknown[];
}

/**
 * The standard annotations for a design 5.1 tool. Exported for tests and the side panel.
 *
 * Emitting BOTH keys explicitly is load-bearing: a consumer distinguishes `false` from absent
 * (branch 4 versus branch 5 above), so a reversible app-data write that omitted
 * `consequentialHint: false` would read as unknown and be gated. Neither key may be dropped,
 * including when its value is `false`.
 */
export function annotationsFor(spec: Pick<WebMCPToolSpec, "reversible" | "sideEffects">): WebMCPAnnotations {
  return {
    readOnlyHint: spec.sideEffects === "none" && spec.reversible,
    consequentialHint: !spec.reversible || spec.sideEffects === "external",
  };
}

/**
 * The non-standard `athena` block (README section 3.3), in the contract's `side_effects` words.
 * Exported for tests. Branch 1 above reads it only when both flags are values it knows.
 */
export function athenaFor(spec: Pick<WebMCPToolSpec, "reversible" | "sideEffects">): {
  reversible: boolean;
  side_effects: WireSideEffects;
} {
  return { reversible: spec.reversible, side_effects: wireSideEffects(spec.sideEffects) };
}

/** The input schema `useWebMCPTool` publishes for a spec: closed, and enforced by the door. */
export function inputSchemaFor(spec: Pick<WebMCPToolSpec, "parameters">): JsonSchemaObject {
  return { ...parametersToJsonSchema(spec.parameters ?? []), type: "object" } as JsonSchemaObject;
}

/**
 * The descriptor `useWebMCPTool` registers, pure so it can be executed without React.
 *
 * `execute` resolves what the handler returned (a domain answer that says `{ ok: false }`
 * included) and REJECTS a refusal (`ToolRefusal`: `validator_failed` with every mismatch,
 * `timeout` at the door's ceiling, `cancelled` on the caller's abort) or a handler fault (an
 * `Error` with no reason), so the bridge replies `ok: false` for them (ADR 0146). The caller's
 * signal reaches the handler (ADR 0101).
 */
export function toolDescriptorFor(
  spec: Omit<WebMCPToolSpec, "handler" | "deps">,
  handler: { current: WebMCPToolSpec["handler"] },
  inputSchema: JsonSchemaObject = inputSchemaFor(spec),
  options?: DoorOptions,
): ToolDescriptor {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema,
    annotations: annotationsFor(spec),
    // Non-standard, ignored by a native implementation, read by the polyfill and the panel.
    ...({ athena: athenaFor(spec) } as object),
    execute: async (params, opts) =>
      settleOutcome(
        await runToolOutcome(inputSchema, params, (args, context) => handler.current(args, context), opts?.signal, options),
      ),
  };
}

export function useWebMCPTool(spec: WebMCPToolSpec): void {
  // The handler closes over live state (the 3D nav, the router). Read it through a ref so the
  // registration is stable and the latest closure still runs; re-register only when the schema
  // or the class changes.
  const handler = useRef(spec.handler);
  handler.current = spec.handler;
  const paramsKey = JSON.stringify(spec.parameters ?? []);
  const inputSchema = useMemo(
    () => inputSchemaFor(spec),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paramsKey],
  );

  useEffect(() => {
    const mc = ensureModelContext();
    if (!mc) return;
    const controller = new AbortController();
    void mc.registerTool(toolDescriptorFor(spec, handler, inputSchema), { signal: controller.signal });
    return () => {
      controller.abort();
      // Older drafts have no AbortSignal on registerTool; unregister explicitly where offered.
      mc.unregisterTool?.(spec.name);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.name, spec.description, inputSchema, spec.reversible, spec.sideEffects, ...(spec.deps ?? [])]);
}
