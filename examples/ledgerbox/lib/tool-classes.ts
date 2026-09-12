/**
 * Design 5.1: the class of every capability the one shipped page registers, as data, in one table.
 *
 * `reversible && side_effects !== "external"` is the whole rule, and it is a property of WHAT THE
 * TOOL DOES - so the two flags belong to the tool, not to the call site that happens to register
 * it. Holding them here rather than inline in the two registration files buys one thing that
 * matters: a test can read the same declarations the app registers and check them against `annotationsFor`,
 * instead of restating the intended class in a second list that drifts.
 *
 * A read is `{ reversible: true, sideEffects: "none" }` and becomes `readOnlyHint`. A reversible
 * write is `{ true, "data" }` - the kit's branch 4, AUTO, and the commonest class in the repo.
 * Anything that cannot be taken back, or that reaches a person, is GATED by what it is; nothing
 * here may be downgraded to make a demo smoother.
 */
import type { WebMCPToolSpec } from "@athena/demo-kit/webmcp";

export type ToolClass = Pick<WebMCPToolSpec, "reversible" | "sideEffects">;

const READ: ToolClass = { reversible: true, sideEffects: "none" };
const WRITE: ToolClass = { reversible: true, sideEffects: "data" };
const PERMANENT: ToolClass = { reversible: false, sideEffects: "data" };
const REACHES_A_PERSON: ToolClass = { reversible: false, sideEffects: "external" };

export const TOOL_CLASSES = {
  // The Lanes' own layer. Four of them are registered by `useZoomTools` in the kit, which carries
  // the same two flags in its own source; they are named here because this table is what the
  // register on the surface and the class test both read, and a tool that is on the page but not
  // in the table would be a class nobody declared.
  read_view: READ,
  open_group: READ,
  open_item: READ,
  zoom_out: READ,
  search_invoices: READ,
  set_filter: READ,
  read_books: READ,
  read_inbox: READ,
  read_invoice: READ,
  read_credits: READ,
  read_clients: READ,
  navigate: READ,
  open_invoice: READ,
  select: READ,
  set_period: READ,
  categorize: WRITE,
  match_bank_line: WRITE,
  unmatch: WRITE,
  draft_reminder: WRITE,
  export_summary: WRITE,
  mark_paid: PERMANENT,
  send_reminder: REACHES_A_PERSON,
  void_invoice: PERMANENT,
} as const satisfies Record<string, ToolClass>;

export type ToolName = keyof typeof TOOL_CLASSES;
