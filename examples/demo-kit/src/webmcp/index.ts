/**
 * `@athena/demo-kit/webmcp` — register capabilities on `document.modelContext` (WebMCP) with no
 * chat, no provider and no runtime. The standard is the integration; the bridge in
 * `packages/athena-bridge` is the consumer (README section 3.4, tier 1).
 */
export {
  detectModelContext,
  ensureModelContext,
  type Detection,
  type JsonSchemaObject,
  type ModelContext,
  type RegisteredTool,
  type ToolDescriptor,
  type ToolExecute,
  type WebMCPAnnotations,
} from "./modelContext";
export {
  PAGE,
  bounded,
  boundedPage,
  type Bounded,
  type BoundedPage,
} from "./bounded";
export {
  DOOR_CEILING_MS,
  MAX_RESULT_CHARS,
  ToolRefusal,
  fitted,
  type ArgumentError,
  type RefusalReason,
  type ToolOutcome,
} from "./door";
export { annotationsFor, toolDescriptorFor, useWebMCPTool, type WebMCPToolSpec } from "./hooks";
export {
  useZoomTools,
  type ZoomGroup,
  type ZoomItem,
  type ZoomToolsSpec,
} from "./zoomTools";
