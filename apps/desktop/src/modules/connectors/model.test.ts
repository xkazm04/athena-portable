/**
 * The Connectors selector: the standing is derived from the record in order of what is known,
 * the seal is a sentence only when something is sealed, and a write is what the flags say.
 */
import { expect, test } from "vitest";

import type { ConnectorView } from "@/lib/api";

import { INERT_ACTIONS, ageOf, isWrite, paragraphsOf, selectConnectors, standingOf } from "./model";

const NOW = Date.parse("2026-09-12T12:00:00Z");

function view(over: Partial<ConnectorView> = {}, conn: Partial<ConnectorView["connection"]> = {}): ConnectorView {
  return {
    id: "notion",
    label: "Notion",
    description: "",
    auth: "token",
    guide: "",
    api_hosts: [],
    egress: "resources",
    tools: [
      { name: "search", description: "Search.", reversible: true, side_effects: "none" },
      { name: "append_to_page", description: "Append.", reversible: false, side_effects: "external" },
      { name: "rename", description: "Rename.", reversible: true, side_effects: "external" },
    ],
    connection: {
      id: "notion",
      status: "connected",
      identity: "Test User",
      connected_at: "2026-09-12T11:00:00Z",
      enabled: true,
      writes_enabled: false,
      allowlist: [],
      health: "healthy",
      health_at: "2026-09-12T11:00:00Z",
      health_detail: "",
      seal: "dpapi",
      expires_at: "",
      last_used_at: "",
      ...conn,
    },
    live: true,
    seal_available: true,
    flow: null,
    ...over,
  };
}

test("the standing is read in order: reauth, then disconnected, then off, then broken, then connected", () => {
  expect(standingOf(view({}, { status: "needs_reauth" }), NOW).standing).toBe("needs-reauth");
  expect(standingOf(view({}, { status: "disconnected", enabled: false }), NOW).standing).toBe("not-connected");
  expect(standingOf(view({}, { enabled: false, health: "broken" }), NOW).standing).toBe("off");
  const broken = standingOf(view({}, { health: "broken", health_at: "2026-09-12T11:57:00Z", health_detail: "401" }), NOW);
  expect(broken.standing).toBe("broken");
  expect(broken.word).toBe("broken (3 min ago)");
  expect(broken.sentence).toBe("401");
  expect(standingOf(view(), NOW).sentence).toBe("Connected as Test User.");
});

test("a write is what the flags say, exactly as the catalog derives it", () => {
  const row = selectConnectors([view()], true, null, true, {}, {}, INERT_ACTIONS, NOW).rows[0];
  expect(row.reads.map((t) => t.name)).toEqual(["search"]);
  expect(row.writes.map((t) => t.name)).toEqual(["append_to_page", "rename"]);
  expect(isWrite({ name: "x", description: "", reversible: null, side_effects: "internal" })).toBe(false);
});

test("the seal is a sentence only while something is sealed, and busy and errors ride the row", () => {
  const rows = selectConnectors(
    [view(), view({ id: "gmail", label: "Gmail" }, { status: "disconnected", seal: "" })],
    true,
    null,
    true,
    { gmail: "connecting" },
    { notion: "Notion refused the credential with 401" },
    INERT_ACTIONS,
    NOW,
  ).rows;
  expect(rows[0].seal).toBe("sealed by Windows DPAPI");
  expect(rows[0].error).toBe("Notion refused the credential with 401");
  expect(rows[1].seal).toBe("");
  expect(rows[1].busy).toBe("connecting");
});

test("an age reads as a person says it, and an unreadable stamp is left as it came", () => {
  expect(ageOf("2026-09-12T11:59:50Z", NOW)).toBe("just now");
  expect(ageOf("2026-09-12T09:00:00Z", NOW)).toBe("3 h ago");
  expect(ageOf("2026-09-01T09:00:00Z", NOW)).toBe("11 d ago");
  expect(ageOf("yesterday", NOW)).toBe("yesterday");
  expect(ageOf("", NOW)).toBe("");
});

test("the guide splits on blank lines and keeps a URL as text", () => {
  expect(paragraphsOf("One.\nstill one.\n\n2. Open https://x.test/y\n\n\nThree.")).toEqual([
    "One. still one.",
    "2. Open https://x.test/y",
    "Three.",
  ]);
});
