/**
 * The capability manifest: every tool the one shipped route registers, with its parameters
 * (design 5.1, README section 3.3).
 *
 * Ledgerbox ships ONE design and ONE page, and that page carries two registration files — the
 * Lanes' read-and-move layer (`components/lanes/tools/LanesTools.tsx`) and the books' own acts
 * (`components/lanes/tools/BooksTools.tsx`). They used to live on two different routes, which
 * meant neither list had to be complete and neither had to agree with the other. Mounted together
 * the UNION is the thing that has to be true, and a union that exists only inside two `.tsx` files
 * cannot be read by a test, because `node --test` cannot parse JSX.
 *
 * So the parameters live here: no React, no server, no JSX. What does NOT live here is the class.
 * `lib/tool-classes.ts` is the single source of the two design 5.1 flags, and `registration()`
 * reads them from there — so a tool cannot be given one class in the table and another at the
 * call site.
 *
 * The four zoom verbs are declared here as well even though `useZoomTools` in
 * `@athena/demo-kit/webmcp` is what actually registers them: the manifest is what the surface
 * prints and what the test counts, and a tool that is on the page but not on the list is exactly
 * the drawer nobody opened.
 */
import {
  CATEGORIES,
  CREDIT_FILTERS,
  FILTERS,
  INBOX_PAGE,
  MAX_IDS,
  PERIODS,
  SELECT_MAX,
  TONES,
  VIEWS,
} from "./constants";
import { STATE_FILTERS } from "@/components/lanes/model";
import { TOOL_CLASSES, type ToolClass, type ToolName } from "./tool-classes";

/** A parameter, in the shape `useWebMCPTool` takes. Enums are mandatory for anything that
 *  addresses UI, and every array parameter carries a cap (design 5.1). */
export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "string[]";
  enum?: readonly string[];
  required?: boolean;
  maxItems?: number;
  description?: string;
}

export interface Capability {
  name: ToolName;
  parameters: readonly ToolParameter[];
}

/** The rule, applied rather than typed out: AUTO is reversible and stays inside the app. */
export function isAuto(capability: Pick<ToolClass, "reversible" | "sideEffects">): boolean {
  return capability.reversible && capability.sideEffects !== "external";
}

const INVOICE_ID: ToolParameter = {
  name: "id",
  type: "string",
  required: true,
  description: "An invoice id, from read_view, read_inbox or search_invoices — e.g. inv_0042",
};

const LINE_ID: ToolParameter = {
  name: "line_id",
  type: "string",
  required: true,
  description: "A bank line id, from read_credits or the card's candidates — e.g. bl_00042",
};

/**
 * The Lanes' own layer: the four zoom verbs, a search across the whole book, and the filter the
 * swarm is lit by. Every one of them reads or moves the view, so every one is AUTO — and that is
 * a claim the foot prints rather than a coincidence.
 */
export const VIEW_CAPABILITIES = [
  { name: "read_view", parameters: [] },
  {
    name: "open_group",
    parameters: [
      { name: "id", type: "string", required: true, description: "The area's id, from read_view" },
    ],
  },
  {
    name: "open_item",
    parameters: [
      { name: "id", type: "string", required: true, description: "The invoice's id" },
      { name: "group", type: "string", description: "Optional area id to look in" },
    ],
  },
  { name: "zoom_out", parameters: [] },
  {
    name: "search_invoices",
    parameters: [
      { name: "text", type: "string", description: "Matched against number, client and the waiting-on clause" },
      { name: "area", type: "string", description: "One area of the practice, or omit for all" },
      { name: "state", type: "string", enum: STATE_FILTERS, description: "One invoice state" },
      {
        name: "overdue_by",
        type: "number",
        description:
          "Only invoices at least this many days past due; 0 and 1 both mean overdue at all — omit the parameter for no filter",
      },
      {
        name: "balance_over",
        type: "number",
        description:
          "Only invoices with at least this much still owed, in units; 0 means anything still owed — omit the parameter for no filter",
      },
      { name: "unmatched", type: "boolean", description: "Only invoices carrying an unapplied credit that might fit" },
    ],
  },
  {
    name: "set_filter",
    parameters: [
      { name: "state", type: "string", enum: STATE_FILTERS, description: "Invoice state, or 'all'" },
      { name: "client", type: "string", description: "A client id from read_view, or 'all'" },
    ],
  },
] as const satisfies readonly Capability[];

/**
 * The books' own layer: what the studio can read about its money, and the seven acts that change
 * it. Three of those cannot be taken back — `mark_paid` and `void_invoice` make a permanent
 * statement about money, `send_reminder` reaches a person — and they are GATED by what they are,
 * in `lib/tool-classes.ts`. Nothing here is downgraded to make a demo smoother.
 */
export const BOOKS_CAPABILITIES = [
  { name: "read_books", parameters: [] },
  {
    name: "read_inbox",
    parameters: [
      { name: "filter", type: "string", enum: FILTERS, required: false, description: "Defaults to all — every invoice in the books" },
      { name: "page", type: "number", required: false, description: `Zero-based page of ${INBOX_PAGE}` },
    ],
  },
  { name: "read_invoice", parameters: [INVOICE_ID] },
  {
    name: "read_credits",
    parameters: [
      {
        name: "only",
        type: "string",
        enum: CREDIT_FILTERS,
        required: false,
        description: "all (default), ambiguous, or unambiguous — the credits that can be applied without asking",
      },
    ],
  },
  { name: "read_clients", parameters: [] },
  {
    name: "navigate",
    parameters: [
      { name: "view", type: "string", enum: VIEWS, required: true, description: "View to open" },
    ],
  },
  { name: "open_invoice", parameters: [INVOICE_ID] },
  {
    name: "select",
    parameters: [
      {
        name: "ids",
        type: "string[]",
        required: true,
        maxItems: SELECT_MAX,
        description: "Invoice ids to tick on the sheet. An empty list clears the tick.",
      },
    ],
  },
  {
    name: "set_period",
    parameters: [{ name: "period", type: "string", enum: PERIODS, required: true }],
  },
  {
    name: "categorize",
    parameters: [
      { name: "ids", type: "string[]", required: true, maxItems: MAX_IDS, description: "Invoice ids" },
      { name: "category", type: "string", enum: CATEGORIES, required: true },
    ],
  },
  {
    name: "match_bank_line",
    parameters: [
      { name: "invoice_id", type: "string", required: true, description: "An invoice id" },
      LINE_ID,
    ],
  },
  {
    name: "unmatch",
    parameters: [
      { name: "invoice_id", type: "string", required: true, description: "An invoice id" },
      LINE_ID,
    ],
  },
  {
    name: "draft_reminder",
    parameters: [INVOICE_ID, { name: "tone", type: "string", enum: TONES, required: true }],
  },
  {
    name: "mark_paid",
    parameters: [
      INVOICE_ID,
      { name: "amount", type: "number", required: true, description: "Amount in dollars, e.g. 1250.00" },
    ],
  },
  { name: "send_reminder", parameters: [INVOICE_ID] },
  { name: "void_invoice", parameters: [INVOICE_ID] },
  {
    name: "export_summary",
    parameters: [{ name: "period", type: "string", enum: PERIODS, required: true }],
  },
] as const satisfies readonly Capability[];

/**
 * What the one page actually puts on `document.modelContext`: both layers, mounted together.
 *
 * There is no name collision between them, and that is a property worth stating rather than
 * assuming — `test/tools.test.ts` asserts it. The Lanes' verbs act on the VIEW (`open_item`,
 * `zoom_out`, `set_filter`); the books' verbs act on the MONEY (`open_invoice`, `mark_paid`,
 * `navigate`). Where the two vocabularies touch — opening an invoice, moving the filter — the
 * handlers deliberately land on the same client state, so an agent that speaks either one moves
 * the same picture.
 */
export const CAPABILITIES = [
  ...VIEW_CAPABILITIES,
  ...BOOKS_CAPABILITIES,
] as const satisfies readonly Capability[];

/** One manifest row, in the shape `useWebMCPTool` takes: the parameters from here, the class from
 *  `lib/tool-classes.ts`. The enum arrays are copied because the kit's `HostParameter` wants a
 *  mutable one; the manifest keeps its own readonly. */
export interface RegisteredParameter extends Omit<ToolParameter, "enum"> {
  enum?: string[];
}

export function registration(name: ToolName): {
  parameters: RegisteredParameter[];
  reversible: boolean;
  sideEffects: ToolClass["sideEffects"];
} {
  const all: readonly Capability[] = CAPABILITIES;
  const found = all.find((c) => c.name === name);
  if (!found) throw new Error(`${name} is not on the capability manifest`);
  return {
    parameters: found.parameters.map((p) => ({
      name: p.name,
      type: p.type,
      ...(p.enum ? { enum: [...p.enum] } : {}),
      ...(p.required === undefined ? {} : { required: p.required }),
      ...(p.maxItems === undefined ? {} : { maxItems: p.maxItems }),
      ...(p.description === undefined ? {} : { description: p.description }),
    })),
    ...TOOL_CLASSES[name],
  };
}

/** The register the foot prints: every capability on the page, with the class applied to it. */
export const REGISTER = CAPABILITIES.map((c) => ({
  name: c.name,
  auto: isAuto(TOOL_CLASSES[c.name]),
}));
