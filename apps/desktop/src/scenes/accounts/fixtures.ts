/**
 * The Accounts depth's fixtures — README sections 3.5 and 4.
 *
 * The Connectors module's own view-models are reused as they are (its tests keep guarding the
 * selector); the only additions are states the module's single-layer view could not show as a
 * place: a consent page open on an account that is not yet connected, a refusal on a switched-off
 * account. `PLACES` is what the module expressed as `initialOpenFor`, now as depth paths: each
 * names a fixture and where in the depth to stand, so a test (and a person with
 * `preview.html?scene=accounts&fixture=..&at=..`) can reach every state. Invented demo content, no
 * store, no daemon.
 */
import type { Path } from "@/depth/model";
import {
  fixtures as moduleFixtures,
  connection,
  gmail,
  model,
  notion,
} from "@/modules/connectors/fixtures";
import type { ConnectorsModel } from "@/modules/connectors/model";

const consenting = model([
  gmail({
    flow: {
      id: "flow_77aa",
      connector: "gmail",
      phase: "awaiting_consent",
      detail: "waiting for the browser",
      authorize_url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=example",
    },
  }),
  notion(),
]);

const exchanging = model([
  gmail({
    flow: { id: "flow_77ab", connector: "gmail", phase: "exchanging", detail: "trading the code for a grant", authorize_url: "" },
  }),
  notion(),
]);

/** A connected, switched-off account with a refusal on it, and one mid-connect: the per-row words. */
const refused = model(
  [
    gmail({
      live: true,
      connection: connection("gmail", {
        status: "connected",
        identity: "me@example.test",
        enabled: false,
        writes_enabled: true,
        allowlist: ["ap@northwind.example"],
        health: "healthy",
        health_at: "2026-09-12T11:50:00Z",
        seal: "keyring",
      }),
    }),
    notion(),
  ],
  { errors: { gmail: "recipient is not an address: ap@" }, busy: { notion: "connecting" } },
);

export const fixtures: Record<string, ConnectorsModel> = {
  // `typical` first: it is the fixture the perf gate's bare `?scene=accounts` draws.
  typical: moduleFixtures.typical!,
  empty: moduleFixtures.empty!,
  heavy: moduleFixtures.heavy!,
  degraded: moduleFixtures.degraded!,
  unreadable: moduleFixtures.unreadable!,
  unreachable: moduleFixtures.unreachable!,
  "needs-reauth": moduleFixtures["needs-reauth"]!,
  "flow-failed": moduleFixtures["flow-failed"]!,
  "records-unreadable": moduleFixtures["records-unreadable"]!,
  reconnected: moduleFixtures["open-reconnected"]!,
  consenting,
  exchanging,
  refused,
};

export const fixtureIds: readonly string[] = Object.keys(fixtures);

const at = (item: string, sub?: "allowlist"): Path =>
  sub ? { root: "accounts", item, sub: { kind: sub } } : { root: "accounts", item };

/** The open states of the module's old layer, and the allow-list, as places in the depth. */
export const PLACES: Readonly<Record<string, { fixture: string; path: Path }>> = {
  "open-notion": { fixture: "typical", path: at("notion") },
  "open-gmail": { fixture: "typical", path: at("gmail") },
  "open-reauth": { fixture: "needs-reauth", path: at("gmail") },
  "open-flow-failed": { fixture: "flow-failed", path: at("gmail") },
  "open-records-unreadable": { fixture: "records-unreadable", path: at("notion") },
  "open-reconnected": { fixture: "reconnected", path: at("gmail") },
  "open-consenting": { fixture: "consenting", path: at("gmail") },
  "open-exchanging": { fixture: "exchanging", path: at("gmail") },
  "open-refused": { fixture: "refused", path: at("gmail") },
  "open-heavy-gmail": { fixture: "heavy", path: at("gmail") },
  "open-heavy-notion": { fixture: "heavy", path: at("notion") },
  "allowlist-notion": { fixture: "heavy", path: at("notion", "allowlist") },
  "allowlist-gmail-locked": { fixture: "typical", path: at("gmail", "allowlist") },
  "allowlist-empty": { fixture: "typical", path: at("notion", "allowlist") },
  "unknown-account": { fixture: "typical", path: at("slack") },
};
