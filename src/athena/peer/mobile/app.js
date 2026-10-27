// The phone page (ADR 0140, WP4): pair this phone with a beacon PC, then chat with Athena there and
// answer what she asks. Hand-written, no build step, no framework, no dependency.
//
// The wire is the peer listener's (src/athena/peer/routes.py, and WP3's remote composer):
//   POST /peer/pair/request, POST /peer/pair/claim     - open routes, the claim from the QR
//   GET  /peer/hello                                   - who the beacon is
//   GET  /peer/decisions, POST /peer/decisions/<id>    - grant `approve`
//   POST /peer/message, GET /peer/turns/<request_id>   - grant `chat`, the turn as SSE
// Every call after the claim carries `Authorization: Bearer <token>`, which is why the turn is read
// with fetch and a stream reader: EventSource cannot set a header.
//
// The claim travels in the URL fragment (`/m/#claim=<pairing_id>.<nonce>`), which never reaches a
// request line; it is read once and wiped from the address bar before anything else happens.
//
// Nothing here writes HTML from a string: every word reaches the page through textContent.
//
// A turn is followed by turn.js: it resumes with `from=<n>` whenever the beacon's stream ends open
// (its 15 s quiet, a card waiting on the person, a dropped network) and re-attaches after a reload.

import { TURN_KEY, createTurnReader, followTurn, pendingTurn, plainAction, sameCards, turnMessage } from "./turn.js";

const TOKEN_KEY = "athena.peer.v1"; // localStorage: {token, peer_id, device_id, beacon_name}
const CLAIM_KEY = "athena.claim.v1"; // sessionStorage: the claim in flight
const LOG_KEY = "athena.log.v1"; // sessionStorage: this tab's conversation
const LOG_LIMIT = 60;
const CLAIM_POLL_MS = 2000;
const CARDS_POLL_MS = 5000;
const HELLO_POLL_MS = 15000;
const GRANTS = ["chat", "approve"];

const app = document.getElementById("app");
const statusLine = document.getElementById("status");
const title = document.getElementById("title");

// --- small things ---------------------------------------------------------------------------

function read(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(storage, key, value) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    // A private tab may refuse storage; the page still works until it is closed.
  }
}

/** One element, its properties, and its children (strings become text, never HTML). */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "on") for (const [type, fn] of Object.entries(value)) node.addEventListener(type, fn);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function show(...nodes) {
  app.replaceChildren(...nodes);
  // <main> is not a live region (every streamed delta would be read out); a new panel is announced
  // by taking focus on its heading instead.
  const heading = app.querySelector(".panel h2, h2");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

function setStatus(text, off = false) {
  statusLine.textContent = text;
  statusLine.classList.toggle("off", off);
}

function timeOf(iso) {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? "" : when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// --- the wire -------------------------------------------------------------------------------

class Unreachable extends Error {}

/** One call. `{status, body}` for any answer; throws Unreachable when nothing answered. */
async function api(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch {
    throw new Unreachable();
  }
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  return { status: response.status, body: payload && typeof payload === "object" ? payload : {} };
}

// --- pairing --------------------------------------------------------------------------------

/** The claim in the fragment, once, and the address bar wiped of it at once. */
function takeClaim() {
  const hash = location.hash;
  if (hash) history.replaceState(null, "", location.pathname + location.search);
  const match = /^#claim=([A-Za-z0-9_]+)\.([A-Za-z0-9_-]+)$/.exec(hash);
  return match ? { pairing_id: match[1], nonce: match[2] } : null;
}

function instructions() {
  setStatus("");
  show(
    el(
      "section",
      { class: "panel" },
      el("h2", {}, "Pair this phone with Athena"),
      el("p", {}, "On your computer, open Athena, go to Devices and choose to let your phone reach Athena there."),
      el("p", {}, "Then scan the QR code it shows with this phone's camera."),
    ),
  );
}

function askName(claim) {
  setStatus("");
  const input = el("input", { type: "text", value: "Phone", maxlength: "40", autocomplete: "off", enterkeyhint: "send" });
  const button = el("button", { type: "submit" }, "Ask to pair");
  const form = el(
    "form",
    {
      class: "panel",
      on: {
        submit: (event) => {
          event.preventDefault();
          button.disabled = true;
          request(claim, input.value.trim() || "Phone").finally(() => (button.disabled = false));
        },
      },
    },
    el("h2", {}, "Pair this phone with Athena"),
    el("label", {}, "What should Athena call this phone?", input),
    button,
  );
  show(form);
}

async function request(claim, name) {
  let answer;
  try {
    answer = await api("POST", "/peer/pair/request", {
      pairing_id: claim.pairing_id,
      nonce: claim.nonce,
      name,
      kind: "phone",
      device_id: null,
      requested_grants: GRANTS,
    });
  } catch {
    return unreachableDuringPairing(() => request(claim, name));
  }
  const { status, body } = answer;
  if (status === 200) {
    const pending = { ...claim, claim_secret: body.claim_secret, beacon_name: body.name || "your computer", expires_at: body.expires_at, phone_name: name };
    write(sessionStorage, CLAIM_KEY, pending);
    return waiting(pending);
  }
  if (body.error === "window_taken") return closed("Another device already asked to pair with this code.", "Open a new pairing on the computer and scan its QR code again.");
  if (body.error === "kind_mismatch") return closed("This QR code is for pairing a computer, not a phone.", "On the computer, choose to pair a phone instead.");
  return expired();
}

function waiting(pending) {
  const beacon = pending.beacon_name;
  title.textContent = "Athena";
  setStatus("Waiting");
  const until = timeOf(pending.expires_at);
  show(
    el(
      "section",
      { class: "panel" },
      el("h2", {}, `Approve this phone on ${beacon}`),
      el("p", {}, `On ${beacon}, Athena's Devices page is asking whether "${pending.phone_name || "Phone"}" may reach her. Approve it there.`),
      until ? el("p", { class: "note" }, `The request stays open until ${until}.`) : null,
    ),
  );
  pollClaim(pending);
}

let claimTimer = 0;

async function pollClaim(pending) {
  clearTimeout(claimTimer);
  let answer;
  try {
    answer = await api("POST", "/peer/pair/claim", {
      pairing_id: pending.pairing_id,
      nonce: pending.nonce,
      claim_secret: pending.claim_secret,
    });
  } catch {
    setStatus(`Can't reach ${pending.beacon_name} - still trying`, true);
    claimTimer = setTimeout(() => pollClaim(pending), CLAIM_POLL_MS * 2);
    return;
  }
  const { status, body } = answer;
  if (status === 202) {
    setStatus("Waiting");
    claimTimer = setTimeout(() => pollClaim(pending), CLAIM_POLL_MS);
    return;
  }
  write(sessionStorage, CLAIM_KEY, null);
  if (status === 200 && typeof body.token === "string") {
    write(localStorage, TOKEN_KEY, { token: body.token, peer_id: body.peer_id, device_id: body.device_id, beacon_name: body.name || pending.beacon_name });
    write(sessionStorage, LOG_KEY, null);
    return ready();
  }
  if (body.error === "pairing_declined") return closed(`${pending.beacon_name} said no.`, "If that was a mistake, pair again from the Devices page.");
  return expired();
}

function expired() {
  write(sessionStorage, CLAIM_KEY, null);
  closed("This pairing code has closed.", "On the computer, open Devices and show a new QR code, then scan it again.");
}

function closed(what, next) {
  setStatus("");
  show(el("section", { class: "panel" }, el("h2", {}, what), el("p", {}, next)));
}

function unreachableDuringPairing(retry) {
  setStatus("Can't reach the computer", true);
  show(
    el(
      "section",
      { class: "panel" },
      el("h2", {}, "Can't reach your computer"),
      el("p", {}, "This phone needs to be on your private network (the Tailscale app, signed in to the same account), and Athena must be open on the computer."),
      el("button", { type: "button", on: { click: retry } }, "Try again"),
    ),
  );
}

// --- chat -----------------------------------------------------------------------------------

const chat = {
  saved: null, // {token, peer_id, device_id, beacon_name}
  beacon: "your computer",
  cards: [],
  canApprove: true,
  busy: false,
  log: [],
  nodes: null,
  timers: [],
  armed: false, // the wake listener is added once, however often ready() runs
};

function forget() {
  chat.saved = null; // the dead token goes from memory too: nothing below may knock with it
  write(localStorage, TOKEN_KEY, null);
  write(sessionStorage, LOG_KEY, null);
  write(sessionStorage, TURN_KEY, null);
  for (const timer of chat.timers) clearInterval(timer);
  chat.timers = [];
}

function revoked() {
  const beacon = chat.beacon;
  forget();
  title.textContent = "Athena";
  closed(`This phone was removed from Athena on ${beacon}.`, "To use it again, pair it from the Devices page on that computer.");
}

function banner(text, off = false) {
  if (!chat.nodes) return;
  chat.nodes.banner.textContent = text;
  chat.nodes.banner.hidden = !text;
  chat.nodes.banner.classList.toggle("off", off);
}

function asleep() {
  setStatus("Asleep", true);
  banner(`Athena on ${chat.beacon} is asleep - open her on that computer.`, true);
}

function unreachable() {
  setStatus("Can't reach", true);
  banner(`Can't reach Athena on ${chat.beacon}. Is that computer on, with Athena open?`, true);
}

function awake() {
  setStatus("Connected");
  banner("");
}

/** The answer to an authenticated call that every caller treats the same way, or `null`. */
function common(answer) {
  if (answer.status === 401) {
    revoked();
    return "revoked";
  }
  if (answer.status === 409 && (answer.body.error === "window_closed" || answer.body.state === "window_closed")) {
    asleep();
    return "asleep";
  }
  return null;
}

async function call(method, path, body) {
  try {
    const answer = await api(method, path, body, chat.saved.token);
    if (answer.status < 500) awake();
    return answer;
  } catch (error) {
    if (error instanceof Unreachable) unreachable();
    throw error;
  }
}

async function ready() {
  chat.saved = read(localStorage, TOKEN_KEY);
  if (!chat.saved || !chat.saved.token) return instructions();
  chat.beacon = chat.saved.beacon_name || "your computer";
  chat.log = read(sessionStorage, LOG_KEY) || [];
  renderChat();
  await hello();
  if (!chat.saved) return; // the beacon answered 401: this phone was removed, stay quiet
  // A reload mid-answer: pick the open turn up where it stopped instead of dropping it.
  const open = pendingTurn(sessionStorage);
  if (open && chat.saved) resume(open);
  await loadCards();
  if (!chat.saved) return;
  chat.timers.push(setInterval(() => document.visibilityState === "visible" && loadCards(), CARDS_POLL_MS));
  chat.timers.push(setInterval(() => document.visibilityState === "visible" && hello(), HELLO_POLL_MS));
  if (chat.armed) return;
  chat.armed = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && chat.saved) {
      hello();
      loadCards();
    }
  });
}

async function hello() {
  let answer;
  try {
    answer = await call("GET", "/peer/hello");
  } catch {
    return;
  }
  if (common(answer)) return;
  if (answer.status === 200 && answer.body.name) {
    chat.beacon = answer.body.name;
    title.textContent = `Athena on ${chat.beacon}`;
    write(localStorage, TOKEN_KEY, { ...chat.saved, beacon_name: chat.beacon });
  }
}

function renderChat() {
  title.textContent = `Athena on ${chat.beacon}`;
  const bannerNode = el("p", { class: "banner", hidden: true, role: "alert" });
  // Cards redraw only when they change (sameCards), so a polite region says each one once.
  const cards = el("section", { class: "cards", "aria-label": "Waiting on you", "aria-live": "polite" });
  const log = el("section", { class: "log", role: "log", "aria-label": "Conversation" });
  // Her answer is read once, finished, from here; while it streams its message is aria-hidden.
  const said = el("p", { class: "sr-only", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  const input = el("textarea", { rows: "1", placeholder: "Ask Athena", "aria-label": "Message", enterkeyhint: "send" });
  const send = el("button", { type: "submit" }, "Send");
  const composer = el(
    "form",
    {
      class: "composer",
      on: {
        submit: (event) => {
          event.preventDefault();
          const text = input.value.trim();
          if (!text || chat.busy) return;
          input.value = "";
          sendMessage(text);
        },
      },
    },
    input,
    send,
  );
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  });
  chat.nodes = { banner: bannerNode, cards, log, input, send, said };
  show(bannerNode, cards, log, composer, said);
  for (const entry of chat.log) log.append(messageNode(entry));
  if (!chat.log.length) log.append(el("p", { class: "note" }, `Ask Athena on ${chat.beacon} anything you would ask her there.`));
  renderCards();
}

function messageNode(entry) {
  return el("div", { class: `msg ${entry.who}` }, entry.text);
}

function say(who, text) {
  const entry = { who, text };
  chat.log.push(entry);
  chat.log = chat.log.slice(-LOG_LIMIT);
  write(sessionStorage, LOG_KEY, chat.log);
  const note = chat.nodes.log.querySelector(".note");
  if (note) note.remove();
  const node = messageNode(entry);
  chat.nodes.log.append(node);
  node.scrollIntoView({ block: "end", behavior: "smooth" });
  return { entry, node };
}

/** Keep a streaming message out of the reader's way, then read it once when the turn is done. */
function hold(said) {
  said.node.setAttribute("aria-hidden", "true");
  said.held = true;
}

function release(said) {
  if (!said || !said.held) return;
  said.held = false;
  said.node.removeAttribute("aria-hidden");
  if (chat.nodes) chat.nodes.said.textContent = said.entry.text;
}

function settle(said, text) {
  said.entry.text = text;
  said.node.textContent = text;
  write(sessionStorage, LOG_KEY, chat.log);
}

function busy(on) {
  chat.busy = on;
  if (chat.nodes) chat.nodes.send.disabled = on;
}

async function sendMessage(text) {
  busy(true);
  say("you", text);
  try {
    let answer;
    try {
      answer = await call("POST", "/peer/message", { text, target_app: null });
    } catch {
      say("trouble", "Not sent: the computer did not answer.");
      return;
    }
    if (common(answer)) {
      if (answer.status === 409) say("trouble", `Not sent: Athena on ${chat.beacon} is asleep.`);
      return;
    }
    if (answer.status === 403 && answer.body.error === "grant_missing") {
      say("trouble", `This phone may not chat with Athena on ${chat.beacon}.`);
      return;
    }
    if (answer.status !== 200 || typeof answer.body.request_id !== "string") {
      const busyNow = answer.status === 409 || answer.status === 429;
      say("trouble", busyNow ? "Athena is busy with something else. Try again in a moment." : "Not sent. Try again in a moment.");
      return;
    }
    await follow(answer.body.request_id);
  } finally {
    busy(false);
  }
}

/** The `her` message a re-attached turn was writing: the last one in the conversation. */
function lastHer() {
  if (!chat.nodes) return null;
  let index = chat.log.length - 1;
  while (index >= 0 && chat.log[index].who !== "her") index -= 1;
  const nodes = chat.nodes.log.querySelectorAll(".msg.her");
  return index >= 0 && nodes.length ? { entry: chat.log[index], node: nodes[nodes.length - 1] } : null;
}

/**
 * One turn on the beacon, as it happens, to its end - through the beacon's quiet windows, a card
 * signed here or on the computer, a dropped network and a reload (turn.js). `open` is a stored turn
 * to re-attach to: `{next, text}`.
 */
async function follow(requestId, open = null) {
  const reader = createTurnReader({ text: open ? open.text || "" : "" });
  let her = open && open.text ? lastHer() : null;
  let refused = null;
  let streaming = null; // the message whose words are still being held back
  if (her) {
    hold(her);
    streaming = her;
  }
  const final = await followTurn({
    token: chat.saved.token,
    requestId,
    from: open ? open.next : 0,
    store: sessionStorage,
    memo: () => ({ text: reader.text }),
    onEvent: (event) => {
      for (const op of reader.apply(event)) {
        if (op.op === "say" && op.who === "her") {
          her = say("her", op.text);
          hold(her);
          streaming = her;
        }
        else if (op.op === "say") say(op.who, op.text);
        else if (op.op === "settle") {
          if (her) settle(her, op.text);
          else {
            her = say("her", op.text);
            hold(her);
            streaming = her;
          }
        } else if (op.op === "cards") loadCards();
      }
      if (event.kind === "turn.finished") {
        release(her);
        her = null;
      }
      // A card now waits on the person: the composer is theirs again while the turn waits.
      if (event.kind === "decision.requested") busy(false);
    },
    onState: (state, info) => {
      if (state === "reconnecting") unreachable();
      else if (state === "streaming") awake();
      refused = info && typeof info.status === "number" ? info.status : null;
    },
  });
  release(streaming); // a turn that ended without turn.finished still gets its words read, once
  if (final === "revoked") return revoked();
  const words = turnMessage(final, { beacon: chat.beacon, status: final === "error" ? refused : null });
  if (words) say("trouble", words);
}

/** Re-attach to the turn a reload interrupted. */
async function resume(open) {
  busy(true);
  try {
    await follow(open.request_id, open);
  } finally {
    busy(false);
  }
}

// --- what waits on you ----------------------------------------------------------------------

async function loadCards() {
  if (!chat.saved || !chat.canApprove) return;
  let answer;
  try {
    answer = await call("GET", "/peer/decisions");
  } catch {
    return;
  }
  if (common(answer)) return;
  if (answer.status === 403 || answer.status === 404) {
    // No `approve` grant here, or a beacon that does not serve cards: show none, ask no more.
    chat.canApprove = false;
    chat.cards = [];
    return renderCards();
  }
  if (answer.status !== 200) return;
  const body = answer.body;
  const rows = Array.isArray(body.pending) ? body.pending : Array.isArray(body.decisions) ? body.decisions : [];
  const polled = rows.filter((row) => row && typeof row.id === "string");
  // Unchanged: leave the drawn cards alone (an open "Read it first" stays open, focus stays put).
  if (sameCards(chat.cards, polled)) return;
  chat.cards = polled;
  renderCards();
}

function optionsOf(card) {
  const raw = Array.isArray(card.options) && card.options.length ? card.options : ["approve", "decline"];
  return raw.map((option) => (typeof option === "string" ? { id: option, label: option } : { id: option.id, label: option.label || option.id }));
}

function renderCards() {
  if (!chat.nodes) return;
  const nodes = chat.cards.map((card) => {
    const buttons = optionsOf(card).map((option) => {
      const signing = option.id === "approve";
      return el(
        "button",
        {
          type: "button",
          class: signing ? "sign" : "quiet",
          on: { click: (event) => answerCard(card, option.id, event.currentTarget) },
        },
        signing ? "Sign" : option.id === "decline" ? "Decline" : option.label,
      );
    });
    const params = card.params && Object.keys(card.params).length ? JSON.stringify(card.params, null, 2) : "";
    return el(
      "article",
      { class: "card", "data-card": card.id },
      el("span", { class: "eyebrow" }, "Waiting on you"),
      el("span", { class: "what" }, `Athena wants to ${plainAction(card.action)}`),
      card.rationale ? el("span", { class: "why" }, card.rationale) : null,
      params ? el("details", {}, el("summary", {}, "Read it first"), el("pre", {}, params)) : null,
      el("div", { class: "row" }, buttons),
      el("span", { class: "fine" }, "Nothing runs until you sign."),
    );
  });
  chat.nodes.cards.replaceChildren(...nodes);
  chat.nodes.cards.hidden = nodes.length === 0;
}

async function answerCard(card, choice, button) {
  button.disabled = true;
  let answer;
  try {
    answer = await call("POST", `/peer/decisions/${encodeURIComponent(card.id)}`, { choice });
  } catch {
    button.disabled = false;
    return;
  }
  if (common(answer)) return;
  if (answer.status === 200) {
    say("step", choice === "approve" ? `You signed: ${plainAction(card.action)}` : `You declined: ${plainAction(card.action)}`);
  } else if (answer.status === 409 || answer.status === 404) {
    say("step", "That one was already answered.");
  } else {
    say("trouble", "That answer did not go through. Try again.");
    button.disabled = false;
  }
  loadCards();
}

// --- start ----------------------------------------------------------------------------------

function start() {
  if ("serviceWorker" in navigator && window.isSecureContext) {
    // Only over HTTPS: on the plain-http overlay address a service worker cannot register.
    navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});
  }
  const fresh = takeClaim();
  if (fresh) {
    write(sessionStorage, CLAIM_KEY, null);
    return askName(fresh);
  }
  const pending = read(sessionStorage, CLAIM_KEY);
  if (pending && pending.claim_secret) return waiting(pending);
  if (read(localStorage, TOKEN_KEY)) return ready();
  return instructions();
}

start();
