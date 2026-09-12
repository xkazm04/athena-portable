/**
 * `@athena/demo-kit` - the shared scaffold for the three example host apps (ADR 0017).
 *
 * Import from the subpaths, not from here, so a client component never drags the server-only SQLite
 * module into its bundle:
 *
 *   `@athena/demo-kit/db`            server  openDb, Db, withTx
 *   `@athena/demo-kit/activity`      server  logActivity, listActivity, undoActivity
 *   `@athena/demo-kit/activity/ui`   client  ActivityLog
 *   `@athena/demo-kit/webmcp`        client  useWebMCPTool, annotationsFor, bounded
 *   `@athena/demo-kit/ui`            client  AppShell, DataTable, DetailPane, EmptyState, Toast
 *   `@athena/demo-kit/seed`          any     Rng, rngFor
 *
 * This barrel re-exports only what is safe everywhere: types and pure functions.
 */
export type { ActivityEntry, Actor, NewActivity } from "./activity/types";
export {
  classifyTool,
  parametersToJsonSchema,
  registryName,
  type HostManifest,
  type HostParameter,
  type JsonSchema,
  type ManifestReadable,
  type ManifestTool,
  type SideEffects,
  type ToolClass,
} from "./webmcp/types";
export { Rng, rngFor } from "./seed";
