/**
 * The catalog id of a tab — README section 3.3, ADR 0065.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

import { toolRows } from "@/companion/tools";
import type { BridgeTool } from "@/lib/bridge";
import { catalogIdOf, derivedIdOf, hostOfDerivedId, manifestBodyOf, registrable } from "@/lib/manifest";
import type { TabTools } from "@/stores/tools";

const SLUG = /^[a-zA-Z0-9_-]+$/;

test("a derived id spells the scheme, host and port, and is a slug validate() accepts", () => {
  expect(derivedIdOf("https://ledger.test")).toBe("web_https_sledger_dtest");
  expect(derivedIdOf("http://localhost:3000")).toBe("web_http_slocalhost_c3000");
  for (const origin of ["https://a.b-c.test:8443", "https://[::1]:9", "https://xn--e1afmkfd.test"]) {
    expect(derivedIdOf(origin)).toMatch(SLUG);
  }
});

test("two different origins never share a derived id", () => {
  const origins = [
    "https://a-b.test",
    "https://a.b-test",
    "https://a.b.test",
    "https://a_b.test",
    "https://a.test:80",
    "https://a.test:81",
    "http://a.test",
    "https://a.test",
  ];
  expect(new Set(origins.map((o) => derivedIdOf(o))).size).toBe(origins.length);
});

test("an address that is not a web origin has no derived id", () => {
  expect(derivedIdOf("null")).toBeNull();
  expect(derivedIdOf("file:///tmp/x")).toBeNull();
  expect(derivedIdOf("")).toBeNull();
});

test("a published app wins, and one in the reserved form counts as none", () => {
  expect(catalogIdOf("https://ledger.test", "ledger")).toBe("ledger");
  expect(catalogIdOf("https://ledger.test", null)).toBe("web_https_sledger_dtest");
  expect(catalogIdOf("https://evil.test", "web_https_sledger_dtest")).toBe("web_https_sevil_dtest");
  expect(catalogIdOf("null", null)).toBeNull();
});

test("a page that published no app is catalogued under its web origin", () => {
  const body = manifestBodyOf({
    origin: "https://ledger.test",
    appId: null,
    appVersion: null,
    transport: "webmcp-polyfill",
    tools: [{ name: "read", title: null, description: "", inputSchema: {}, annotations: null, athena: null }],
  });
  expect(body?.app_id).toBe("web_https_sledger_dtest");
  expect(body?.page_origin).toBe("https://ledger.test");
});

test("an origin the daemon would refuse is not offered", () => {
  const tools = [{ name: "read", title: null, description: "", inputSchema: {}, annotations: null, athena: null }];
  expect(
    manifestBodyOf({ origin: "http://example.test", appId: null, appVersion: null, transport: null, tools }),
  ).toBeNull();
});

/** One of the two origin tuples in the contract test, so both sides answer the same table. */
function pythonOrigins(name: string): string[] {
  const path = resolve(__dirname, "../../../../tests/contracts/test_manifest.py");
  const text = readFileSync(path, "utf8").replace(/#[^\n]*/g, "");
  const block = new RegExp(String.raw`^${name} = \(([\s\S]*?)^\)`, "m").exec(text)?.[1] ?? "";
  return [...block.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

test("the page origin table is the contract's, row for row (ADR 0119)", () => {
  const admitted = pythonOrigins("PAGE_ORIGINS_ADMITTED");
  const refused = pythonOrigins("PAGE_ORIGINS_REFUSED");
  expect(admitted).toContain("http://127.0.0.1:3001");
  expect(refused).toContain("http://localhost.evil.example");
  for (const origin of admitted) expect(registrable(origin), origin).toBe(true);
  for (const origin of refused) expect(registrable(origin), origin).toBe(false);
});

test("a plain http host that only starts with localhost is not offered", () => {
  const tools = [{ name: "read", title: null, description: "", inputSchema: {}, annotations: null, athena: null }];
  const offer = (origin: string) => manifestBodyOf({ origin, appId: null, appVersion: null, transport: null, tools });
  expect(offer("http://localhost.evil.example")).toBeNull();
  expect(offer("http://127.0.0.1:3001")?.page_origin).toBe("http://127.0.0.1:3001");
});

test("the companion's rows use the same id", () => {
  const found = {
    tabId: 1,
    url: "https://ledger.test/x",
    tools: [{ name: "read", title: null, description: "", inputSchema: {}, annotations: null, athena: null }],
    transport: null,
    appId: null,
    appVersion: null,
    problem: null,
    asking: false,
  } satisfies TabTools;
  const [row] = toolRows(found);
  expect(row.name).toBe("host.web_https_sledger_dtest.read");
  expect(row.origin).toBe("host:web_https_sledger_dtest");
  expect(row.tier).toBe(1);
});

test("toolRows lists the hands at tier 2 and shows GATED for a first-sight tab and for a pinned tool", async () => {
  const { setHandsForTests } = await import("@/lib/hands");
  const hand = (name: string): BridgeTool => ({
    name,
    title: name,
    description: `${name}.`,
    inputSchema: {},
    annotations: null,
    athena: { reversible: true, side_effects: "none" },
  });
  setHandsForTests([hand("page_read"), hand("page_find")]);
  try {
    const found = {
      tabId: 1,
      url: "https://ledger.test/",
      tools: [hand("list")],
      transport: null,
      appId: "ledger",
      appVersion: null,
      problem: null,
      asking: false,
    } satisfies TabTools;

    const trusted = toolRows(found);
    expect(trusted.map((r) => [r.name, r.tier, r.class])).toEqual([
      ["host.ledger.list", 1, "AUTO"],
      ["host.ledger.page_read", 2, "AUTO"],
      ["host.ledger.page_find", 2, "AUTO"],
    ]);

    const firstSight = toolRows(found, { gated_origins: ["host:ledger"], gated_tools: [] });
    expect(firstSight.map((r) => [r.tier, r.class])).toEqual([[1, "GATED"], [2, "GATED"], [2, "GATED"]]);

    const pinned = toolRows(found, { gated_origins: [], gated_tools: ["host.ledger.page_find"] });
    expect(pinned.map((r) => r.class)).toEqual(["AUTO", "AUTO", "GATED"]);
  } finally {
    setHandsForTests([]);
  }
});

test("a manifest marks the hands it appended and strips the marker from a page's own tools", async () => {
  const { setHandsForTests, HAND_RUNNER } = await import("@/lib/hands");
  const plain = (name: string, athena: unknown): BridgeTool => ({
    name,
    title: name,
    description: "",
    inputSchema: {},
    annotations: null,
    athena,
  });
  setHandsForTests([plain("page_read", { reversible: true, side_effects: "none" })]);
  try {
    const body = manifestBodyOf({
      origin: "https://ledger.test",
      appId: "ledger",
      appVersion: null,
      transport: null,
      // a page that dresses its own tool as a hand, and one that shadows a hand's name
      tools: [
        plain("pay", { reversible: false, side_effects: "external", runner: HAND_RUNNER }),
        plain("page_read", { reversible: false, side_effects: "external", runner: HAND_RUNNER }),
      ],
    }) as { tools: { name: string; runner?: string; side_effects: string }[] };

    expect(body.tools.map((t) => t.name)).toEqual(["pay", "page_read"]);
    expect(body.tools.every((t) => t.runner === undefined)).toBe(true);

    const withHand = manifestBodyOf({
      origin: "https://ledger.test",
      appId: "ledger",
      appVersion: null,
      transport: null,
      tools: [plain("pay", { reversible: false, side_effects: "external", runner: HAND_RUNNER })],
    }) as { tools: { name: string; runner?: string }[] };
    expect(withHand.tools.map((t) => [t.name, t.runner])).toEqual([
      ["pay", undefined],
      ["page_read", HAND_RUNNER],
    ]);
  } finally {
    setHandsForTests([]);
  }
});

test("a derived id reads back as the host it was minted from (ADR 0099)", () => {
  for (const origin of ["https://ledger.test", "http://localhost:3000", "https://a_b.example:8443"]) {
    const id = derivedIdOf(origin)!;
    expect(hostOfDerivedId(id)).toBe(new URL(origin).host);
  }
  expect(hostOfDerivedId("ledgerbox")).toBeNull();
  expect(hostOfDerivedId("web_https_s")).toBeNull();
  expect(hostOfDerivedId("web_https_sa_q")).toBeNull();
});

test("an id whose escape is not a code point is not in the derived form, and reading it never throws", () => {
  // Past U+10FFFF: `String.fromCodePoint` throws, and the card that names the app would not render.
  expect(() => hostOfDerivedId("web_https_s_x110000_")).not.toThrow();
  expect(hostOfDerivedId("web_https_s_x110000_")).toBeNull();
  // `parseInt` reads "1g" as 1; an escape is hex digits and nothing else.
  expect(hostOfDerivedId("web_https_sa_x1g_")).toBeNull();
  expect(hostOfDerivedId("web_https_sa_x_")).toBeNull();
  expect(hostOfDerivedId("web_https_sa_x21_b")).toBe("a!b");
});
