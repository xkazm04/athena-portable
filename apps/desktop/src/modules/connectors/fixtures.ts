/**
 * The Connectors module's fixtures — view-models, no store, no shell, no daemon.
 *
 * `empty` is a daemon that answered with nothing connected. `heavy` is every card saying
 * something at once: both connected, writes on with long allow-lists, one health broken with a
 * long detail, and a consent page still open. `degraded` is the daemon not being there, which is
 * the one failure this surface has before anything else can go wrong; `unreadable` is the list
 * itself refusing. `needs-reauth` and `flow-failed` are the two moods a person meets mid-way.
 */
import type { ConnectorView } from "@/lib/api";

import { INERT_ACTIONS, selectConnectors, type ConnectorsModel } from "./model";

const NOW = Date.parse("2026-09-12T12:00:00Z");

const GMAIL_GUIDE =
  "Athena does not ship a Google client: a tool distributed as source cannot keep one secret, so you register your own once and it stays yours.\n\n1. In the Google Cloud console, create or pick a project.\n2. APIs & Services, Library: enable the Gmail API.\n3. OAuth consent screen: External, and add yourself as a test user.\n4. Credentials, Create credentials, OAuth client ID, Desktop app. Copy the client id and the client secret.\n5. Paste both here and press Connect. Your browser opens Google's consent page and the answer comes back to a loopback port that closes as soon as it is used.\n\nTo revoke: https://myaccount.google.com/permissions, or Disconnect here.";

const NOTION_GUIDE =
  "Notion connects with an internal integration token you mint yourself and paste once.\n\n1. Open https://www.notion.so/my-integrations and create a new internal integration in your workspace.\n2. Copy the internal integration secret and paste it here. It is sealed on this machine and never shown again.\n3. In Notion, open each page Athena may touch and add the integration under Connections.\n\nWriting stays off until you turn writes on and list the page ids Athena may write to.";

function connection(id: string, over: Partial<ConnectorView["connection"]> = {}): ConnectorView["connection"] {
  return {
    id,
    status: "disconnected",
    identity: "",
    connected_at: "",
    enabled: true,
    writes_enabled: false,
    allowlist: [],
    health: "unknown",
    health_at: "",
    health_detail: "",
    seal: "",
    expires_at: "",
    last_used_at: "",
    ...over,
  };
}

function gmail(over: Partial<ConnectorView> = {}): ConnectorView {
  return {
    id: "gmail",
    label: "Gmail",
    description: "Search, read and send mail on the connected Google account.",
    auth: "oauth",
    guide: GMAIL_GUIDE,
    api_hosts: ["gmail.googleapis.com"],
    egress: "recipients",
    tools: [
      { name: "search_mail", description: "Search the connected mailbox; returns sender, subject, date and a snippet per message.", reversible: true, side_effects: "none" },
      { name: "read_mail", description: "Read one message by id; returns its headers and plain-text body.", reversible: true, side_effects: "none" },
      { name: "send_mail", description: "Send a mail from the connected account to allowed recipients.", reversible: false, side_effects: "external" },
    ],
    connection: connection("gmail"),
    live: false,
    seal_available: true,
    flow: null,
    ...over,
  };
}

function notion(over: Partial<ConnectorView> = {}): ConnectorView {
  return {
    id: "notion",
    label: "Notion",
    description: "Search, read, append to and create pages in the connected Notion workspace.",
    auth: "token",
    guide: NOTION_GUIDE,
    api_hosts: ["api.notion.com"],
    egress: "resources",
    tools: [
      { name: "search", description: "Search the connected Notion workspace for pages and databases.", reversible: true, side_effects: "none" },
      { name: "read_page", description: "Read one Notion page as plain text.", reversible: true, side_effects: "none" },
      { name: "append_to_page", description: "Append paragraphs to an allowed Notion page.", reversible: false, side_effects: "external" },
      { name: "create_page", description: "Create a page under an allowed Notion parent page.", reversible: false, side_effects: "external" },
    ],
    connection: connection("notion"),
    live: false,
    seal_available: true,
    flow: null,
    ...over,
  };
}

const NOTION_CONNECTED = notion({
  live: true,
  connection: connection("notion", {
    status: "connected",
    identity: "Studio workspace",
    connected_at: "2026-09-12T10:12:00Z",
    health: "healthy",
    health_at: "2026-09-12T10:12:00Z",
    seal: "dpapi",
  }),
});

function model(
  items: ConnectorView[],
  over: { loaded?: boolean; problem?: string | null; ready?: boolean; busy?: Record<string, string>; errors?: Record<string, string> } = {},
): ConnectorsModel {
  return selectConnectors(
    items,
    over.loaded ?? true,
    over.problem ?? null,
    over.ready ?? true,
    over.busy ?? {},
    over.errors ?? {},
    INERT_ACTIONS,
    NOW,
  );
}

const empty = model([gmail(), notion()]);

const typical = model([gmail(), NOTION_CONNECTED]);

const heavy = model(
  [
    gmail({
      live: true,
      connection: connection("gmail", {
        status: "connected",
        identity: "a-very-long-account-name-for-the-studio@example-domain-with-a-long-name.test",
        connected_at: "2026-09-11T08:00:00Z",
        writes_enabled: true,
        allowlist: [
          "ap@northwind.example",
          "billing@contoso.example",
          "accounts.payable@a-client-with-a-very-long-domain-name.example",
          "ops@fabrikam.example",
          "hello@example.test",
        ],
        health: "broken",
        health_at: "2026-09-12T11:41:00Z",
        health_detail:
          "Gmail refused the credential with 401: the grant was revoked from the account's permissions page, or the consent screen's test user list no longer names this account",
        seal: "keyring",
      }),
      flow: {
        id: "flow_9f2a",
        connector: "gmail",
        phase: "awaiting_consent",
        detail: "waiting for the browser",
        authorize_url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=example",
      },
    }),
    notion({
      live: true,
      connection: connection("notion", {
        status: "connected",
        identity: "Studio workspace",
        connected_at: "2026-09-12T10:12:00Z",
        writes_enabled: true,
        allowlist: ["0123456789abcdef0123456789abcdef", "fedcba9876543210fedcba9876543210", "11111111222222223333333344444444"],
        health: "healthy",
        health_at: "2026-09-12T11:58:00Z",
        seal: "file",
        last_used_at: "2026-09-12T11:59:00Z",
      }),
    }),
  ],
  { busy: { notion: "saving" } },
);

/** The daemon is not there, so nothing here can be asked. */
const degraded = model([], { loaded: false, ready: false });

/** The list itself refused. Verbatim, and not an empty list. */
const unreadable = model([], { problem: "unknown_ref: no route for GET /connectors" });

const needsReauth = model([
  gmail({
    connection: connection("gmail", {
      status: "needs_reauth",
      identity: "me@example.test",
      connected_at: "2026-09-01T08:00:00Z",
      health: "broken",
      health_at: "2026-09-12T11:30:00Z",
      health_detail: "Gmail needs to be reconnected in Connectors",
      seal: "dpapi",
    }),
  }),
  NOTION_CONNECTED,
]);

const flowFailed = model(
  [
    gmail({
      flow: {
        id: "flow_1c3d",
        connector: "gmail",
        phase: "failed",
        detail: "the provider refused: access_denied",
        authorize_url: "",
      },
    }),
    notion(),
  ],
  { errors: { notion: "Notion refused the credential with 401" } },
);

export const fixtures: Record<string, ConnectorsModel> = {
  empty,
  typical,
  heavy,
  degraded,
  unreadable,
  "needs-reauth": needsReauth,
  "flow-failed": flowFailed,
};

export const fixtureIds = ["empty", "typical", "heavy", "degraded", "unreadable", "needs-reauth", "flow-failed"] as const;
