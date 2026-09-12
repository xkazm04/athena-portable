/**
 * The Panel module's fixtures — view-models, no store, no shell, no daemon.
 *
 * `degraded` means what it means in this app rather than "some fields are empty": the daemon is
 * not answering *and* the page in front of the user has no bridge, which is the state a first
 * launch on a real site lands in and the one the rail owes two different answers to. `heavy` is
 * the state that has to be looked at before a release — thirty lines of record, two decision
 * cards with one of them already answered, a parameter long enough to be cut, and a capture — so
 * that nothing about the card's shape can regress unseen.
 */
import type { Decision, ToolRow, TranscriptItem } from "@/stores/run";

import {
  INERT_ACTIONS,
  selectPanel,
  type PanelModel,
  type PanelPage,
  type PanelSources,
} from "./model";

/**
 * A fixture's picture is an inline SVG so this file stays readable. A real capture is a PNG the
 * shell wrote into the `captures` table and the module reads back with `store_get`; the view puts
 * either in the same `<img>`, because untrusted pixels are pixels.
 */
const CAPTURE_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
     <rect width="320" height="180" fill="#f3f4f6"/>
     <rect width="320" height="26" fill="#e2e5ea"/>
     <rect x="10" y="9" width="120" height="8" rx="4" fill="#b9c0ca"/>
     <rect x="16" y="46" width="180" height="14" rx="3" fill="#c8cdd5"/>
     <rect x="16" y="72" width="288" height="9" rx="3" fill="#d8dce2"/>
     <rect x="16" y="88" width="288" height="9" rx="3" fill="#d8dce2"/>
     <rect x="16" y="104" width="210" height="9" rx="3" fill="#d8dce2"/>
     <rect x="16" y="134" width="92" height="22" rx="4" fill="#9aa4b2"/>
   </svg>`,
)}`;

const CAPTURES = { cap_01: CAPTURE_URL };

function tool(over: Partial<ToolRow> & Pick<ToolRow, "name">): ToolRow {
  return {
    origin: "https://invoices.example.test",
    description: "What the page says this tool does.",
    tier: 1,
    declaredCls: "GATED",
    overrideCls: null,
    effectiveCls: "GATED",
    transport: "webmcp-polyfill",
    ...over,
  };
}

const PAGE_TOOLS: ToolRow[] = [
  tool({
    name: "list_invoices",
    description: "Every invoice on the current view, with its age and amount.",
    declaredCls: "READ",
    effectiveCls: "READ",
  }),
  tool({
    name: "open_invoice",
    description: "Open one invoice by its number.",
    declaredCls: "AUTO",
    effectiveCls: "AUTO",
  }),
  tool({
    name: "send_reminder",
    description: "Email the client a reminder for one invoice. Reaches outside the page.",
  }),
];

/** The nine generic hands are tier 2 and `GATED` on first sight for every new origin (§3.3). */
const HANDS: ToolRow[] = [
  "page_read",
  "page_find",
  "page_click",
  "page_type",
  "page_fill",
  "page_scroll",
  "page_screenshot",
  "tab_open",
  "tab_focus",
].map((name) =>
  tool({
    name,
    tier: 2,
    description: "A generic hand the shell runs on whatever page is focused.",
    transport: "shell",
  }),
);

const PAGE: PanelPage = {
  tabId: 1,
  title: "Invoices — March",
  url: "https://invoices.example.test/invoices?age=30",
  host: "invoices.example.test",
  origin: "https://invoices.example.test",
};

function item(over: Partial<TranscriptItem> & Pick<TranscriptItem, "id" | "kind">): TranscriptItem {
  return { text: "", at: 1_767_225_600_000, ...over };
}

const DECISION: Decision = {
  id: "apr_7f21",
  action: "host.invoices.send_reminder",
  params: {
    invoice: "INV-2214",
    to: "ops@late-paying-client.example",
    subject: "Invoice INV-2214 is 34 days overdue",
    body:
      "Hello — invoice INV-2214 for 4,200 EUR was due on the 8th and is now 34 days overdue. " +
      "The work it covers was signed off in February. Could you confirm a payment date this week? " +
      "I have attached the original invoice again for convenience.",
    dry_run: false,
  },
  summary: "Send the chase for the oldest overdue invoice, as you asked.",
  options: ["approve", "decline", "approve once"],
  captureId: "cap_01",
  origin: "https://invoices.example.test",
  surface: "panel",
  createdAt: 1_767_225_600_000,
};

/** A `decision` line carries the whole card in `meta`, so the record can be read without the store. */
function decisionItem(id: string, decision: Decision, choice: string | null): TranscriptItem {
  return item({
    id,
    kind: "decision",
    text: decision.summary,
    at: decision.createdAt,
    meta: {
      id: decision.id,
      action: decision.action,
      params: decision.params,
      summary: decision.summary,
      options: decision.options,
      captureId: decision.captureId,
      origin: decision.origin,
      surface: decision.surface,
      createdAt: decision.createdAt,
      ...(choice ? { choice } : {}),
    },
  });
}

function model(over: Partial<PanelSources> = {}): PanelModel {
  return selectPanel({
    status: "idle",
    transcript: [],
    pendingDecision: null,
    lastError: null,
    conversationId: "conv_3a91",
    tools: PAGE_TOOLS,
    page: PAGE,
    bridge: { transport: "webmcp-polyfill", problem: null, asking: false },
    trust: { origin: PAGE.origin, enabled: true, known: true, overrides: {} },
    daemonReady: true,
    daemonProblem: null,
    captures: CAPTURES,
    actions: INERT_ACTIONS,
    ...over,
  });
}

/** One tick after mount: a window, a page, and nothing asked yet. */
const empty = model({
  conversationId: null,
  tools: [],
  bridge: { transport: null, problem: null, asking: true },
  trust: { origin: PAGE.origin, enabled: false, known: false, overrides: {} },
});

const typical = model({
  transcript: [
    item({ id: "l1", kind: "user", text: "Which invoices are more than 30 days late?" }),
    item({
      id: "l2",
      kind: "tool.call",
      text: "list_invoices(age_days: 30)",
    }),
    item({
      id: "l3",
      kind: "tool.result",
      text: "list_invoices — 3 rows (showing 3 of 3)",
    }),
    item({
      id: "l4",
      kind: "assistant",
      text: "Three: INV-2214 at 34 days, INV-2209 at 41 days and INV-2198 at 52 days. The oldest two are the same client.",
    }),
  ],
});

/**
 * The state a release is looked at in: thirty lines, one card answered and one waiting, a
 * parameter far past its row budget, an override the user pinned, and a first-sight origin.
 */
const heavy = model({
  status: "awaiting_decision",
  pendingDecision: DECISION,
  tools: [
    ...PAGE_TOOLS.map((t) =>
      t.name === "open_invoice"
        ? { ...t, overrideCls: "GATED" as const, effectiveCls: "GATED" as const }
        : t,
    ),
    ...HANDS,
  ],
  trust: {
    origin: PAGE.origin,
    enabled: true,
    known: true,
    overrides: { open_invoice: "GATED" },
  },
  transcript: [
    item({ id: "h1", kind: "user", text: "Find every invoice over 30 days and draft a chase for each." }),
    item({ id: "h2", kind: "assistant", text: "Reading the invoice list first." }),
    ...Array.from({ length: 8 }, (_, i) =>
      [
        item({ id: `h${i}c`, kind: "tool.call", text: `page_read(ref: "row-${i + 1}")` }),
        item({
          id: `h${i}r`,
          kind: "tool.result",
          text: `page_read — INV-22${10 + i} · 4,2${i}0 EUR · ${30 + i * 3} days (showing 240 of 1,180)`,
        }),
      ],
    ).flat(),
    decisionItem("h20", { ...DECISION, id: "apr_7e04", action: "host.invoices.open_invoice" }, "approve"),
    item({ id: "h21", kind: "tool.result", text: "open_invoice — INV-2209 is on screen" }),
    item({
      id: "h22",
      kind: "error",
      text: "The page did not answer page_fill within 30s.",
    }),
    item({ id: "h23", kind: "assistant", text: "The support inbox was still loading; asking again." }),
    item({ id: "h24", kind: "tool.call", text: "tab_focus(tab: 2)" }),
    item({ id: "h25", kind: "tool.result", text: "tab_focus — support.example.test" }),
    item({
      id: "h26",
      kind: "summary",
      text: "3 invoices read, 1 draft filled, 1 chase waiting on you. 2 model rounds, 0.9s.",
    }),
    decisionItem("h27", DECISION, null),
  ],
});

/** The daemon never came up and the page in front of the user has no bridge. Both, at once. */
const degraded = model({
  status: "error",
  daemonReady: false,
  daemonProblem: "daemon_offline",
  conversationId: null,
  lastError: { reason: "daemon_offline", detail: "the sidecar exited before answering /health" },
  tools: [],
  bridge: { transport: null, problem: "timeout", asking: false },
  trust: { origin: PAGE.origin, enabled: false, known: false, overrides: {} },
  transcript: [
    item({ id: "d1", kind: "user", text: "Draft the chase for INV-2214." }),
    item({ id: "d2", kind: "error", text: "Athena could not be reached: daemon_offline." }),
  ],
});

/** The commoner half of `degraded` on its own: the daemon is fine and the site is an ordinary one. */
const noBridge = model({
  conversationId: null,
  tools: [],
  bridge: { transport: null, problem: "timeout", asking: false },
  trust: { origin: PAGE.origin, enabled: true, known: true, overrides: {} },
});

/**
 * Act 1 of the demo, exactly: a page opened for the first time, nothing ruled on yet, the page's
 * own tools at the class its manifest implies and every generic hand `GATED` because this origin
 * has never been seen (README section 3.3).
 */
const firstSight = model({
  conversationId: null,
  transcript: [],
  tools: [...PAGE_TOOLS, ...HANDS],
  trust: { origin: PAGE.origin, enabled: false, known: false, overrides: {} },
});

export const fixtures: Record<string, PanelModel> = {
  empty,
  typical,
  heavy,
  degraded,
  "first-sight": firstSight,
  "no-bridge": noBridge,
};

export const fixtureIds = ["empty", "typical", "heavy", "degraded", "first-sight", "no-bridge"] as const;
