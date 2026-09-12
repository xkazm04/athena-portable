/**
 * The page these suites act on, and the fake surface that runs its tools — README section 3.4
 * tier 1.
 *
 * Two tools and no more, because two is what the gate's whole table needs: one `reversible`
 * tool whose side effects stay inside the app, which the catalog makes `AUTO`, and one that is
 * irreversible and `external`, which the catalog makes `GATED` whatever the page would prefer.
 *
 * The declarations are in the page's own shape — `BridgeTool`, the thing `inject.js` answers a
 * `list` with — so the manifest the panel publishes is built by the panel's own code from the
 * same claim a real page makes. `apps/desktop/e2e/browser/fixtures/ledgerbox.html` registers
 * these two names on `document.modelContext`, so the browser suite and this one are about one
 * application.
 */
import type { BridgeTool } from "@/lib/bridge";
import { manifestBodyOf, type ManifestSource } from "@/lib/manifest";

/** The `athena:app` slug. The catalog namespaces the tools `host.ledgerbox.<name>`. */
export const APP_ID = "ledgerbox";
export const APP_VERSION = "1.4.0";

/** The web origin suite 1 keys the session by. The browser suite uses its server's real one. */
export const PAGE_ORIGIN = "https://ledgerbox.e2e";

export const READ_TOOL = `host.${APP_ID}.list_overdue`;
export const WRITE_TOOL = `host.${APP_ID}.pay`;

export const PAGE_TOOLS: readonly BridgeTool[] = Object.freeze([
  {
    name: "list_overdue",
    title: "Overdue invoices",
    description: "Invoices past their due date.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    athena: { reversible: true, side_effects: "internal" },
  },
  {
    name: "pay",
    title: "Pay an invoice",
    description: "Pay an invoice from the settlement account.",
    inputSchema: { type: "object", properties: { invoice: { type: "string" } } },
    annotations: { consequentialHint: true },
    athena: { reversible: false, side_effects: "external" },
  },
]);

export const MANIFEST_SOURCE: ManifestSource = {
  origin: PAGE_ORIGIN,
  appId: APP_ID,
  appVersion: APP_VERSION,
  transport: "webmcp-polyfill",
  tools: PAGE_TOOLS,
};

/** The body `POST /manifest` takes, built by the shell's own code and nothing else. */
export function manifestBody(
  over: Partial<ManifestSource> = {},
): Record<string, unknown> {
  const body = manifestBodyOf({ ...MANIFEST_SOURCE, ...over });
  if (body === null) throw new Error("the fixture page must produce a manifest");
  return body;
}

/** One call the surface made on the page, in order, so a test can say what did not happen. */
export interface PageCall {
  tabId: number;
  name: string;
  input: Record<string, unknown>;
}

export interface FakePage {
  calls: PageCall[];
  /** The names the page was asked to run, in order — the assertion most of these tests make. */
  names: () => string[];
  call: (
    tabId: number,
    name: string,
    input: Record<string, unknown>,
  ) => Promise<{ ok: boolean; output: string; error?: string | null }>;
}

/**
 * A page that answers, and remembers being asked.
 *
 * It stands in for the Rust hop and the page's own JavaScript, which is the one thing suite 1
 * cannot have: `bridge_call` is a Tauri command. The browser suite replaces this with a real
 * document reached through `inject.js`.
 */
export function fakePage(answers: Readonly<Record<string, string>> = {}): FakePage {
  const calls: PageCall[] = [];
  return {
    calls,
    names: () => calls.map((c) => c.name),
    call: async (tabId, name, input) => {
      calls.push({ tabId, name, input });
      const output = answers[name];
      return output === undefined
        ? { ok: false, output: "", error: `No tool named ${name}` }
        : { ok: true, output };
    },
  };
}
