/**
 * The Connectors selector: the standing is derived from the record in order of what is known,
 * the seal is a sentence only when something is sealed, and a write is what the flags say.
 */
import { expect, test } from "vitest";

import type { ConnectorView } from "@/lib/api";

import { whenAgo } from "@/lib/time";

import {
  INERT_ACTIONS,
  ageOf,
  connectorLineOf,
  isWrite,
  paragraphsOf,
  sealSentence,
  selectConnectors,
  standingOf,
  type ConnectorRow,
} from "./model";

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
    records_notice: "",
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
  expect(isWrite({ name: "x", description: "", reversible: true, side_effects: "internal" })).toBe(false);
});

test("case 6: a tool with reversible null and internal side effects is listed under writes, as HostTool.default_class gates it", () => {
  const omitted = { name: "tag_page", description: "Tag.", reversible: null, side_effects: "internal" };
  const row = selectConnectors([view({ tools: [...view().tools, omitted] })], true, null, true, {}, {}, INERT_ACTIONS, NOW).rows[0];
  expect(row.writes.map((t) => t.name)).toEqual(["append_to_page", "rename", "tag_page"]);
  expect(row.reads.map((t) => t.name)).toEqual(["search"]);
  expect(isWrite(omitted)).toBe(true);
});

// -- the line a connector card carries (ADR 0116) ----------------------------------------------------

function gmailView(conn: Partial<ConnectorView["connection"]> = {}): ConnectorView {
  return view(
    {
      id: "gmail",
      label: "Gmail",
      egress: "recipients",
      tools: [
        { name: "search_mail", description: "Search.", reversible: true, side_effects: "none" },
        { name: "send_mail", description: "Send.", reversible: false, side_effects: "external" },
      ],
    },
    { id: "gmail", identity: "mira@example.com", enabled: true, writes_enabled: true, ...conn },
  );
}

test("case 1: a connected, enabled, writable connector names the account it acts as and has no warning", () => {
  expect(connectorLineOf("connector:gmail", [gmailView()], true)).toEqual({
    app: "Gmail",
    line: "Acts as mira@example.com through Gmail.",
    warning: null,
  });
});

test("case 2: a lapsed grant, a switched-off connector or writes off each name the one cause and that approving will be refused", () => {
  const warned = (conn: Partial<ConnectorView["connection"]>) => connectorLineOf("connector:gmail", [gmailView(conn)], true)?.warning;
  expect(warned({ status: "needs_reauth" })).toEqual({
    text: "Gmail needs reconnecting, so approving now will be refused.",
    action: "accounts",
  });
  expect(warned({ enabled: false })).toEqual({
    text: "Gmail is switched off, so approving now will be refused.",
    action: "accounts",
  });
  expect(warned({ writes_enabled: false })).toEqual({
    text: "Writes are off for Gmail, so approving now will be refused.",
    action: "accounts",
  });
  // One cause, the first that stops it: a lapsed grant outranks the switches.
  expect(warned({ status: "needs_reauth", enabled: false, writes_enabled: false })?.text).toBe(
    "Gmail needs reconnecting, so approving now will be refused.",
  );
  // The writes switch governs what the daemon's service calls a write; a read it does not stop.
  expect(connectorLineOf("connector:gmail", [gmailView({ writes_enabled: false })], true, "", "connector.gmail.search_mail")?.warning).toBeNull();
  expect(connectorLineOf("connector:gmail", [gmailView({ writes_enabled: false })], true, "", "connector.gmail.send_mail")?.warning?.text).toBe(
    "Writes are off for Gmail, so approving now will be refused.",
  );
});

test("case 3: an unread list or a records notice claims no identity", () => {
  for (const line of [
    connectorLineOf("connector:gmail", [gmailView()], false),
    connectorLineOf("connector:gmail", [gmailView()], true, NOTICE_FOR_LINE),
    connectorLineOf("connector:gmail", [], false),
  ]) {
    expect(line?.app).toBe("Gmail");
    expect(line?.line).toBe("Gmail's standing could not be confirmed.");
    expect(line?.warning).toBeNull();
    expect(JSON.stringify(line)).not.toContain("mira@example.com");
  }
  expect(connectorLineOf("host:ledgerbox", [gmailView()], true)).toBeNull();
});

const NOTICE_FOR_LINE = "The connections file could not be read (JSONDecodeError), so no connection is shown.";

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
  expect(rows[0].seal).toBe(sealSentence("dpapi"));
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

test("a zone-less stamp written 20 s ago reads 'just now' in any time zone (UAT finding uat-1)", () => {
  const before = process.env.TZ;
  try {
    for (const tz of ["Europe/Prague", "America/New_York"]) {
      process.env.TZ = tz;
      const now = Date.now();
      const stamp = new Date(now - 20_000).toISOString().slice(0, 19).replace("T", " ");
      expect(ageOf(stamp, now)).toBe("just now");
      expect(whenAgo(stamp, now)).toBe("just now");
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

// -- the seal says what it guards against (item 10) -------------------------------------------------

test("each seal rung says what protects the credential, and only the keystore and DPAPI claim more than a file", () => {
  const keyring = sealSentence("keyring");
  const dpapi = sealSentence("dpapi");
  const file = sealSentence("file");
  expect(keyring).toContain("operating system's keystore");
  expect(keyring).toMatch(/must ask the keystore/);
  expect(keyring).not.toMatch(/encrypt/i);
  expect(dpapi).toContain("Windows DPAPI");
  expect(dpapi).toContain("encrypted");
  expect(dpapi).toContain("your Windows sign-in");
  expect(dpapi).toContain("readable by any program running as you");
  expect(file).toContain("a file only your user account may open");
  expect(file).toContain("it is not encrypted");
  expect(sealSentence("")).toBe("");
  for (const sentence of [keyring, dpapi, file]) expect(sentence).not.toMatch(/\bsealed\b/i);
});

// -- the records notice (item 11) --------------------------------------------------------------------

const NOTICE =
  "The connections file could not be read (JSONDecodeError), so no connection is shown. Its bytes are kept as connections.json.unreadable-20261010T120000000000Z. Connect again to start a fresh file.";

function rowsUnder(notice: string, views: ConnectorView[]): readonly ConnectorRow[] {
  return selectConnectors(views, true, null, true, {}, {}, INERT_ACTIONS, NOW, notice).rows;
}

test("while the records notice stands, no row the record calls connected reads connected", () => {
  const views = [
    view(),
    view({ id: "off" }, { enabled: false }),
    view({ id: "broken" }, { health: "broken", health_detail: "401" }),
  ];
  const model = selectConnectors(views, true, null, true, {}, {}, INERT_ACTIONS, NOW, NOTICE);
  expect(model.recordsNotice).toBe(NOTICE);
  for (const row of model.rows) {
    expect(row.standing, row.id).toBe("unconfirmed");
    expect(row.word, row.id).toBe("unconfirmed");
    expect(row.tone, row.id).toBe("warning");
    expect(row.sentence, row.id).toContain("the notice above");
    expect(row.sentence, row.id).not.toMatch(/^Connected/);
    // The record's own fact is kept, so the layer can still offer Disconnect.
    expect(row.connected, row.id).toBe(true);
  }
  expect(model.rows[0].sentence).toBe(
    "The record says connected as Test User, but that cannot be confirmed while the notice above stands.",
  );
});

test("while the records notice stands, a not-connected row says why rather than that nothing is stored", () => {
  const [row] = rowsUnder(NOTICE, [view({}, { status: "disconnected", seal: "" })]);
  expect(row.standing).toBe("not-connected");
  expect(row.sentence).toBe(
    "Shown as not connected because the connections file could not be read; see the notice above.",
  );
  expect(row.sentence).not.toContain("Nothing is");
  // Without the notice it is a plain fact, and says nothing of sealing.
  const [plain] = rowsUnder("", [view({}, { status: "disconnected", seal: "" })]);
  expect(plain.sentence).toBe("Nothing is stored for Notion.");
  expect(plain.tone).toBe("neutral");
});

test("with no notice the rows read exactly as the record says", () => {
  const [row] = rowsUnder("", [view()]);
  expect(row.standing).toBe("connected");
  expect(row.word).toBe("connected");
});

// -- a connect's own word on the layer (item 12) -----------------------------------------------------

test("the health detail is a note while connected and not broken, and never otherwise", () => {
  const detail =
    "Connected as B. The writes switch and the recipient list were set under A, so writes are off and the list was emptied.";
  const [connected, broken, gone, probed] = rowsUnder("", [
    view({}, { health_detail: detail, health: "unknown" }),
    view({ id: "b" }, { health_detail: "401", health: "broken" }),
    view({ id: "c" }, { status: "disconnected", health_detail: detail }),
    view({ id: "d" }, { health_detail: "", health: "healthy" }),
  ]);
  expect(connected.healthNote).toBe(detail);
  // The connected sentence is not the detail: the note is separate, and not an error.
  expect(connected.tone).toBe("success");
  expect(broken.healthNote).toBe("");
  expect(gone.healthNote).toBe("");
  expect(probed.healthNote).toBe("");
});

// -- a check that reached no verdict is a warning, never broken (health ADR) -------------------------

test("a healthy verdict with a newer attempt reads connected, as a warning that names the obstacle", () => {
  const obstacle = "could not reach Gmail: the provider could not be reached: TimeoutError";
  const s = standingOf(
    view(
      { id: "gmail", label: "Gmail" },
      {
        health: "healthy",
        health_at: "2026-09-12T09:00:00Z",
        attempt_at: "2026-09-12T11:55:00Z",
        attempt_detail: obstacle,
      },
    ),
    NOW,
  );
  expect(s.standing).toBe("connected");
  expect(s.tone).toBe("warning");
  expect(s.sentence).toBe(`Verified 3 h ago; could not check since 5 min ago: ${obstacle}`);
  expect(`${s.word} ${s.sentence}`).not.toMatch(/broken/);
  // An attempt older than the verdict is spent: the row reads as the verdict alone.
  const spent = standingOf(view({}, { health_at: "2026-09-12T11:59:00Z", attempt_at: "2026-09-12T11:00:00Z", attempt_detail: obstacle }), NOW);
  expect(spent.tone).toBe("success");
  expect(spent.sentence).toBe("Connected as Test User.");
});

test("the switch-reset notice is the note, and survives a probe that cleared the health detail", () => {
  const notice =
    "Connected as B. The writes switch and the recipient list were set under A, so writes are off and the list was emptied.";
  const [row] = rowsUnder("", [view({}, { notice, health_detail: "", health: "healthy" })]);
  expect(row.healthNote).toBe(notice);
  expect(row.tone).toBe("success");
});

// -- the switches wait for a connection (item 13) ----------------------------------------------------

test("the switches carry a plain reason while not connected, and none once connected", () => {
  const [connected, gone, reauth] = rowsUnder("", [
    view(),
    view({ id: "gmail", label: "Gmail" }, { status: "disconnected" }),
    view({ id: "x", label: "Gmail" }, { status: "needs_reauth" }),
  ]);
  expect(connected.disabledReason).toBe("");
  expect(gone.disabledReason).toBe("Connect Gmail first; the switches apply to the account you connect.");
  expect(reauth.disabledReason).toBe("Connect Gmail first; the switches apply to the account you connect.");
});

// -- the last probe's age, for the Accounts depth ------------------------------------------------------

test("a connected row says how long ago it was last probed, and a row that is not connected says nothing", () => {
  const [probed, never, gone] = rowsUnder("", [
    view({}, { health: "healthy", health_at: "2026-09-12T11:57:00Z" }),
    view({}, { health: "unknown", health_at: "" }),
    view({ id: "gmail", label: "Gmail" }, { status: "disconnected", health_at: "2026-09-12T11:57:00Z" }),
  ]);
  expect(probed.probedAge).toBe("3 min ago");
  expect(never.probedAge).toBe("");
  expect(gone.probedAge).toBe("");
});
