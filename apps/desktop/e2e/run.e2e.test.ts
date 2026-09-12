/**
 * `src/stores/run.ts` against a real daemon, over real SSE — README section 3.2, ADR 0010.
 *
 * `src/stores/run.test.ts` already drives this loop against a fake daemon, and it must not be cut:
 * it is fast, hermetic, and covers the loop's own decisions. This file exists for the things a
 * fake cannot be wrong about:
 *
 *  - the **frame order the harness really emits**. A gated proposal arrives as
 *    `tool.call`, then `decision.requested`, then `tool.result(error=pending_approval)` — the card
 *    *before* the refusal. The held-call rule (commit 0a8f383) has to survive that order against
 *    the real stream and not against a stream a test wrote to suit it;
 *  - the **real `POST /decisions/<id>` reply**, whose `execute` array is what the panel runs on the
 *    page and the only thing it may run;
 *  - the **manifest step**, which no fake daemon can require, and whose absence made every turn
 *    the shipped panel could send a `403 foreign_origin`;
 *  - the **parser on real bytes**, including a frame cut across two reads.
 *
 * Every daemon here is its own process on its own ephemeral port with its own scratch
 * `ATHENA_HOME`, and every one is stopped in `afterEach` whether the test passed or not.
 */
import { afterEach, describe, expect, it } from "vitest";

import { DaemonApi, sseFrames } from "@/lib/api";
import { resetRunForTests, useRun, setRunDeps, type RunDeps } from "@/stores/run";

import { startDaemon, type Daemon } from "./support/daemon";
import {
  APP_ID,
  PAGE_ORIGIN,
  fakePage,
  manifestBody,
  READ_TOOL,
  WRITE_TOOL,
  type FakePage,
} from "./support/page";
import { recorder, rechunking, streamOf, type Recorder } from "./support/wire";

interface Live {
  daemon: Daemon;
  page: FakePage;
  wire: Recorder;
}

let running: Daemon | null = null;

/**
 * One daemon, one fake page, and the run loop wired to both.
 *
 * The only things faked are the three the surface owns: which tab is focused, what the host state
 * is, and what happens when the page is asked to run something. `api` is the real client against
 * the real socket, and `manifest` is the shell's own manifest builder.
 */
async function live(
  transcript: string,
  options: { answers?: Record<string, string>; chunk?: number } = {},
): Promise<Live> {
  const daemon = await startDaemon({ transcript: `e2e/transcripts/${transcript}` });
  running = daemon;
  const page = fakePage(options.answers ?? { list_overdue: "INV-118, INV-120, INV-131", pay: "paid" });
  const wire = recorder();
  const fetchImpl = options.chunk ? rechunking(options.chunk, wire.fetchImpl) : wire.fetchImpl;
  const deps: RunDeps = {
    api: () => new DaemonApi({ url: daemon.url, token: daemon.token }, fetchImpl),
    focused: () => ({ tabId: 7, origin: PAGE_ORIGIN, appId: APP_ID }),
    hostState: () => ({ page_url: `${PAGE_ORIGIN}/invoices`, page_title: "Ledgerbox", tabs: [] }),
    call: page.call,
    manifest: () => manifestBody(),
  };
  setRunDeps(deps);
  return { daemon, page, wire };
}

afterEach(async () => {
  resetRunForTests();
  const daemon = running;
  running = null;
  await daemon?.stop();
});

/** Every `/ledger` row, newest first, off the same client the panel uses. */
async function ledgerRows(daemon: Daemon): Promise<Array<Record<string, unknown>>> {
  const page = (await new DaemonApi({ url: daemon.url, token: daemon.token }).ledger()) as {
    rows: Array<Record<string, unknown>>;
  };
  return page.rows;
}

// -- the AUTO turn -------------------------------------------------------------------------------

describe("a whole AUTO turn", () => {
  it("registers the page, streams the real turn, runs the host call and carries the answer back", async () => {
    const { daemon, page, wire } = await live("auto-turn.ndjson");

    await useRun.getState().send("what is overdue?");

    const state = useRun.getState();
    expect(state.error).toBeNull();
    expect(state.phase).toBe("idle");

    // 1. The manifest went first. Without it `/run` is `403 foreign_origin` and nothing else in
    //    this test could have happened — which is exactly what the shipped panel did.
    expect(wire.to("/manifest")).toHaveLength(1);
    expect(wire.to("/manifest")[0].status).toBe(200);
    expect(wire.to("/manifest")[0].body?.app_id).toBe(APP_ID);

    // 2. The page ran the AUTO tool once, with the parameters off the stream, under its bare name.
    expect(page.names()).toEqual(["list_overdue"]);
    expect(page.calls[0].tabId).toBe(7);

    // 3. Two requests: the turn, and the continuation the page's answer made necessary.
    const runs = wire.to("/run");
    expect(runs).toHaveLength(2);
    expect(runs[0].body?.tool_results).toEqual([]);
    expect(runs[0].body?.origin).toBe(PAGE_ORIGIN);
    expect(runs[0].body?.surface).toBe("panel");
    expect(runs[0].body?.host_state).toMatchObject({ page_title: "Ledgerbox" });

    // 4. The carry: the second request's `tool_results` is the page's own answer, under the
    //    call id the daemon minted. This is README section 3.2 step 5 on the wire.
    const carried = runs[1].body?.tool_results as Array<Record<string, unknown>>;
    expect(carried).toHaveLength(1);
    expect(carried[0].name).toBe(READ_TOOL);
    expect(carried[0].ok).toBe(true);
    expect(carried[0].output).toBe("INV-118, INV-120, INV-131");
    expect(carried[0].tier).toBe(1);
    // The call id is minted by the harness as `<turn id>_<index>`, so the answer the panel
    // carries back is provably the answer to the call the daemon made.
    expect(String(carried[0].call_id)).toMatch(/^turn_[0-9a-f]{12}_\d\d$/);

    // 5. Both rounds are in the transcript the panel renders, and the tool line between them.
    const said = state.transcript.map((e) => `${e.kind}:${e.text.trim()}`);
    expect(said[0]).toBe("user:what is overdue?");
    expect(said[1]).toContain("Three invoices are past thirty days.");
    expect(said[2]).toBe(`tool:${READ_TOOL} → INV-118, INV-120, INV-131`);
    expect(said[3]).toContain("INV-118, INV-120 and INV-131 are the three.");

    // 6. The summary is the ledger's own row, not a number the panel made up.
    expect(state.summary?.engine).toBe("claude_code");
    expect(state.summary?.rounds).toBe(1);
    expect(state.summary?.cost_usd).toBeCloseTo(0.0123, 6);
    const rows = await ledgerRows(daemon);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.is_error === false)).toBe(true);
    expect(rows.every((r) => r.rounds === 1)).toBe(true);
  });

  it("reassembles a frame cut across two reads, byte by byte, into the same events", async () => {
    // One byte per chunk: every frame, and every line inside it, is split. The bytes are the
    // daemon's own; only the read boundaries are pathological.
    const { page, wire } = await live("auto-turn.ndjson", { chunk: 1 });

    await useRun.getState().send("what is overdue?");

    expect(useRun.getState().error).toBeNull();
    expect(page.names()).toEqual(["list_overdue"]);
    expect(wire.to("/run")).toHaveLength(2);
    expect(useRun.getState().summary?.rounds).toBe(1);
    const said = useRun.getState().transcript.map((e) => e.kind);
    expect(said).toEqual(["user", "assistant", "tool", "assistant"]);
  });

  it("refuses a tool the page never published, and the page is not asked", async () => {
    // The other half of "the capability block names its tools": a name that is not in the
    // catalog is refused by the gate with the one word for it, and never reaches the surface.
    const { page } = await live("unknown-tool.ndjson");

    await useRun.getState().send("archive INV-118");

    expect(page.names()).toEqual([]);
    const lines = useRun.getState().transcript.filter((e) => e.kind === "tool");
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain("unknown_ref");
    expect(lines[0].ok).toBe(false);
  });
});

// -- the GATED turn ------------------------------------------------------------------------------

describe("a GATED turn", () => {
  it("does not touch the page before the approval, then runs it once and only once", async () => {
    const { daemon, page, wire } = await live("gated-approve.ndjson");

    await useRun.getState().send("pay INV-118");

    // THE CLAIM. The turn has ended, the daemon emitted `tool.call` for the gated action before
    // it emitted the card, and the page has not been touched.
    expect(page.calls).toEqual([]);
    expect(useRun.getState().phase).toBe("idle");
    expect(wire.to("/run")).toHaveLength(1);

    const cards = useRun.getState().cards;
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.action).toBe(WRITE_TOOL);
    expect(card.params).toEqual({ invoice: "INV-118" });
    expect(card.rationale).toBe("the invoice the user named");
    expect(card.origin).toBe(`host:${APP_ID}`);
    expect(card.options.map((o) => o.id)).toEqual(["approve", "decline"]);
    expect(card.id).toMatch(/^apr_[0-9a-f]{12}$/);

    // The refusal the same turn carried, in the panel's transcript, in the gate's own word.
    const refusal = useRun.getState().transcript.find((e) => e.kind === "tool");
    expect(refusal?.text).toContain("pending_approval");

    // The row outlives the turn, which is what makes the card answerable at all.
    const pending = await new DaemonApi({ url: daemon.url, token: daemon.token }).decisions();
    expect(pending.total).toBe(1);

    // -- the answer --------------------------------------------------------------------------
    await useRun.getState().answer(card.id, "approve");

    // Only now, and exactly once, with the parameters off the approval row.
    expect(page.names()).toEqual(["pay"]);
    expect(page.calls[0].input).toEqual({ invoice: "INV-118" });
    expect(useRun.getState().cards).toEqual([]);

    const decided = wire.to(`/decisions/${card.id}`);
    expect(decided).toHaveLength(1);
    expect(decided[0].body).toEqual({ choice: "approve", origin: PAGE_ORIGIN, answer: undefined });

    // The continuation carried the page's answer back, so the turn could finish.
    const runs = wire.to("/run");
    expect(runs).toHaveLength(2);
    const carried = runs[1].body?.tool_results as Array<Record<string, unknown>>;
    expect(carried).toHaveLength(1);
    expect(carried[0].name).toBe(WRITE_TOOL);
    expect(carried[0].ok).toBe(true);
    expect(carried[0].output).toBe("paid");
    expect(useRun.getState().transcript.at(-1)?.text).toContain("INV-118 is paid.");
  });

  it("leaves the page untouched on a decline, and the ledger says user_denied", async () => {
    const { daemon, page, wire } = await live("gated-decline.ndjson");

    await useRun.getState().send("pay INV-118");
    const card = useRun.getState().cards[0];
    expect(card).toBeDefined();

    await useRun.getState().answer(card.id, "decline");

    // Nothing ran, anywhere: not on the page, and not as a second turn.
    expect(page.calls).toEqual([]);
    expect(wire.to("/run")).toHaveLength(1);
    expect(useRun.getState().cards).toEqual([]);
    expect(useRun.getState().transcript.at(-1)).toMatchObject({
      kind: "tool",
      ok: false,
      text: `declined: ${card.id}`,
    });

    // README invariant 6: one row per invocation, failures included, with a reason from the
    // closed set. A decline invoked no model, so its row says so — `rounds: 0`.
    const rows = await ledgerRows(daemon);
    const denied = rows.filter((r) => r.error_reason === "user_denied");
    expect(denied).toHaveLength(1);
    expect(denied[0].is_error).toBe(true);
    expect(denied[0].rounds).toBe(0);
    expect(denied[0].origin).toBe(`host:${APP_ID}`);
    expect(denied[0].surface).toBe("panel");
  });

  it("refuses to answer a card from a page that is not the focused one", async () => {
    const { page } = await live("gated-decline.ndjson");

    await useRun.getState().send("pay INV-118");
    const card = useRun.getState().cards[0];

    // The surface states an origin the daemon has no session for. `POST /decisions/<id>` refuses
    // it with the gate's own word rather than replaying the grant.
    setRunDeps({
      ...({
        api: () => new DaemonApi({ url: running!.url, token: running!.token }),
        focused: () => ({ tabId: 9, origin: "https://not-ledgerbox.e2e", appId: "crm" }),
        hostState: () => ({}),
        call: page.call,
        manifest: () => null,
      } satisfies RunDeps),
    });

    await useRun.getState().answer(card.id, "approve");

    expect(page.calls).toEqual([]);
    expect(useRun.getState().error?.reason).toBe("foreign_origin");
  });
});

// -- the parser itself ---------------------------------------------------------------------------

describe("the hand-rolled SSE parser", () => {
  /** `sseFrames` over one body, as a list of `data:` payloads. */
  async function framesOf(text: string, chunk = text.length): Promise<string[]> {
    const out: string[] = [];
    for await (const frame of sseFrames(streamOf(text, chunk))) out.push(frame);
    return out;
  }

  it("joins a frame's several data: lines with a newline, as the spec says", async () => {
    // The daemon writes one `data:` line per frame, so this shape never comes off it. The spec
    // allows it, the parser's own docstring promises it, and a turn text carrying a newline is
    // one plausible day away — so it is asserted here rather than assumed.
    const frames = await framesOf(
      'event: text.delta\ndata: {"kind":"text.delta",\ndata:  "text":"two lines"}\n\n',
    );
    expect(frames).toEqual(['{"kind":"text.delta",\n "text":"two lines"}']);
  });

  it("frames a stream that uses CRLF line endings, which the spec also allows", async () => {
    const frames = await framesOf(
      'event: turn.finished\r\ndata: {"kind":"turn.finished","text":"done","tts":null}\r\n\r\n',
    );
    expect(frames).toEqual(['{"kind":"turn.finished","text":"done","tts":null}']);
  });

  it("keeps CRLF frames apart, which is where the old boundary search fell over", async () => {
    // The one-frame case above parsed by luck: `JSON.parse` tolerates the trailing CR. Two
    // frames is where a boundary search for LF-LF alone finds nothing, buffers the whole stream
    // into one payload, and throws part-way through the first turn.
    const frames = await framesOf(
      'event: a\r\ndata: {"kind":"a"}\r\n\r\nevent: b\r\ndata: {"kind":"b"}\r\n\r\n',
      3,
    );
    expect(frames).toEqual(['{"kind":"a"}', '{"kind":"b"}']);
    expect(frames.map((f) => JSON.parse(f) as { kind: string })).toEqual([
      { kind: "a" },
      { kind: "b" },
    ]);
  });

  it("frames a stream terminated with a bare CR, the third terminator the grammar allows", async () => {
    const frames = await framesOf(
      'event: a\rdata: {"kind":"a"}\r\revent: b\rdata: {"kind":"b"}\r\r',
    );
    expect(frames).toEqual(['{"kind":"a"}', '{"kind":"b"}']);
  });

  it("yields a last frame that the body ended without a blank line after", async () => {
    const frames = await framesOf('event: x\ndata: {"kind":"x"}');
    expect(frames).toEqual(['{"kind":"x"}']);
  });

  it("skips a comment frame and a retry field rather than yielding them as events", async () => {
    const frames = await framesOf(': keep-alive\n\nretry: 1000\n\ndata: {"kind":"x"}\n\n');
    expect(frames).toEqual(['{"kind":"x"}']);
  });

  it("reassembles across chunk boundaries wherever they fall", async () => {
    const body =
      'event: a\ndata: {"kind":"a","text":"one"}\n\nevent: b\ndata: {"kind":"b","text":"two"}\n\n';
    for (const size of [1, 2, 3, 7, 13, 40]) {
      expect(await framesOf(body, size)).toEqual([
        '{"kind":"a","text":"one"}',
        '{"kind":"b","text":"two"}',
      ]);
    }
  });
});
