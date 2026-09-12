# The bridge protocol

Implements README §3.4 tier 1: *the page's own WebMCP tools, through `inject.js` and the relay*.
This directory is the source of truth for what runs in a page's main world; every surface —
the desktop shell's page webviews, an extension's content script — injects the same file and
speaks the same messages.

| File | Where it runs | Job |
|---|---|---|
| `inject.js` | the page's main world, at document start | polyfill `document.modelContext`, answer `list` and `call`, post `toolchange` |

`inject.js` decides nothing. It lists what the page registered and runs what it is told to run.
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
| `call` | `name`, `input` (object, may be omitted), `timeout_ms` (optional) | `{ ok: true, output }` or `{ ok: false, error }` |

An unknown `type` is answered `{ ok: false, error: "Unknown request <type>" }`. A `call` for a name
the page has not registered is answered `{ ok: false, error: "No tool named <name>" }`. A throw
inside the tool becomes `{ ok: false, error }`: a refusal is a result, never a dropped promise,
because a relay with a pending entry that never clears is a surface that hangs.

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
belongs to a record the user controls.

### `tools`

Each entry is `{ name, title, description, inputSchema, annotations, athena }`, sorted by name so
an unchanged registry produces an unchanged manifest. `annotations` are the standard WebMCP hints
(`readOnlyHint`, `consequentialHint`). `athena` is the non-standard README §3.3 block —
`{ reversible, side_effects }` — which the polyfill carries through and a native implementation
drops; when it is absent the surface falls back to the annotations, and unknown is `GATED`.

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

## Timeouts

Two, layered, so a page that never answers cannot wedge the surface:

| Where | Value | Effect |
|---|---|---|
| `inject.js`, per `call` | 30 s, or `timeout_ms` when the relay asked for less | the call is raced against an `AbortController`; the answer is `{ ok: false, reason: "timeout", error }` |
| the relay, per request | 35 s | the pending entry is dropped and the caller is told the page did not answer |

`timeout_ms` is clamped into `1 … 30000`: the relay may shorten the page's deadline and can never
extend it. The abort is passed to the tool as `options.signal`, but the *race* is what guarantees
the reply — a tool that ignores its signal and never settles must not be able to hold the surface
open. `"timeout"` is the only refusal reason this half mints, and it is a member of the one
vocabulary the ledger stores (`ERROR_REASONS`, `src/athena/contracts/harness.py`).

The relay's window is deliberately the longer of the two, so the page's own abort wins and produces
a real error; the relay's timer only covers a page that is gone, frozen, or has no bridge at all.

## No bridge

A page may have frozen its globals before the injection ran — sealed `document.modelContext`, a
non-extensible `window`. `inject.js` installs nothing in that case and throws nothing: there is no
message listener, so `list` never answers, and the surface shows a page with zero tools rather
than an error in someone else's application. The same silence covers a frame and a page whose
`window.top` is unreachable. See ADR 0007.
