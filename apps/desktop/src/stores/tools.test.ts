/**
 * The tools store — the three occasions it asks, and the two facts it keeps apart.
 *
 * The shell is mocked at the one boundary the app has (`lib/ipc.ts`): `call` is the command, `on`
 * is the event, and everything above them — `lib/bridge.ts`, this store, the Browser module's
 * selector — is the code under test. That is the whole reason `ipc.ts` is one file.
 */
import { beforeAll, beforeEach, expect, test, vi } from "vitest";

import type { BridgePage, BridgeTool, ListReply } from "@/lib/bridge";
import type { Args, Tab } from "@/lib/ipc";

/** Every command the app made, in order. */
const commands: { command: string; args: Args }[] = [];
/** Every event handler `on` was given, by event name. */
const handlers = new Map<string, (payload: unknown) => void>();
/** What the next `bridge_list` answers. A promise is a page that is still thinking. */
let answer: () => ListReply | Promise<ListReply> = () => ({ ok: false, error: "nothing set" });

vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>();
  return {
    ...actual,
    hasShell: () => true,
    call: (command: string, args: Args = {}) => {
      commands.push({ command, args });
      return Promise.resolve(answer());
    },
    on: (event: string, f: (payload: unknown) => void) => {
      handlers.set(event, f);
      return Promise.resolve(() => handlers.delete(event));
    },
  };
});

const { useTabs } = await import("@/stores/tabs");
const { startTools, useTools } = await import("@/stores/tools");

const PAGE: BridgePage = {
  origin: "https://ledgerbox.test",
  href: "https://ledgerbox.test/invoices",
  title: "Invoices",
  app_id: "ledgerbox",
  app_name: "Ledgerbox",
  app_version: "1.4.0",
  manifest: null,
  transport: "webmcp-polyfill",
  deprecated_navigator: false,
};

function tool(name: string): BridgeTool {
  return { name, title: null, description: "", inputSchema: {}, annotations: null, athena: null };
}

function tab(id: number, url: string): Tab {
  return { id, label: `page-${id}`, url, title: "", focused: id === 1 };
}

/** Let the store's in-flight promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(async () => {
  await startTools();
});

beforeEach(() => {
  commands.length = 0;
});

test("a tab that appears is asked once, and the answer is filed under its id", async () => {
  answer = () => ({ ok: true, page: PAGE, tools: [tool("invoice_list")] });
  useTabs.setState({ tabs: [tab(1, "https://ledgerbox.test/invoices")], loaded: true });
  await settle();

  expect(commands).toEqual([{ command: "bridge_list", args: { tab_id: 1 } }]);
  const entry = useTools.getState().byTab[1];
  expect(entry.tools.map((t) => t.name)).toEqual(["invoice_list"]);
  expect(entry.transport).toBe("webmcp-polyfill");
  expect(entry.appId).toBe("ledgerbox");
  expect(entry.problem).toBeNull();
  expect(entry.asking).toBe(false);
});

test("a toolchange from the page re-reads that tab", async () => {
  answer = () => ({ ok: true, page: PAGE, tools: [tool("invoice_list"), tool("invoice_send")] });

  const toolchange = handlers.get("bridge:toolchange");
  expect(toolchange, "the store subscribed to the event the relay emits").toBeTypeOf("function");
  toolchange?.({ tab_id: 1 });
  await settle();

  expect(commands).toEqual([{ command: "bridge_list", args: { tab_id: 1 } }]);
  expect(useTools.getState().byTab[1].tools.map((t) => t.name)).toEqual([
    "invoice_list",
    "invoice_send",
  ]);
});

test("a page that never answers is a page with no tools and a reason, not an empty one", async () => {
  answer = () => ({ ok: false, error: "timeout" });
  await useTools.getState().refresh(1);

  const entry = useTools.getState().byTab[1];
  expect(entry.tools).toEqual([]);
  expect(entry.problem).toBe("timeout");
  expect(entry.asking).toBe(false);
});

test("an answer about a document the tab has left is dropped", async () => {
  // The page on /invoices is asked and takes its time.
  let release: (reply: ListReply) => void = () => {};
  answer = () => new Promise<ListReply>((resolve) => (release = resolve));
  const asked = useTools.getState().refresh(1);

  // While it is thinking, the tab navigates. The new document answers at once.
  answer = () => ({ ok: true, page: PAGE, tools: [tool("fresh")] });
  useTabs.setState({ tabs: [tab(1, "https://ledgerbox.test/somewhere-else")] });
  await settle();

  // And now the old document answers. Nobody wants it: it is about a page that is gone.
  release({ ok: true, page: PAGE, tools: [tool("stale")] });
  await asked;

  const entry = useTools.getState().byTab[1];
  expect(entry.url).toBe("https://ledgerbox.test/somewhere-else");
  expect(entry.tools.map((t) => t.name)).toEqual(["fresh"]);
});

test("a closed tab is forgotten", async () => {
  answer = () => ({ ok: true, page: PAGE, tools: [] });
  useTabs.setState({ tabs: [] });
  await settle();

  expect(useTools.getState().byTab[1]).toBeUndefined();
  expect(commands).toEqual([]);
});
