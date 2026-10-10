/**
 * The generic hands on the shell side — README section 3.4 tier 2, ADR 0065.
 *
 * The shell is mocked at the one boundary the app has (`lib/ipc.ts`), as `stores/tools.test.ts`
 * does: `call` is the command. Routing, the list and the manifest are the code under test.
 */
import { beforeEach, expect, test, vi } from "vitest";

import type { BridgeTool } from "@/lib/bridge";
import type { Args } from "@/lib/ipc";

const commands: { command: string; args: Args }[] = [];
let shell = true;
/** What `hands_call` does next, when a test needs it to do something other than succeed. */
let handReply: (() => Promise<unknown>) | null = null;

const HAND_NAMES = [
  "page_read",
  "page_find",
  "page_click",
  "page_fill",
  "page_select",
  "page_submit",
  "page_scroll",
  "page_wait",
  "page_screenshot",
];

function tool(name: string, athena: unknown = null): BridgeTool {
  return { name, title: name, description: `${name}.`, inputSchema: { type: "object" }, annotations: null, athena };
}

vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>();
  return {
    ...actual,
    hasShell: () => shell,
    call: (command: string, args: Args = {}) => {
      commands.push({ command, args });
      if (command === "hands_list") {
        return Promise.resolve(HAND_NAMES.map((n) => tool(n, { reversible: n !== "page_click", side_effects: "none" })));
      }
      if (command === "hands_call") {
        if (handReply) return handReply();
        return Promise.resolve({ ok: true, output: "hand ran", reason: null, error: null, tier: 2, ms: 1 });
      }
      return Promise.resolve({ ok: true, output: "page ran" });
    },
  };
});

const hands = await import("@/lib/hands");
const { manifestBodyOf } = await import("@/lib/manifest");

beforeEach(() => {
  commands.length = 0;
  shell = true;
  handReply = null;
  hands.setHandsForTests([]);
});

test("the list is fetched once, and not at all without a shell", async () => {
  shell = false;
  await hands.startHands();
  expect(commands).toEqual([]);
  expect(hands.handTools()).toEqual([]);

  shell = true;
  await hands.startHands();
  await hands.startHands();
  expect(commands.map((c) => c.command)).toEqual(["hands_list"]);
  expect(hands.handTools().map((t) => t.name)).toEqual(HAND_NAMES);
});

test("a tool-less page with no athena:app gives the nine hands under its derived id", async () => {
  await hands.startHands();
  const body = manifestBodyOf({
    origin: "https://ledger.test",
    appId: null,
    appVersion: null,
    transport: null,
    tools: [],
  }) as { app_id: string; page_origin: string; tools: { name: string }[] };

  expect(body.app_id).toBe("web_https_sledger_dtest");
  expect(body.page_origin).toBe("https://ledger.test");
  expect(body.tools.map((t) => t.name)).toEqual(HAND_NAMES);
});

test("a page with tools gives its tools plus the hands, and a page tool named like a hand keeps the page's", async () => {
  await hands.startHands();
  const own = tool("page_read", { reversible: false, side_effects: "external" });
  const body = manifestBodyOf({
    origin: "https://ledger.test",
    appId: "ledger",
    appVersion: "1",
    transport: "webmcp-native",
    tools: [tool("pay"), own],
  }) as { app_id: string; tools: { name: string; side_effects: string }[] };

  expect(body.app_id).toBe("ledger");
  expect(body.tools.map((t) => t.name)).toEqual(["pay", "page_read", ...HAND_NAMES.filter((n) => n !== "page_read")]);
  expect(body.tools.find((t) => t.name === "page_read")?.side_effects).toBe("external");
});

test("outside the shell a tool-less page still publishes nothing", () => {
  expect(
    manifestBodyOf({ origin: "https://ledger.test", appId: null, appVersion: null, transport: null, tools: [] }),
  ).toBeNull();
});

test("a hand goes to hands_call and a page tool to bridge_call", async () => {
  await hands.startHands();
  commands.length = 0;
  const pageTools = [tool("pay")];

  const hand = await hands.callOnPage(7, "page_read", { ref: "r1" }, pageTools);
  const page = await hands.callOnPage(7, "pay", { id: "1" }, pageTools);

  expect(commands).toEqual([
    { command: "hands_call", args: { tab_id: 7, name: "page_read", input: { ref: "r1" } } },
    { command: "bridge_call", args: { tab_id: 7, name: "pay", params: { id: "1" }, timeout_ms: null } },
  ]);
  expect(hand).toMatchObject({ ok: true, output: "hand ran", tier: 2 });
  expect(page.tier).toBeUndefined();
});

test("a page tool named like a hand goes to the page", async () => {
  await hands.startHands();
  commands.length = 0;
  await hands.callOnPage(7, "page_read", {}, [tool("page_read")]);
  expect(commands.map((c) => c.command)).toEqual(["bridge_call"]);
});

test("a capture is page_screenshot through hands_call and answers its id", async () => {
  handReply = () =>
    Promise.resolve({ ok: true, output: "cap_0123456789ab · a capture", reason: null, error: null, tier: 2, ms: 1, capture_id: "cap_0123456789ab" });

  const taken = await hands.takeCapture(7, "https://ledger.test");

  expect(taken).toEqual({ id: "cap_0123456789ab", why: null });
  expect(commands).toEqual([{ command: "hands_call", args: { tab_id: 7, name: "page_screenshot", input: {} } }]);
});

test("a capture that is refused, throws or is late answers no id and says why", async () => {
  handReply = () => Promise.resolve({ ok: false, output: "", reason: "unknown", error: "the window is minimised", tier: 2, ms: 1, capture_id: null });
  expect(await hands.takeCapture(7, "https://ledger.test")).toEqual({ id: null, why: "the window is minimised" });

  handReply = () => Promise.reject(new Error("channel closed"));
  expect((await hands.takeCapture(7, "https://ledger.test")).why).toContain("channel closed");

  handReply = () => new Promise(() => {});
  const late = await hands.takeCapture(7, "https://ledger.test", 20);
  expect(late).toEqual({ id: null, why: "the screenshot took longer than 0.02 seconds" });
});

test("without a shell, or on a tab that is not a web page, no capture is asked for", async () => {
  shell = false;
  expect((await hands.takeCapture(7, "https://ledger.test")).id).toBeNull();
  shell = true;
  expect((await hands.takeCapture(7, "about:blank")).id).toBeNull();
  expect(commands).toEqual([]);
});
