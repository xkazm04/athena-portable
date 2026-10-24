# The bridge protocol

Implements README §3.4 tier 1: *the page's own WebMCP tools, through `inject.js` and the relay*.
This directory is the source of truth for what runs in a page's main world; every surface —
the desktop shell's page webviews, an extension's content script — injects the same file and
speaks the same messages.

| File | Where it runs | Job |
|---|---|---|
| `inject.js` | the page's main world, at document start | polyfill `document.modelContext`, answer `list` and `call`, post `toolchange` and `late` |
| `gate.js` | the surface — the panel, an extension — never the page | annotations → flags → `AUTO`/`GATED`, the refusal vocabulary, the untrusted fence, bounded output, the per-origin budget |

`inject.js` decides no policy. It lists what the page registered and runs what it is told to run,
once the input fits the tool's own schema.
Whether a tool is `AUTO` or `GATED` is decided by the surface's gate and by the catalog behind it
(README §3.3, ADR 0004): a page cannot argue itself out of `GATED`, and neither can a model.

## Envelope

Every message is a plain structured-clonable object carrying the namespace and a direction,
delivered with `window.postMessage(msg, location.origin)`:

```js
{ __ns: "athena-webmcp", dir: "to-page" | "to-ext", id, ... }
```

- `__ns` is `"athena-webmcp"`. Anything without it is not ours and is ignored.
- `dir` is `"to-page"` for a request and `"to-ext"` for a reply or an event. `inject.js` listens
  for `to-page` only and posts `to-ext` only, so the two can share one window without looping.
- `id` correlates a reply with its request. It is opaque to the page: the relay mints it and is
  the only party that interprets it. `id: null` marks an unsolicited event.

Two guards run before any message is read, and both are load-bearing:

| Guard | Rejects |
|---|---|
| `event.source === window` | a message from an iframe — a frame is not the page |
| `event.origin === location.origin` | a message from any other document |

`inject.js` also installs nothing at all when it finds itself in a frame (`window.top !== window`),
so an advertisement in an iframe cannot register tools that reach the surface.

## Requests (surface → page, `dir: "to-page"`)

| `type` | Fields | Answer |
|---|---|---|
| `list` | — | `{ ok: true, page, tools }` |
| `call` | `name`, `input` (object, may be omitted), `timeout_ms` (optional) | `{ ok: true, output }` or `{ ok: false, reason?, error, errors? }` |

An unknown `type` is answered `{ ok: false, reason: "validator_failed", error: "Unknown request
<type>" }`. A `call` for a name the page has not registered is answered `{ ok: false, reason:
"unknown_ref", error: "No tool named <name>" }`, the reason the catalog gives for a name it does
not hold. A `call` whose `input` fails the tool's own `inputSchema`, as the tool publishes it at
the moment of the call, is answered `{ ok: false, reason: "validator_failed", error: "<name>:
<problem>" }` and the tool never runs. The check is the gate's subset (`check_schema`,
`src/athena/core/validators.py`) and is never stricter than it: a keyword outside the subset is
ignored and a malformed schema is not a refusal here. An omitted `input` is `{}`. A throw inside the tool becomes `{ ok: false, error }` with no `reason`: that is the
tool's own outcome, not a refusal by the bridge.

A tool's rejection may carry two coded fields of its own (ADR 0146), which is how the demo kit's
execute door reports a call it refused or stopped rather than one it ran:

- `reason`, forwarded only when it is one the page can honestly mint about its own door:
  `"validator_failed"`, `"timeout"` or `"cancelled"`. Any other value, a gate's `"user_denied"`
  above all, is dropped and the reply carries no `reason`: a page cannot claim a decision it
  does not make.
- `errors`, an array of `{ path, code, message }` (at most 32), every mismatch the page's door
  found, addressed by argument path (`stage`, `rows[0].z`). Additive: a relay that does not read
  it loses nothing, because `error` already says it in a sentence.

What a tool RESOLVES is always `{ ok: true, output }`, including a domain answer whose text says
`{"ok":false,...}` (an area that does not exist, with the ones that do): a domain answer is an
answer, and only a rejection is a failed call. Every `reason` this half sends is a member of
`REFUSAL_REASONS` (gate.js), and `error` is always the human sentence. A refusal is a result,
never a dropped promise, because a relay with a pending entry that never clears is a surface that
hangs.

### `page`

The page's identity, from the `athena:app` meta tags it publishes about itself:

```html
<meta name="athena:app" content="ledgerbox">
<meta name="athena:app-name" content="Ledgerbox">
<meta name="athena:app-version" content="1.4.0">
<meta name="athena:app-manifest" content="/.well-known/athena-manifest.json">
```

| Field | From |
|---|---|
| `origin`, `href`, `title` | the document |
| `app_id` | `athena:app` — the slug the catalog namespaces tools under (`host.<app_id>.<name>`) |
| `app_name` | `athena:app-name` — what the surface shows a person |
| `app_version` | `athena:app-version` |
| `manifest` | `athena:app-manifest`: `{ source: "url", url }` when the tag is a location, `{ source: "inline", value }` when it is JSON, `null` when it is absent or unparseable |
| `transport` | `"webmcp-native"` when the browser had `document.modelContext` first, `"webmcp-polyfill"` when `inject.js` supplied one |
| `deprecated_navigator` | whether `navigator.modelContext` (the deprecated location) is present |

A page can say what it likes here, so none of it is trusted: `app_id` names the tools and the
flags below are read as a *claim*. A page's meta tag never opens a permission — that decision
belongs to the user's origins table (ADR 0063). An origin with no row there is a first sight: the
surface names its app in `gated_origins` on every turn, and the daemon's gate files a card for
each of its tools whatever the claim says. Registering the origin is what makes the claim count.

### `tools`

Each entry is `{ name, title, description, inputSchema, annotations, athena }`, sorted by name so
an unchanged registry produces an unchanged manifest. `annotations` are the standard WebMCP hints
(`readOnlyHint`, `consequentialHint`). `athena` is the non-standard README §3.3 block —
`{ reversible, side_effects }` — which the polyfill carries through and a native implementation
drops; when it is absent the surface falls back to the annotations, and unknown is `GATED`.
The class the flags imply is the class only on an origin the user registered, and even there a
tool the user pinned `GATED` is sent in `gated_tools` and files a card. On first sight every tool
is `GATED`. A pin never loosens a class, so an `AUTO` or `READ` pin is never sent (ADR 0063).

## Replies and events (page → surface, `dir: "to-ext"`)

A reply repeats the request's `id` and carries the answer's fields at the top level:

```js
{ __ns: "athena-webmcp", dir: "to-ext", id: "1757500000000-3", ok: true, output: "12 invoices" }
```

`output` is always a string. A tool that returned a WebMCP content array is flattened to its text
parts, anything else is JSON, and `null`/`undefined` is `""`. Bounding and fencing that text is
the surface's job, not the page's: what arrives here is exactly what the tool said.

The one unsolicited message is the change notification:

```js
{ __ns: "athena-webmcp", dir: "to-ext", id: null, type: "toolchange" }
```

It is posted whenever the registry moves — `registerTool`, `unregisterTool`, or a native
implementation's own `toolchange` event — and carries no payload: the surface re-runs `list` and
rebuilds the manifest. `id: null` is how a relay tells an event from a reply, since no pending
request can match it.

### Late answers

The second unsolicited message is additive: the envelope, the two guards and every reply above are
unchanged, and a relay that does not know it ignores it as an event no request matches.

```js
{ __ns: "athena-webmcp", dir: "to-ext", id: null, type: "late", call: "3:41-9f…", ok: true, output: "sent" }
{ __ns: "athena-webmcp", dir: "to-ext", id: null, type: "late", call: "3:41-9f…", ok: false, output: "", error: "smtp down" }
{ __ns: "athena-webmcp", dir: "to-ext", id: null, type: "late", call: "3:41-9f…", ok: false, output: "", reason: "cancelled", error: "aborted: the caller stopped waiting" }
```

`inject.js` keeps the promise it raced against the deadline. When a call it already answered
`timeout` settles after all, it posts `late` once, naming the request in `call` and carrying the
answer rendered exactly as a reply's `output`, or a rejection's `reason` and `errors` under the
same rules as a reply's. A call that had no `id` gets none. A timeout means
"no answer yet", not "did not happen": a write that finishes late has still happened (ADR 0101).

A relay places `late` only for an id it issued to that tab and saw time out recently, either the
page's `timeout` reply or its own timer, and only once. The desktop relay keeps up to 16 such ids
per tab for 10 minutes and emits `bridge:late` `{ tab_id, name, ok, output, error?, late_ms }`;
a `late` naming any other id is dropped.

## Timeouts

Two, layered, so a page that never answers cannot wedge the surface:

| Where | Value | Effect |
|---|---|---|
| `inject.js`, per `call` | 30 s, or `timeout_ms` when the relay asked for less | the call is raced against an `AbortController`; the answer is `{ ok: false, reason: "timeout", error }` |
| the relay, per request | 35 s | the pending entry is dropped and the caller is told the page did not answer |

`timeout_ms` is clamped into `1 … 30000`: the relay may shorten the page's deadline and can never
extend it. The abort is passed to the tool as `options.signal`, but the *race* is what guarantees
the reply — a tool that ignores its signal and never settles must not be able to hold the surface
open. `"timeout"`, `"unknown_ref"` and `"validator_failed"` are the refusal reasons this half
mints, `"cancelled"` is one more it forwards from a tool's own door, and each is a member of the one vocabulary the ledger stores (`ERROR_REASONS`,
`src/athena/contracts/harness.py`). The surface records a `timeout` on any call that is not a
read (reversible with no side effects) as `outcome_unknown`, because the call may have run, and
posts the tool's `late` answer if it comes.

The relay's window is deliberately the longer of the two, so the page's own abort wins and produces
a real error; the relay's timer only covers a page that is gone, frozen, or has no bridge at all.

## No bridge

A page may have frozen its globals before the injection ran — sealed `document.modelContext`, a
non-extensible `window`. `inject.js` installs nothing in that case and throws nothing: there is no
message listener, so `list` never answers, and the surface shows a page with zero tools rather
than an error in someone else's application. The same silence covers a frame and a page whose
`window.top` is unreachable. See ADR 0008.

## The surface's half

`gate.js` is the other side of the same conversation and never runs in a page. It is a plain ES
module with no DOM, so the answers below are covered by `node --test` and are the same answers on
every surface.

| Export | Answers |
|---|---|
| `flagsOf(tool)` | what the page claimed: the `athena` block, else the standard annotations, else unknown |
| `classify(flags)` | `AUTO` only when reversible and the side effects stay inside the app; otherwise `GATED` |
| `decide(tool, overrides)` | the class for this origin — a stored override may tighten `AUTO` to `GATED` and is refused when it tries to loosen |
| `manifestOf(page, tools)` | the README §3.3 host manifest, shaped for `HostManifest.from_dict` |
| `REFUSAL_REASONS` | the closed refusal vocabulary, frozen |
| `fence(text, label, nonce)` | the page's text, wrapped so it cannot close the block from the inside |
| `bounded(items, limit)` | at most `limit` items, with `(showing N of M)` iff some were cut |
| `Budget.take(origin)` | one call claimed, or a `budget_exhausted` refusal naming the origin and the ceiling |

The order for anything a page said is **bound, then fence**: the markers and the preamble are the
fence's own and are not part of what was bounded. Both markers are neutralised inside the body
first, whatever nonce they carry, because a surface may hold one nonce for a whole session and a
previous turn's prompt can reach a page through a tool that echoes its input.

Three of these are ports, and the Python is the authority: `classify` is
`HostTool.default_class` (`src/athena/contracts/manifest.py`), `REFUSAL_REASONS` is `ERROR_REASONS`
(`src/athena/contracts/harness.py`), and `fence` is `wrap_untrusted` (`src/athena/core/fence.py`).
`tests/test_refusal_parity.py` reads this package and fails when a declaration drifts. See ADR 0009.
