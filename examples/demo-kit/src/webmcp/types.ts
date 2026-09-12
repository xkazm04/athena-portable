/**
 * The host capability manifest types (README section 3.3), shared by the WebMCP hooks and the tests.
 *
 * These types are the contract the four host apps publish and Athena will read at onboarding.
 * Nothing here imports React or the server, so both sides can use it.
 */

/** How far a tool reaches: nowhere, the app's own data, or the outside world. */
export type SideEffects = "none" | "data" | "external";

/** Design 5.1: `AUTO` = reversible with no side effects beyond the app; everything else `GATED`. */
export type ToolClass = "AUTO" | "GATED";

/** A parameter, in the flat shape `useWebMCPTool` takes. Enums and `maxItems` are mandatory for
 * anything that addresses UI (the anchor-manifest principle, design 5.1). */
export interface HostParameter {
  name: string;
  type?:
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "string[]"
    | "number[]"
    | "boolean[]"
    | "object[]";
  description?: string;
  required?: boolean;
  enum?: string[];
  attributes?: HostParameter[];
  /** Cap for array parameters; design 5.1 requires one on anything addressing UI. */
  maxItems?: number;
}

export interface ManifestTool {
  name: string;
  description: string;
  input_schema: JsonSchema;
  reversible: boolean;
  side_effects: SideEffects;
  transport: "webmcp";
}

export interface ManifestReadable {
  name: string;
  description: string;
  schema: JsonSchema;
  max_chars?: number;
  max_items?: number;
}

export interface HostManifest {
  app_id: string;
  app_version: string;
  origin: string;
  /** ISO-8601 UTC, refreshed whenever the manifest changes. */
  generated_at: string;
  state_readables: ManifestReadable[];
  tools: ManifestTool[];
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  maxItems?: number;
  description?: string;
}

/**
 * The design 5.1 rule, in one place: a tool that is not reversible, or that reaches outside the
 * app, is `GATED` no matter what the host would prefer.
 */
export function classifyTool(tool: Pick<ManifestTool, "reversible" | "side_effects">): ToolClass {
  return tool.reversible && tool.side_effects !== "external" ? "AUTO" : "GATED";
}

/** Registry name for a tool, per design 5.1 (`host.<app_id>.<name>`). */
export function registryName(appId: string, toolName: string): string {
  return `host.${appId}.${toolName}`;
}

const TYPE_MAP: Record<string, JsonSchema> = {
  string: { type: "string" },
  number: { type: "number" },
  boolean: { type: "boolean" },
  object: { type: "object" },
  "string[]": { type: "array", items: { type: "string" } },
  "number[]": { type: "array", items: { type: "number" } },
  "boolean[]": { type: "array", items: { type: "boolean" } },
  "object[]": { type: "array", items: { type: "object" } },
};

function paramSchema(p: HostParameter): JsonSchema {
  const base: JsonSchema = { ...(TYPE_MAP[p.type ?? "string"] ?? { type: "string" }) };
  if (p.description) base.description = p.description;
  if (p.enum) {
    // Design 5.1: an enum constrains the element, so on an array it belongs on `items`.
    if (base.type === "array") base.items = { ...(base.items ?? { type: "string" }), enum: p.enum };
    else base.enum = p.enum;
  }
  if (p.maxItems !== undefined) base.maxItems = p.maxItems;
  if (p.attributes && p.attributes.length > 0) {
    const nested = parametersToJsonSchema(p.attributes);
    if (base.type === "array") base.items = nested;
    else Object.assign(base, nested);
  }
  return base;
}

/** `HostParameter[]` -> the JSON Schema the manifest publishes. */
export function parametersToJsonSchema(params: HostParameter[] = []): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const p of params) {
    properties[p.name] = paramSchema(p);
    if (p.required !== false) required.push(p.name);
  }
  const schema: JsonSchema = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  return schema;
}
