// The phone page follows a turn to its end (ADR 0140, "Phone and setup"). No DOM in here: app.js
// renders, this module reads the beacon and says what to render, so node:test can drive it with a
// fake fetch (tests/peer/phone/turn.test.mjs).
//
// GET /peer/turns/<request_id>?from=<n> (src/athena/peer/remote.py) streams every event from index
// n, each with its SSE `id:`, and a last `remote.closed` frame once the turn is closed. A stream that
// carried nothing for 15 s ends WITHOUT that frame (ADR 0011: every response ends), and the reader is
// expected back with `from` set to the count it has. That quiet is the normal case while a card waits
// on the person: the turn after the signature continues the same request. So a stream that ends
// open is resumed, never reported as a failure, and each event is delivered exactly once.
//
// States: streaming, reconnecting, then one of finished, error, expired, lost, revoked (terminal),
// or stopped (the caller aborted; the open turn stays stored so a reload re-attaches).

export const TURN_KEY = "athena.turn.v1"; // sessionStorage: {request_id, next, ...memo} of the open turn
export const TURN_TTL_S = 600; // remote.py TURN_TTL_S: past it with no answer the turn is gone anyway
export const BACKOFF_MS = [1000, 2000, 4000];
export const BACKOFF_CEILING_MS = 15000;
const CLOSED_KIND = "remote.closed";
const REQUEST_ID = /^job_[0-9a-f]{12}$/;

/** Server-Sent Events off a fetch body: `{id, kind, event}` per frame, `event` null when not JSON. */
export async function* frames(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let kind = "";
      let id = null;
      const data = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) kind = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        else if (line.startsWith("id:")) {
          const n = Number.parseInt(line.slice(3).trim(), 10);
          id = Number.isInteger(n) && n >= 0 ? n : null;
        }
      }
      if (!data.length) continue;
      let event = null;
      try {
        const parsed = JSON.parse(data.join("\n"));
        if (parsed && typeof parsed === "object") {
          event = parsed;
          if (!event.kind) event.kind = kind;
        }
      } catch {
        // A frame that is not JSON is not an event; its id still counts.
      }
      yield { id, kind: event ? event.kind : kind, event };
    }
  }
}

function keep(store, entry) {
  if (!store) return;
  try {
    if (entry === null) store.removeItem(TURN_KEY);
    else store.setItem(TURN_KEY, JSON.stringify(entry));
  } catch {
    // A private tab may refuse storage; following still works until the page goes.
  }
}

/** The turn a reload should re-attach to, or `null`. */
export function pendingTurn(store) {
  if (!store) return null;
  try {
    const entry = JSON.parse(store.getItem(TURN_KEY) || "null");
    if (entry && typeof entry.request_id === "string" && REQUEST_ID.test(entry.request_id) && Number.isInteger(entry.next) && entry.next >= 0) return entry;
  } catch {
    // Not a turn.
  }
  return null;
}

function defaultSleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Follow one turn until it closes. Resolves to the terminal state.
 *
 * `onEvent(event)` gets each event once, in order. `onState(state, info)` gets every change of
 * state; `info.status` is the HTTP status that ended it, when one did. `store` (sessionStorage)
 * keeps `{request_id, next, ...memo()}` after each event and is cleared once the turn is over.
 */
export async function followTurn({
  fetch: fetchFn = globalThis.fetch,
  token,
  requestId,
  from = 0,
  onEvent = () => {},
  onState = () => {},
  sleep = defaultSleep,
  now = Date.now,
  store = null,
  memo = null,
  signal = null,
}) {
  let next = Math.max(0, from | 0);
  let state = "";
  let failures = 0;
  let contact = now();
  const set = (to, info = {}) => {
    if (to !== state) {
      state = to;
      onState(to, info);
    }
    return to;
  };
  const save = () => keep(store, { request_id: requestId, next, ...(memo ? memo() : {}) });
  const end = (to, info) => {
    // Forget the stored turn only if it is still this one: a later message may have replaced it.
    if (pendingTurn(store)?.request_id === requestId) keep(store, null);
    return set(to, info);
  };

  save();
  for (;;) {
    if (signal?.aborted) return set("stopped");
    if (failures > 0) {
      if (now() - contact >= TURN_TTL_S * 1000) return end("lost");
      await sleep(BACKOFF_MS[failures - 1] ?? BACKOFF_CEILING_MS, signal);
      if (signal?.aborted) return set("stopped");
    }
    const opened = now();
    let response;
    try {
      response = await fetchFn(`/peer/turns/${encodeURIComponent(requestId)}?from=${next}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: signal ?? undefined,
      });
    } catch {
      if (signal?.aborted) return set("stopped");
      failures += 1;
      set("reconnecting");
      continue;
    }
    if (response.status === 401) return end("revoked", { status: 401 });
    if (response.status === 404) return end("expired", { status: 404 });
    if (response.status >= 500) {
      failures += 1;
      set("reconnecting", { status: response.status });
      continue;
    }
    if (!response.ok || !response.body) return end("error", { status: response.status });

    contact = now();
    failures = 0;
    set("streaming");
    let delivered = 0;
    let closed = null;
    try {
      for await (const frame of frames(response.body)) {
        if (frame.kind === CLOSED_KIND && frame.id === null) {
          closed = frame.event || { reason: "finished" };
          break;
        }
        if (frame.id !== null && frame.id < next) continue; // already delivered
        if (frame.id !== null) next = frame.id + 1;
        else if (frame.event) next += 1;
        contact = now();
        if (frame.event) {
          delivered += 1;
          onEvent(frame.event);
        }
        save();
        if (signal?.aborted) return set("stopped");
      }
    } catch {
      if (signal?.aborted) return set("stopped");
      failures += 1;
      set("reconnecting");
      continue;
    }
    if (closed) {
      const reason = closed.reason;
      if (reason === "expired") return end("expired");
      return end(reason === "finished" ? "finished" : "error");
    }
    // Ended open: the beacon's quiet window. Come back at once with from=next - unless it ended
    // at once with nothing, which is not a quiet window but a beacon that will spin us.
    if (delivered === 0 && now() - opened < BACKOFF_MS[0]) await sleep(BACKOFF_MS[0], signal);
  }
}

/** Her text without the machine lines a turn can carry (`OP: {...}`, `TTS: "..."`). */
export function plainText(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => !/^\s*(OP|TTS):/.test(line))
    .join("\n")
    .trim();
}

/** `connector.setup.install_overlay` -> "install overlay": a tool's own verb, in plain words. */
export function plainAction(name) {
  const last = String(name || "").split(".").pop() || "do something";
  return last.replace(/[_-]+/g, " ").trim();
}

/**
 * What a turn's events put in the conversation, as ops app.js applies:
 * `{op: "say", who, text}` adds a message; `{op: "settle", text}` rewrites the current `her` one;
 * `{op: "cards"}` asks for the cards again. Each run of the turn (the first, and each continuation
 * after a signature) is its own `her` message. `text` seeds a run already partly shown (a reload).
 */
export function createTurnReader({ text = "" } = {}) {
  let current = text;
  let shown = plainText(text) !== "";
  return {
    get text() {
      return current;
    },
    apply(event) {
      const ops = [];
      if (event.kind === "text.delta") {
        current += event.text || "";
        const words = plainText(current);
        if (words) {
          ops.push(shown ? { op: "settle", text: words } : { op: "say", who: "her", text: words });
          shown = true;
        }
      } else if (event.kind === "tool.result") {
        ops.push({ op: "say", who: "step", text: `${event.ok ? "Done" : "Could not"}: ${plainAction(event.name)}` });
      } else if (event.kind === "decision.requested") {
        ops.push({ op: "say", who: "step", text: `She needs your OK to ${plainAction(event.action)}. It is above.` }, { op: "cards" });
      } else if (event.kind === "decision.resolved") {
        ops.push({ op: "cards" });
      } else if (event.kind === "turn.finished") {
        const final = plainText(event.text);
        if (final && !shown) ops.push({ op: "say", who: "her", text: final });
        else if (final && final.length > plainText(current).length) ops.push({ op: "settle", text: final });
        current = "";
        shown = false; // a continuation, if one comes, is a new message
      } else if (event.kind === "turn.error") {
        ops.push({ op: "say", who: "trouble", text: event.detail ? `That did not work: ${event.detail}` : "That did not work." });
      }
      return ops;
    },
  };
}

/**
 * Whether a cards poll returned exactly the cards already drawn: the same ids in the same order,
 * each with the same action, reason, params and options (everything app.js draws). The poll runs
 * every five seconds; redrawing an unchanged list would collapse an open "Read it first", take the
 * focus off a button and replay every card's entrance each time.
 */
export function sameCards(drawn, polled) {
  const shape = (cards) =>
    JSON.stringify(
      (cards || []).map((card) => [card.id, card.action ?? null, card.rationale ?? null, card.params ?? null, card.options ?? null]),
    );
  return shape(drawn) === shape(polled);
}

/** What the page says when a turn ends in `state`, or `null` when the events already said it. */
export function turnMessage(state, { beacon = "your computer", status = null } = {}) {
  if (state === "expired") return `That conversation ended on ${beacon} before it finished.`;
  if (state === "lost") return `Lost the answer: ${beacon} stopped answering.`;
  if (state === "error" && status !== null) return "Athena could not start on that.";
  return null;
}
