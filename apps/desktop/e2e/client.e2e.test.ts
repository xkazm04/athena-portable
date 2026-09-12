/**
 * `src/lib/api.ts` against a real daemon on a real socket — README sections 3.2 and 3.3.
 *
 * `src/lib/api.test.ts` asserts the client's *shape* against a stubbed global. This file asserts
 * the things only a real server can refuse: the token header's exact spelling, a refusal that
 * arrives as JSON the panel can render, a manifest the catalog actually merges, and the payload
 * `GET /ledger` really answers. The client is the shipped one and so is its default `fetch`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiError, DaemonApi } from "@/lib/api";

import { startDaemon, type Daemon } from "./support/daemon";
import { APP_ID, PAGE_ORIGIN, manifestBody, READ_TOOL, WRITE_TOOL } from "./support/page";

let daemon: Daemon;
let api: DaemonApi;

beforeAll(async () => {
  daemon = await startDaemon({ transcript: "e2e/transcripts/quiet.ndjson" });
  api = new DaemonApi({ url: daemon.url, token: daemon.token });
}, 180_000);

afterAll(async () => {
  await daemon?.stop();
});

describe("GET /health", () => {
  it("answers the shipped client's default fetch, over loopback, with the real body", async () => {
    const health = await api.health();

    expect(health.ok).toBe(true);
    expect(health.engine).toBe("claude_code");
    // The daemon that starts with no voice backend registers no socket at all, which is the
    // fact `stores/voice.ts` reads to decide whether the push-to-talk key does anything.
    expect(health.sockets).toEqual([]);
    expect(health.pending).toEqual({ showing: 0, total: 0, footer: "" });
  });

  it("surfaces a wrong token as an ApiError the panel can render, not a crash", async () => {
    const wrong = new DaemonApi({ url: daemon.url, token: `${daemon.token}-not` });

    const error = await wrong.health().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const refusal = error as ApiError;
    expect(refusal.status).toBe(401);
    // The one closed vocabulary, from the server. A panel that invented a word here would be a
    // second place the refusal is named.
    expect(refusal.reason).toBe("foreign_token");
    expect(refusal.message).toContain("X-Athena-Token");
  });

  it("sends the token under X-Athena-Token and nothing else carries it", async () => {
    // The header's spelling is a contract with `server.py`'s `TOKEN_HEADER`, and the only way to
    // assert it against the real server is to watch it be the thing that works.
    const bearer = await fetch(`${daemon.url}/health`, {
      headers: { Authorization: `Bearer ${daemon.token}`, "Content-Type": "application/json" },
    });
    expect(bearer.status).toBe(401);

    const named = await fetch(`${daemon.url}/health`, {
      headers: { "X-Athena-Token": daemon.token },
    });
    expect(named.status).toBe(200);
  });
});

describe("POST /manifest, from the panel's own path", () => {
  it("registers the page and the catalog names its tools with the classes it derived", async () => {
    const reply = (await api.manifest(manifestBody())) as {
      ok?: boolean;
      app_id: string;
      origin: string;
      conversation_id: string;
      tools: Array<{ name: string; class: string; origin: string; tier: number }>;
      showing: number;
      total: number;
      footer: string;
    };

    expect(reply.app_id).toBe(APP_ID);
    expect(reply.origin).toBe(PAGE_ORIGIN);
    expect(reply.conversation_id).toContain(APP_ID);
    // The page claimed `reversible: true, side_effects: internal` for one and
    // `reversible: false, side_effects: external` for the other. The catalog — not the page and
    // not this panel — turned that into a class (README section 3.3).
    const byName = new Map(reply.tools.map((t) => [t.name, t]));
    expect(byName.get(READ_TOOL)?.class).toBe("AUTO");
    expect(byName.get(WRITE_TOOL)?.class).toBe("GATED");
    expect(byName.get(WRITE_TOOL)?.origin).toBe(`host:${APP_ID}`);
    expect(byName.get(WRITE_TOOL)?.tier).toBe(1);
    // README invariant 4: every bounded block announces itself, and nothing was cut here.
    expect([reply.showing, reply.total, reply.footer]).toEqual([2, 2, ""]);
  });

  it("refuses a manifest whole, and says which checks failed", async () => {
    const bad = manifestBody();
    (bad.tools as Array<Record<string, unknown>>)[0].side_effects = "whatever-the-page-likes";

    const error = (await api.manifest(bad).catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.reason).toBe("manifest_invalid");
    // And the good manifest is still the one in the catalog: a refused manifest changes nothing.
    const again = (await api.manifest(manifestBody())) as { total: number };
    expect(again.total).toBe(2);
  });

  it("refuses a page that named no origin, because the origin is the session key", async () => {
    const error = (await api
      .manifest({ ...manifestBody(), page_origin: "" })
      .catch((e: unknown) => e)) as ApiError;

    expect(error.status).toBe(400);
    expect(error.reason).toBe("manifest_invalid");
  });
});

describe("GET /decisions and GET /ledger", () => {
  it("answers the announced-page shape the panel's views are written against", async () => {
    const decisions = await api.decisions();

    // `pending`, not `decisions`: the route answers `announced(rows, total, "pending")`, and the
    // client's own type said `decisions` until this test read the real body. A surface that had
    // polled the inbox would have rendered an empty one over a full table.
    expect(decisions.pending).toEqual([]);
    expect(decisions.ok).toBe(true);
    expect(decisions.showing).toBe(0);
    expect(decisions.total).toBe(0);
    expect(decisions.footer).toBe("");
  });

  it("answers a bounded row page whose rows carry the origin the Browser module keys by", async () => {
    // One turn, so there is a row to read. The engine is the transcript; the ledger row is real.
    const events: string[] = [];
    for await (const event of api.run({ origin: PAGE_ORIGIN, message: "what is overdue?" })) {
      events.push(event.kind);
    }
    expect(events.at(-1)).toBe("turn.finished");

    const ledger = (await api.ledger()) as {
      rows: Array<Record<string, unknown>>;
      showing: number;
      total: number;
      footer: string;
    };

    expect(ledger.showing).toBe(ledger.rows.length);
    expect(ledger.total).toBeGreaterThanOrEqual(1);
    expect(typeof ledger.footer).toBe("string");
    const row = ledger.rows[0];
    // Every field the Browser module's apps ledger and the Panel's cost line read. Named
    // explicitly, because a rename on the Python side has to be a red test here and not a blank
    // column on stage.
    expect(Object.keys(row).sort()).toEqual(
      [
        "conversation_id",
        "cost_estimated",
        "cost_usd",
        "created_at",
        "engine",
        "error_reason",
        "input_tokens",
        "is_error",
        "ms",
        "model",
        "origin",
        "output_tokens",
        "rounds",
        "row_id",
        "surface",
        "trigger",
        "turn_id",
      ].sort(),
    );
    // `origin` is `host:<app_id>` and not the web origin: that is what the catalog namespaces
    // by, and a view that grouped by `https://…` would show every app as unknown.
    expect(row.origin).toBe(`host:${APP_ID}`);
    expect(row.surface).toBe("panel");
    expect(row.is_error).toBe(false);
    expect(row.rounds).toBe(1);
  });
});
