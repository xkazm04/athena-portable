/**
 * The headless run-loop test (README §3.5, and on §5's never-cut list).
 *
 * The first build had "no automation seam for the panel": the only way to see the run loop do
 * anything was to launch the shell, start a daemon, open a page and drive it by hand. So the states
 * that mattered most — a card arriving mid-turn, a page answering, a refusal — were the ones nobody
 * ever exercised twice the same way.
 *
 * This drives the real `RunLoop` against a fake daemon and a fake page. No Tauri, no window, no
 * HTTP and no provider: the fake daemon answers `fetch` with the same SSE frames the real one
 * writes, so the client's own parser is under test too.
 *
 * It runs against `dist/`, which is what the shell loads. Testing the compiled output rather than
 * the sources is deliberate: a panel that type-checks and does not run is the failure this is for.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { DaemonClient } from "../dist/lib/client.js";
import { MAX_CONTINUATIONS, RunLoop } from "../dist/stores/run.js";

// --- the fakes -----------------------------------------------------------------------------------

/** One SSE body, framed exactly as `athena.daemon.server` writes it. */
function sse(events) {
  const body = events.map((event) => `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      // One chunk per frame, so the client's buffering across chunk boundaries is exercised.
      for (const frame of body) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A daemon that answers from a script.
 *
 * `runs` is a list of turns; each request to `/run` takes the next one. The requests are recorded,
 * because what the loop *sends* is half of what is being tested — a continuation that forgot to
 * carry the page's answers would still produce a plausible transcript.
 */
function fakeDaemon({ runs = [], capabilities = [], resolutions = {} } = {}) {
  const requests = [];
  let turn = 0;

  const fetchImpl = async (url, init = {}) => {
    const path = url.replace("http://daemon", "");
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ path, method: init.method ?? "GET", body });

    if (path.startsWith("/capabilities")) {
      return jsonResponse({ app_id: null, tools: capabilities, total: capabilities.length });
    }
    if (path.startsWith("/decisions/")) {
      const id = decodeURIComponent(path.slice("/decisions/".length));
      const answer = resolutions[id];
      if (!answer) return jsonResponse({ error: "unknown_ref", detail: id }, 404);
      return jsonResponse(answer);
    }
    if (path === "/run") {
      const script = runs[turn];
      turn += 1;
      if (!script) return jsonResponse({ error: "unknown", detail: "the script ran out" }, 500);
      if (script.refuse) return jsonResponse(script.refuse, script.status ?? 409);
      return new Response(sse(script), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    return jsonResponse({ error: "unknown_ref", detail: path }, 404);
  };

  return { fetchImpl, requests };
}

/** A page that answers `call` from a table and records what it was asked. */
function fakePage(answers = {}) {
  const calls = [];
  return {
    calls,
    port: {
      async state() {
        return { active_app: "ledgerbox", page_title: "Invoices" };
      },
      async call(name, params) {
        calls.push({ name, params });
        return answers[name] ?? { ok: true, output: `${name} ran` };
      },
    },
  };
}

function loopOver(daemon, page) {
  return new RunLoop(new DaemonClient({ url: "http://daemon", token: "t" }, daemon.fetchImpl), page.port);
}

const finished = (text) => ({ kind: "turn.finished", text, tts: null });
const said = (text) => ({ kind: "text.delta", text });
const summary = () => ({
  kind: "turn.summary",
  model: "claude-opus-5",
  engine: "claude_code",
  input_tokens: 100,
  output_tokens: 20,
  cost_usd: 0.002,
  cost_estimated: false,
  duration_ms: 900,
  rounds: 1,
});

// --- one plain turn ------------------------------------------------------------------------------

test("a turn puts the message, the answer and the cost on the panel", async () => {
  const daemon = fakeDaemon({ runs: [[said("Three are late."), summary(), finished("Three are late.")]] });
  const page = fakePage();
  const loop = loopOver(daemon, page);

  await loop.send("Which invoices are late?");
  const model = loop.snapshot;

  assert.equal(model.phase, "idle");
  assert.deepEqual(
    model.transcript.map((entry) => [entry.kind, entry.text]),
    [
      ["user", "Which invoices are late?"],
      ["assistant", "Three are late."],
    ],
  );
  assert.equal(model.summary.cost_usd, 0.002);
  assert.equal(daemon.requests.filter((r) => r.path === "/run").length, 1);
});

test("the turn carries the host state the shell reported", async () => {
  const daemon = fakeDaemon({ runs: [[finished("ok")]] });
  const loop = loopOver(daemon, fakePage());

  await loop.send("hello");

  const run = daemon.requests.find((r) => r.path === "/run");
  assert.equal(run.body.host_state.active_app, "ledgerbox");
  assert.equal(run.body.surface, "panel");
});

// --- the loop, which is the point ------------------------------------------------------------------

test("a host tool is run on the page and its answer rides the next request", async () => {
  // README §3.2 step 5: the lane holds no executor for a host tool, so the surface runs it and the
  // answer arrives in the *next* frame. Without this continuation the model never learns anything.
  const daemon = fakeDaemon({
    runs: [
      [
        { kind: "tool.call", call_id: "c1", name: "host.ledgerbox.list_overdue", params: {}, origin: "host:ledgerbox", tier: 1 },
        finished(""),
      ],
      [said("Three: INV-118, INV-120, INV-131."), finished("Three.")],
    ],
  });
  const page = fakePage({
    "host.ledgerbox.list_overdue": { ok: true, output: "INV-118, INV-120, INV-131" },
  });
  const loop = loopOver(daemon, page);

  await loop.send("Which invoices are late?");

  assert.deepEqual(page.calls, [{ name: "host.ledgerbox.list_overdue", params: {} }]);
  const runs = daemon.requests.filter((r) => r.path === "/run");
  assert.equal(runs.length, 2, "the loop must continue the turn once the page answered");
  assert.deepEqual(runs[0].body.tool_results, []);
  assert.equal(runs[1].body.tool_results[0].output, "INV-118, INV-120, INV-131");
  assert.equal(runs[1].body.tool_results[0].call_id, "c1");
  assert.equal(loop.snapshot.phase, "idle");
});

test("a tool that throws on the page is carried back as a failure, not as silence", async () => {
  const daemon = fakeDaemon({
    runs: [
      [{ kind: "tool.call", call_id: "c1", name: "host.ledgerbox.chase", params: {}, origin: "host:ledgerbox", tier: 1 }, finished("")],
      [finished("I could not send it.")],
    ],
  });
  const page = {
    calls: [],
    port: {
      async state() {
        return {};
      },
      async call() {
        throw new Error("the page is gone");
      },
    },
  };
  const loop = loopOver(daemon, page);

  await loop.send("chase it");

  const runs = daemon.requests.filter((r) => r.path === "/run");
  assert.equal(runs[1].body.tool_results[0].ok, false);
  assert.equal(runs[1].body.tool_results[0].error, "the page is gone");
});

test("a core tool's result is not run on the page", async () => {
  // Tier 0 has an executor in the daemon. A surface that also ran it would run it twice.
  const daemon = fakeDaemon({
    runs: [
      [
        { kind: "tool.call", call_id: "c1", name: "core.recall", params: {}, origin: "core", tier: 0 },
        { kind: "tool.result", call_id: "c1", name: "core.recall", ok: true, output: "two facts", truncated: false, error: null, tier: 0, ms: 3 },
        finished("ok"),
      ],
    ],
  });
  const page = fakePage();
  const loop = loopOver(daemon, page);

  await loop.send("what do you know?");

  assert.deepEqual(page.calls, []);
  assert.equal(daemon.requests.filter((r) => r.path === "/run").length, 1);
});

test("the loop stops continuing after its bound rather than running forever", async () => {
  const call = {
    kind: "tool.call",
    call_id: "c",
    name: "host.ledgerbox.list_overdue",
    params: {},
    origin: "host:ledgerbox",
    tier: 1,
  };
  const runs = Array.from({ length: MAX_CONTINUATIONS + 4 }, () => [call, finished("")]);
  const daemon = fakeDaemon({ runs });
  const loop = loopOver(daemon, fakePage());

  await loop.send("go");

  assert.equal(loop.snapshot.phase, "error");
  assert.equal(loop.snapshot.error.reason, "budget_exhausted");
  assert.equal(daemon.requests.filter((r) => r.path === "/run").length, MAX_CONTINUATIONS + 1);
});

// --- the card ------------------------------------------------------------------------------------

test("a card arrives mid-turn and waits on the user", async () => {
  const card = {
    kind: "decision.requested",
    id: "apr_0000000000a1",
    decision_kind: "approve",
    action: "host.ledgerbox.chase",
    params: { invoice: "INV-118" },
    rationale: "41 days late",
    options: [{ id: "approve", label: "approve" }, { id: "decline", label: "decline" }],
    expires_at: "",
    origin: "host:ledgerbox",
    surface: "panel",
    capture_id: null,
  };
  const daemon = fakeDaemon({ runs: [[card, finished("I need your approval.")]] });
  const loop = loopOver(daemon, fakePage());

  await loop.send("chase the oldest");

  assert.equal(loop.snapshot.cards.length, 1);
  assert.equal(loop.snapshot.cards[0].params.invoice, "INV-118");
  assert.equal(loop.snapshot.phase, "idle");
});

test("approving a host card runs the instruction on the page and continues the turn", async () => {
  // README §3.2 step 6: the daemon replays the gate and hands back an instruction, not a result.
  const daemon = fakeDaemon({
    runs: [[finished("waiting")], [finished("Sent.")]],
    resolutions: {
      apr_0000000000a1: {
        approved: true,
        reason: null,
        events: [
          { kind: "decision.resolved", id: "apr_0000000000a1", choice: "approve", by: "user", at: "" },
          {
            kind: "tool.call",
            call_id: "apr_0000000000a1_exec",
            name: "host.ledgerbox.chase",
            params: { invoice: "INV-118" },
            origin: "host:ledgerbox",
            tier: 1,
          },
        ],
      },
    },
  });
  const page = fakePage({ "host.ledgerbox.chase": { ok: true, output: "sent to INV-118" } });
  const loop = loopOver(daemon, page);

  await loop.answer("apr_0000000000a1", "approve");

  assert.deepEqual(page.calls, [{ name: "host.ledgerbox.chase", params: { invoice: "INV-118" } }]);
  const runs = daemon.requests.filter((r) => r.path === "/run");
  assert.equal(runs.length, 1, "the page's answer must reach the model");
  assert.equal(runs[0].body.tool_results[0].output, "sent to INV-118");
});

test("declining a card runs nothing on the page and starts no turn", async () => {
  const daemon = fakeDaemon({
    resolutions: {
      apr_0000000000a1: {
        approved: false,
        reason: "user_denied",
        events: [{ kind: "decision.resolved", id: "apr_0000000000a1", choice: "decline", by: "user", at: "" }],
      },
    },
  });
  const page = fakePage();
  const loop = loopOver(daemon, page);

  await loop.answer("apr_0000000000a1", "decline");

  assert.deepEqual(page.calls, []);
  assert.equal(daemon.requests.filter((r) => r.path === "/run").length, 0);
  assert.ok(loop.snapshot.transcript.some((entry) => entry.text.includes("declined")));
});

test("answering a card removes it from the panel before the daemon replies", async () => {
  // Otherwise a slow resolve leaves a card the user can press twice, and the second press is a
  // second answer to a decision that has already been made.
  const daemon = fakeDaemon({ resolutions: {} });
  const loop = loopOver(daemon, fakePage());
  loop.snapshot.cards.push({ id: "apr_0000000000a1" });

  await loop.answer("apr_0000000000a1", "approve");

  assert.deepEqual(loop.snapshot.cards, []);
});

// --- refusals ------------------------------------------------------------------------------------

test("a refused request becomes an error with the daemon's own reason", async () => {
  const daemon = fakeDaemon({
    runs: [{ refuse: { error: "foreign_origin", detail: "bound elsewhere" }, status: 409 }],
  });
  const loop = loopOver(daemon, fakePage());

  await loop.send("go");

  assert.equal(loop.snapshot.phase, "error");
  assert.equal(loop.snapshot.error.reason, "foreign_origin");
  assert.equal(loop.snapshot.error.detail, "bound elsewhere");
});

test("a turn error on the stream is rendered rather than thrown away", async () => {
  const daemon = fakeDaemon({
    runs: [[{ kind: "turn.error", reason: "engine_error", detail: "the CLI stopped" }]],
  });
  const loop = loopOver(daemon, fakePage());

  await loop.send("go");

  assert.equal(loop.snapshot.error.reason, "engine_error");
});

test("a page that will not report its state does not stop the user talking", async () => {
  const daemon = fakeDaemon({ runs: [[finished("ok")]] });
  const page = {
    port: {
      async state() {
        throw new Error("the webview is busy");
      },
      async call() {
        return { ok: true, output: "" };
      },
    },
  };
  const loop = loopOver(daemon, page);

  await loop.send("hello");

  assert.equal(loop.snapshot.phase, "idle");
  assert.deepEqual(daemon.requests.find((r) => r.path === "/run").body.host_state, {});
});

// --- the tool list -------------------------------------------------------------------------------

test("opening an application loads its tools with the classes the catalog gave them", async () => {
  const daemon = fakeDaemon({
    capabilities: [
      { name: "host.ledgerbox.chase", origin: "host:ledgerbox", class: "GATED", tier: 1, description: "", params_schema: {} },
    ],
  });
  const loop = loopOver(daemon, fakePage());

  await loop.openApp("ledgerbox");

  assert.equal(loop.snapshot.appId, "ledgerbox");
  assert.equal(loop.snapshot.tools[0].class, "GATED");
});
