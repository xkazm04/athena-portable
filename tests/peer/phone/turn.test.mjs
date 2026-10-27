// The phone page follows a turn to its end (ADR 0140, "Phone and setup"): src/athena/peer/mobile/turn.js.
// Run with `node --test tests/peer/phone/`; tests/peer/test_phone_turn.py runs it under pytest.
//
// The fake beacon below answers GET /peer/turns/<id>?from=n with scripted SSE bodies shaped like
// remote.py's frames(): a comment and retry line, `id: n` + event frames, and a last
// `remote.closed` frame once the turn is closed - or nothing more when the stream went quiet.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createTurnReader, followTurn, pendingTurn, sameCards, turnMessage, TURN_KEY } from "../../../src/athena/peer/mobile/turn.js";

const RID = "job_0123456789ab";

function frame(index, event) {
  return `id: ${index}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

function closed(reason) {
  const payload = { kind: "remote.closed", request_id: RID, reason, showing: 0, total: 0, footer: "" };
  return `event: remote.closed\ndata: ${JSON.stringify(payload)}\n\n`;
}

function body(text, { breakAfter = false } = {}) {
  const bytes = new TextEncoder().encode(`: athena turn\nretry: 3000\n\n${text}`);
  // Split mid-frame so the parser has to buffer; one chunk per read, then close or break.
  const cut = Math.floor(bytes.length / 2);
  const chunks = [bytes.slice(0, cut), bytes.slice(cut)];
  return new ReadableStream(
    {
      pull(controller) {
        if (chunks.length) controller.enqueue(chunks.shift());
        else if (breakAfter) controller.error(new TypeError("network lost"));
        else controller.close();
      },
    },
    { highWaterMark: 0 },
  );
}

function ok(text, options) {
  return { status: 200, ok: true, body: body(text, options), json: async () => ({}) };
}

function refusal(status, payload) {
  return { status, ok: false, body: null, json: async () => payload };
}

/** A scripted beacon: each call takes the next answer (a response, or "throw"). */
function beacon(answers) {
  const urls = [];
  const fetch = async (url, init) => {
    urls.push(url);
    assert.equal(init.headers.Authorization, "Bearer tok");
    const next = answers.length > 1 ? answers.shift() : answers[0];
    if (next === "throw") throw new TypeError("Failed to fetch");
    return typeof next === "function" ? next() : next;
  };
  return { fetch, urls };
}

function clock() {
  let at = 1_000_000;
  const slept = [];
  return {
    now: () => at,
    sleep: async (ms) => {
      slept.push(ms);
      at += ms;
    },
    slept,
  };
}

function memoryStore() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map,
  };
}

function delta(text) {
  return { kind: "text.delta", text };
}

async function run(answers, extra = {}) {
  const net = beacon(answers);
  const time = clock();
  const events = [];
  const states = [];
  const final = await followTurn({
    fetch: net.fetch,
    token: "tok",
    requestId: RID,
    from: 0,
    onEvent: (event) => events.push(event),
    onState: (state, info) => states.push([state, info]),
    sleep: time.sleep,
    now: time.now,
    store: memoryStore(),
    ...extra,
  });
  return { final, events, states, urls: net.urls, slept: time.slept };
}

// --- case 1 --------------------------------------------------------------------------------------

test("case 1: a quiet end without remote.closed resumes with from=3 and every event arrives once", async () => {
  const first = ok(frame(0, delta("a")) + frame(1, delta("b")) + frame(2, delta("c")));
  const second = ok(frame(3, delta("d")) + frame(4, { kind: "turn.finished", text: "abcd" }) + closed("finished"));
  const { final, events, urls, states } = await run([first, second]);
  assert.equal(urls.length, 2);
  assert.equal(urls[0], `/peer/turns/${RID}?from=0`);
  assert.equal(urls[1], `/peer/turns/${RID}?from=3`);
  assert.deepEqual(
    events.map((e) => e.kind + ":" + (e.text ?? "")),
    ["text.delta:a", "text.delta:b", "text.delta:c", "text.delta:d", "turn.finished:abcd"],
  );
  assert.equal(final, "finished");
  assert.equal(states.at(-1)[0], "finished");
});

test("case 1: an event the beacon repeats below from is not delivered twice", async () => {
  const first = ok(frame(0, delta("a")) + frame(1, delta("b")));
  const second = ok(frame(1, delta("b")) + frame(2, delta("c")) + closed("finished"));
  const { events } = await run([first, second]);
  assert.deepEqual(events.map((e) => e.text), ["a", "b", "c"]);
});

// --- case 2 --------------------------------------------------------------------------------------

test("case 2: a turn waiting on a card is followed through the signature to its continuation", async () => {
  const before = ok(
    frame(0, { kind: "tool.result", ok: true, name: "mail.draft" }) +
      frame(1, { kind: "decision.requested", action: "mail.send", approval_id: "ap_1" }) +
      frame(2, { kind: "turn.finished", text: "" }),
  );
  const quiet = ok(""); // the person is reading the card: 15 s of nothing
  const after = ok(
    frame(3, { kind: "decision.resolved", approval_id: "ap_1", choice: "approve" }) +
      frame(4, delta("Sent it ")) +
      frame(5, delta("to Ana.")) +
      frame(6, { kind: "turn.finished", text: "Sent it to Ana." }) +
      closed("finished"),
  );
  const reader = createTurnReader();
  const ops = [];
  const { final, urls } = await run([before, quiet, after], { onEvent: (event) => ops.push(...reader.apply(event)) });
  assert.equal(final, "finished");
  assert.deepEqual(urls.map((u) => u.split("?")[1]), ["from=0", "from=3", "from=3"]);
  // Fold the ops as app.js does: a `say` makes a message, a `settle` rewrites the current one.
  const messages = [];
  let her = null;
  for (const op of ops) {
    if (op.op === "say") {
      const entry = { who: op.who, text: op.text };
      messages.push(entry);
      if (op.who === "her") her = entry;
    } else if (op.op === "settle") her.text = op.text;
  }
  const hers = messages.filter((m) => m.who === "her");
  assert.deepEqual(hers, [{ who: "her", text: "Sent it to Ana." }]);
  assert.ok(messages.some((m) => m.who === "step" && /OK to send/.test(m.text)));
});

// --- case 3 --------------------------------------------------------------------------------------

test("case 3: a resume that answers 404 not_found is 'expired', said in plain words", async () => {
  const first = ok(frame(0, delta("a")));
  const gone = refusal(404, { error: "not_found" });
  const { final, events } = await run([first, gone]);
  assert.equal(final, "expired");
  assert.equal(events.length, 1);
  assert.equal(turnMessage("expired", { beacon: "Desk" }), "That conversation ended on Desk before it finished.");
});

test("case 3: a turn the beacon closed as expired is 'expired' too", async () => {
  const { final } = await run([ok(frame(0, delta("a")) + closed("expired"))]);
  assert.equal(final, "expired");
});

// --- case 4 --------------------------------------------------------------------------------------

test("case 4: an unreachable beacon backs off 1, 2, 4 then 15 s on the same from, and is 'lost' after the TTL", async () => {
  const first = ok(frame(0, delta("a")) + frame(1, delta("b")), { breakAfter: true });
  const { final, states, urls, slept } = await run([first, "throw"]);
  assert.equal(final, "lost");
  assert.ok(states.some(([s]) => s === "reconnecting"));
  assert.deepEqual(slept.slice(0, 5), [1000, 2000, 4000, 15000, 15000]);
  assert.ok(slept.slice(3).every((ms) => ms === 15000));
  const waited = slept.reduce((a, b) => a + b, 0);
  assert.ok(waited >= 600_000 && waited < 600_000 + 15_000, `waited ${waited}`);
  for (const url of urls.slice(1)) assert.equal(url, `/peer/turns/${RID}?from=2`);
  assert.equal(turnMessage("lost", { beacon: "Desk" }), "Lost the answer: Desk stopped answering.");
});

test("case 4: a beacon that comes back resets the backoff", async () => {
  const back = ok(frame(0, delta("a")) + closed("finished"));
  const { final, slept } = await run(["throw", "throw", back]);
  assert.equal(final, "finished");
  assert.deepEqual(slept, [1000, 2000]);
});

// --- case 5 --------------------------------------------------------------------------------------

test("case 5: a resume that answers 401 is 'revoked' and asks no more", async () => {
  const first = ok(frame(0, delta("a")));
  const { final, urls } = await run([first, refusal(401, { error: "unauthorized" })]);
  assert.equal(final, "revoked");
  assert.equal(urls.length, 2);
});

// --- case 6 --------------------------------------------------------------------------------------

test("case 6: the open turn is kept as it advances and a reload re-attaches at from=next", async () => {
  const store = memoryStore();
  const controller = new AbortController();
  const net = beacon([ok(frame(0, delta("a")) + frame(1, delta("b")) + frame(2, delta("c")))]);
  const seen = [];
  const first = await followTurn({
    fetch: net.fetch,
    token: "tok",
    requestId: RID,
    from: 0,
    store,
    signal: controller.signal,
    sleep: async () => {},
    memo: () => ({ text: seen.join("") }),
    onEvent: (event) => {
      seen.push(event.text);
      if (seen.length === 2) controller.abort(); // the page goes away after the second event
    },
  });
  assert.equal(first, "stopped");
  const open = pendingTurn(store);
  assert.deepEqual(open, { request_id: RID, next: 2, text: "ab" });
  assert.ok(store.map.has(TURN_KEY));

  const again = beacon([ok(frame(2, delta("c")) + closed("finished"))]);
  const rest = [];
  const final = await followTurn({
    fetch: again.fetch,
    token: "tok",
    requestId: open.request_id,
    from: open.next,
    store,
    sleep: async () => {},
    onEvent: (event) => rest.push(event.text),
  });
  assert.equal(final, "finished");
  assert.deepEqual(again.urls, [`/peer/turns/${RID}?from=2`]);
  assert.deepEqual(rest, ["c"]);
  assert.equal(pendingTurn(store), null, "a finished turn is no longer open");
});

test("case 6: a stored entry that is not a turn is ignored", () => {
  const store = memoryStore();
  store.setItem(TURN_KEY, "{not json");
  assert.equal(pendingTurn(store), null);
  store.setItem(TURN_KEY, JSON.stringify({ request_id: "../x", next: 1 }));
  assert.equal(pendingTurn(store), null);
  assert.equal(pendingTurn(null), null);
});

// --- guards --------------------------------------------------------------------------------------

test("guard 7: a stream that closes on the first connection is one fetch, 'finished'", async () => {
  const { final, urls, slept } = await run([ok(frame(0, delta("hi")) + frame(1, { kind: "turn.finished", text: "hi" }) + closed("finished"))]);
  assert.equal(final, "finished");
  assert.equal(urls.length, 1);
  assert.deepEqual(slept, []);
});

test("guard 8: a data line that is not JSON is skipped and the next frame still arrives", async () => {
  const text = `id: 0\nevent: text.delta\ndata: {not json\n\n` + frame(1, delta("ok")) + closed("finished");
  const { final, events } = await run([ok(text)]);
  assert.equal(final, "finished");
  assert.deepEqual(events.map((e) => e.text), ["ok"]);
});

// --- the cards poll ------------------------------------------------------------------------------

test("cards 9: a poll that returns the cards already drawn changes nothing", () => {
  const card = { id: "apr_1", action: "connector.setup.firewall_allow", rationale: "so the phone can reach", params: { port: 17491 }, options: ["approve", "decline"] };
  // The same rows, freshly parsed: a redraw here would collapse an open "Read it first", drop the
  // focus off a button and replay every card's entrance, every five seconds.
  assert.equal(sameCards([card], [JSON.parse(JSON.stringify(card))]), true);
  assert.equal(sameCards([], []), true);
});

test("cards 10: a new, gone, reordered or changed card is a change", () => {
  const a = { id: "apr_1", action: "x.y", params: { n: 1 } };
  const b = { id: "apr_2", action: "x.z" };
  assert.equal(sameCards([a], [a, b]), false);
  assert.equal(sameCards([a, b], [a]), false);
  assert.equal(sameCards([a, b], [b, a]), false);
  assert.equal(sameCards([a], [{ ...a, params: { n: 2 } }]), false);
  assert.equal(sameCards([a], [{ ...a, rationale: "now with a reason" }]), false);
  assert.equal(sameCards([a], [{ ...a, options: ["approve"] }]), false);
});
