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
/** What `captures_sweep` does next; `null` answers a sweep result. */
let sweepReply: (() => Promise<unknown>) | null = null;

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
    capturesSweep: (cap: number | null = null) => {
      commands.push({ command: "captures_sweep", args: { cap_bytes: cap } });
      if (sweepReply) return sweepReply();
      return Promise.resolve({ removed: 0, freed: 0, bytes: 0, cap_bytes: 64 * 1024 * 1024 });
    },
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
  sweepReply = null;
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
  // The first call also sweeps `captures` once (README 3.5); the second asks nothing.
  expect(commands.map((c) => c.command)).toEqual(["captures_sweep", "hands_list"]);
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

test("tabs_read is reserved: a page's tool of that name is dropped and the call is the shell's", () => {
  // ADR 0105: a page cannot answer for another tab, so its claim to the name is not kept.
  hands.setHandsForTests([tool("page_read"), tool(hands.TABS_READ, { reversible: true, side_effects: "none" })]);
  const own = tool(hands.TABS_READ, { reversible: true, side_effects: "none" });
  const merged = hands.withHands([tool("pay"), own]);

  expect(merged.map((t) => t.name)).toEqual(["pay", "page_read", hands.TABS_READ]);
  expect(hands.isMarkedHand(merged[2])).toBe(true);
  expect(hands.isHandCall(hands.TABS_READ, [own])).toBe(true);
});

test("a tabs_read answer carries the tab the shell read", async () => {
  hands.setHandsForTests([tool(hands.TABS_READ, { reversible: true, side_effects: "none" })]);
  handReply = () =>
    Promise.resolve({ ok: true, output: "from https://bank.test - S (u)\nx", reason: null, error: null, tier: 2, ms: 1, source_tab: 4, source_origin: "https://bank.test" });

  const answer = await hands.callOnPage(1, hands.TABS_READ, { url: "https://bank.test/s" }, []);

  expect(commands.at(-1)).toEqual({ command: "hands_call", args: { tab_id: 1, name: "tabs_read", input: { url: "https://bank.test/s" } } });
  expect(answer).toMatchObject({ ok: true, tier: 2, sourceTab: 4 });
});

test("a capture is page_screenshot through hands_call and answers its id", async () => {
  handReply = () =>
    Promise.resolve({ ok: true, output: "cap_0123456789ab · a capture", reason: null, error: null, tier: 2, ms: 1, capture_id: "cap_0123456789ab" });

  const taken = await hands.takeCapture(7, "https://ledger.test");

  expect(taken).toEqual({ id: "cap_0123456789ab", why: null });
  expect(commands.map((c) => c.command)).toEqual(["hands_call", "captures_sweep"]);
  expect(commands[0]).toEqual({ command: "hands_call", args: { tab_id: 7, name: "page_screenshot", input: {} } });
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

// -- the captures cap (README 3.5, ADR 0066) -------------------------------------------------------

const sweeps = () => commands.filter((c) => c.command === "captures_sweep");
const FILED = { ok: true, output: "", reason: null, error: null, tier: 2, ms: 1, capture_id: "cap_0123456789ab" };

test("a capture is followed by exactly one sweep at the default cap", async () => {
  handReply = () => Promise.resolve(FILED);
  expect(await hands.takeCapture(7, "https://ledger.test")).toEqual({ id: "cap_0123456789ab", why: null });
  expect(sweeps()).toEqual([{ command: "captures_sweep", args: { cap_bytes: null } }]);
  expect(commands.map((c) => c.command)).toEqual(["hands_call", "captures_sweep"]);
});

test("a sweep that is slow does not hold the capture", async () => {
  handReply = () => Promise.resolve(FILED);
  sweepReply = () => new Promise(() => undefined);
  expect((await hands.takeCapture(7, "https://ledger.test")).id).toBe("cap_0123456789ab");
});

test("a failing sweep leaves the capture's id and why as they were", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    handReply = () => Promise.resolve(FILED);
    sweepReply = () => Promise.reject(new Error("database is locked"));
    expect(await hands.takeCapture(7, "https://ledger.test")).toEqual({ id: "cap_0123456789ab", why: null });
    sweepReply = () => {
      throw new Error("channel closed");
    };
    expect(await hands.takeCapture(7, "https://ledger.test")).toEqual({ id: "cap_0123456789ab", why: null });
    await Promise.resolve();
    expect(sweeps()).toHaveLength(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("database is locked"));
  } finally {
    log.mockRestore();
  }
});

test("a capture that failed filed no row and sweeps nothing", async () => {
  handReply = () => Promise.resolve({ ok: false, output: "", reason: "minimised", error: "the window is minimised", tier: 2, ms: 1 });
  expect((await hands.takeCapture(7, "https://ledger.test")).id).toBeNull();
  handReply = () => Promise.reject(new Error("channel closed"));
  expect((await hands.takeCapture(7, "https://ledger.test")).id).toBeNull();
  handReply = () => Promise.resolve({ ok: true, output: "", reason: null, error: null, tier: 2, ms: 1 });
  expect((await hands.takeCapture(7, "https://ledger.test")).id).toBeNull();
  expect(sweeps()).toHaveLength(0);
});

test("with no shell, or on a page that is not the web, nothing is asked and nothing is swept", async () => {
  shell = false;
  expect((await hands.takeCapture(7, "https://ledger.test")).id).toBeNull();
  shell = true;
  expect((await hands.takeCapture(7, "about:blank")).id).toBeNull();
  shell = false;
  await hands.startHands();
  expect(sweeps()).toHaveLength(0);
});

test("startHands sweeps once, so a table already too big is trimmed, and a failure leaves the hands", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    sweepReply = () => Promise.reject(new Error("database is locked"));
    await hands.startHands();
    await hands.startHands();
    await hands.startHands();
    expect(sweeps()).toHaveLength(1);
    expect(hands.handTools().map((h) => h.name)).toEqual(HAND_NAMES);
  } finally {
    log.mockRestore();
  }
});
