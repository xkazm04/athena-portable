# The daemon

One Athena on `127.0.0.1`, beside whatever page is open. The engine, the brain, the gate and the
ledger live in this process; a surface — the shell's panel, a browser extension, `curl` — connects
to it over HTTP and speaks JSON.

Implements README §3.2 and §3.5. The decisions behind it are ADR 0003 (one writer, a read handle
per read), ADR 0010 (the lane holds no gated executor), ADR 0011 (threaded, `Connection: close`,
the token on every route), ADR 0012 (one turn is one SSE stream of channel events) and ADR 0019
(voice is a WebSocket on the same port, and a transport around the same lane).

## Routes

| Route | What it does | Lock |
|---|---|---|
| `GET /health` | engine, model, brain, uptime, sessions, tool count, the pending inbox | read |
| `POST /manifest` | merge one page's capability manifest, whole or not at all | writer |
| `POST /run` | one turn, streamed as Server-Sent Events | writer, for the turn |
| `POST /decisions/<id>` | the user's answer; replays the gate and returns `execute` | writer |
| `GET /decisions` | the pending inbox, bounded | read |
| `GET /ledger?limit=` | recent model invocations, newest first, bounded | read |
| `GET /ledger/rollup?by=` | spend and errors summed on one dimension | read |
| `GET /playbooks?origin=` | the procedurals the brain has distilled about one origin | read |
| `GET /voice` + `Upgrade: websocket` | the voice channel: PCM16 in, events and audio out | writer, per turn |

Every route requires `X-Athena-Token`, including `/health`; the one exception is the CORS
preflight, which carries no body and reads nothing. Every response says `Connection: close`.
Every bounded read carries an honest `showing` / `total` / `footer`, and every one is served off
`Brain.read_connection()` — so they answer while a turn holds the writer lock.

A refusal is always one shape: `{"ok": false, "reason": ..., "detail": ...}`, where `reason` is a
member of `contracts.harness.ERROR_REASONS`.

## The stream

`POST /run` answers `text/event-stream`. One channel event is one frame: `event:` carries the
event's own `kind` and `data:` carries the whole event as one line of JSON (ADR 0012).

```
event: text.delta          what the model said
event: tool.call           a call the gate allowed; the page runs it, not the daemon
event: decision.requested  a gated call, with "tool": "athena_decision" for a panel to render
event: tool.result         what a call returned, or why it was refused
event: turn.summary        the ledger row this turn wrote, mirrored
event: turn.finished       the last frame of a good turn
event: turn.error          the last frame of a bad one; reason is from the closed set
```

There is no `Content-Length`: the closed connection is the end of the body. The last frame is
`turn.finished` or `turn.error`, always.

## One gated turn end to end

This is the sequence that proves the whole gated path over HTTP, with a **scripted engine** —
no `claude` binary, no network, no login. Run it from any empty directory; it writes a
`demo-brain/` and a `demo-engine/` there.

### 1. Start a daemon whose engine is a recording

```bash
python - > ready.json <<'PY' &
import json, pathlib
from athena.daemon.ready import announce, ready_line
from athena.daemon.server import DaemonConfig, bound_url, make_server
from athena.harness.transports import ScriptedTransport
from athena.wiring import build_local

REPLY = (
    "I will need your approval for that.\n"
    'OP: {"op":"propose_action","action":"host.invoices.pay",'
    '"params":{"invoice":"7"},"rationale":"the invoice the user named"}'
)
ROUND = [
    json.dumps({"type": "system", "session_id": "demo"}),
    json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": REPLY}]}}),
    json.dumps({"type": "result", "is_error": False, "total_cost_usd": 0.04,
                "usage": {"input_tokens": 1840, "output_tokens": 96}}),
]

local = build_local(
    brain_root=pathlib.Path("demo-brain"),
    engine="claude_code",
    model="scripted",
    transport=lambda dialect: ScriptedTransport([ROUND]),
    workspace=pathlib.Path("demo-engine"),
)
config = DaemonConfig(port=17491, token="demo-token")
server = make_server(local.daemon, config)
announce(ready_line(url=bound_url(server, config), token_file=None,
                    engine=config.engine, brain=str(local.brain.root)))
try:
    server.serve_forever()
finally:
    server.server_close()
    local.close()
PY

sleep 2 && cat ready.json
export ATHENA=http://127.0.0.1:17491 TOKEN=demo-token
```

```json
{"ok": true, "url": "http://127.0.0.1:17491", "token_file": null, "engine": "claude_code", "brain": ".../demo-brain"}
```

The ready line is printed after the socket is bound and before anything is accepted, so a parent
that has read it knows the port is already listening. `build_local` is the same composition root
`athena serve` uses; only the transport differs (ADR 0007).

### 2. The page registers itself

```bash
curl -s -X POST "$ATHENA/manifest" -H "X-Athena-Token: $TOKEN" \
  -H 'Content-Type: application/json' -d '{
  "app_id": "invoices",
  "page_origin": "https://invoices.example",
  "tools": [
    {"name": "chase", "description": "Draft a chase note.",
     "reversible": true, "side_effects": "internal",
     "params_schema": {"type": "object", "properties": {"invoice": {"type": "string"}}}},
    {"name": "pay", "description": "Pay an invoice.",
     "reversible": false, "side_effects": "external",
     "params_schema": {"type": "object", "properties": {"invoice": {"type": "string"}}}}
  ]
}'
```

```json
{"ok": true,
 "tools": [{"name": "host.invoices.chase", "class": "AUTO", "origin": "host:invoices", "tier": 1},
           {"name": "host.invoices.pay",   "class": "GATED", "origin": "host:invoices", "tier": 1}],
 "showing": 2, "total": 2, "footer": "",
 "app_id": "invoices", "origin": "https://invoices.example",
 "registry_origin": "host:invoices", "conversation_id": "conv_invoices"}
```

`chase` is `AUTO` and `pay` is `GATED`, and neither is a preference the page expressed: the class
falls out of the manifest's own `reversible` and `side_effects` flags (README §3.3).

### 3. One turn, which proposes the gated call

```bash
curl -sN -X POST "$ATHENA/run" -H "X-Athena-Token: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"message": "pay invoice 7", "origin": "https://invoices.example"}'
```

```
event: text.delta
data: {"kind": "text.delta", "text": "I will need your approval for that."}

event: tool.call
data: {"call_id": "turn_bf71…_00", "kind": "tool.call", "name": "host.invoices.pay", "origin": "host:invoices", "params": {"invoice": "7"}, "tier": 1}

event: decision.requested
data: {"action": "host.invoices.pay", "decision_kind": "approve", "id": "apr_0f4ed49f9446", "kind": "decision.requested", "options": [{"id": "approve", "label": "approve"}, {"id": "decline", "label": "decline"}], "origin": "host:invoices", "params": {"invoice": "7"}, "rationale": "the invoice the user named", "surface": "panel", "tool": "athena_decision", "expires_at": "…"}

event: tool.result
data: {"call_id": "turn_bf71…_00", "error": "pending_approval", "kind": "tool.result", "name": "host.invoices.pay", "ok": false, "output": "host.invoices.pay is gated; approval apr_0f4ed49f9446 is waiting on the user", "tier": 1, "truncated": false}

event: turn.summary
data: {"cost_usd": 0.04, "engine": "claude_code", "input_tokens": 1840, "kind": "turn.summary", "model": "scripted", "output_tokens": 96, "rounds": 1}

event: turn.finished
data: {"kind": "turn.finished", "text": "I will need your approval for that.", "tts": null}
```

Nothing was paid. The gate filed an approval row and the call came back refused
`pending_approval`; the card rides on the same frame that names `athena_decision`, which is what a
panel renders (ADR 0012).

### 4. The card is in the inbox

```bash
curl -s "$ATHENA/decisions" -H "X-Athena-Token: $TOKEN"
APR=$(curl -s "$ATHENA/decisions" -H "X-Athena-Token: $TOKEN" \
      | python -c 'import json,sys; print(json.load(sys.stdin)["pending"][0]["id"])')
```

```json
{"ok": true,
 "pending": [{"id": "apr_0f4ed49f9446", "action": "host.invoices.pay", "params": {"invoice": "7"},
              "rationale": "the invoice the user named", "options": ["approve", "decline"],
              "origin": "host:invoices", "conversation_id": "conv_invoices", "surface": "panel",
              "created_at": "…", "expires_at": "…"}],
 "showing": 1, "total": 1, "footer": ""}
```

The inbox *is* the approval table, not a second list kept beside it. The row outlived the turn and
survives a restart.

### 5. The user answers, and the page is told what to run

```bash
curl -s -X POST "$ATHENA/decisions/$APR" -H "X-Athena-Token: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"choice": "approve", "origin": "https://invoices.example"}'
```

```json
{"ok": true, "id": "apr_0f4ed49f9446", "status": "approved", "choice": "approve",
 "conversation_id": "conv_invoices",
 "execute": [{"call_id": "turn_3f08…_exec", "name": "host.invoices.pay",
              "params": {"invoice": "7"}, "origin": "host:invoices", "tier": 1,
              "approval_id": "apr_0f4ed49f9446"}],
 "output": "",
 "events": [{"kind": "decision.resolved", "id": "apr_0f4ed49f9446", "choice": "approve", "by": "user", "at": "…"},
            {"kind": "tool.call", "call_id": "turn_3f08…_exec", "name": "host.invoices.pay", "params": {"invoice": "7"}, "origin": "host:invoices", "tier": 1}]}
```

The gate was replayed with the approval id and `describe` proved the grant covers this action with
these parameters. `output` is empty because a host tool has no executor anywhere in this process:
the page runs it on `execute`, and the answer comes back in the next turn's `tool_results`
(ADR 0010). Sending `{"choice": "decline"}` instead answers `"status": "declined"` with
`"execute": []`, and writes a ledger row of zero rounds carrying `user_denied`.

### 6. Read it back

```bash
curl -s "$ATHENA/ledger?limit=3"            -H "X-Athena-Token: $TOKEN"
curl -s "$ATHENA/ledger/rollup?by=origin"   -H "X-Athena-Token: $TOKEN"
curl -s "$ATHENA/playbooks?origin=host:invoices" -H "X-Athena-Token: $TOKEN"
curl -s "$ATHENA/health"                    -H "X-Athena-Token: $TOKEN"
```

```json
{"ok": true, "rows": [{"row_id": 1, "turn_id": "turn_bf71…", "engine": "claude_code", "model": "scripted", "conversation_id": "conv_invoices", "origin": "host:invoices", "surface": "panel", "trigger": "cli", "rounds": 1, "input_tokens": 1840, "output_tokens": 96, "cost_usd": 0.04, "is_error": false, "error_reason": null, "created_at": "…"}], "showing": 1, "total": 1, "footer": ""}
{"ok": true, "rollup": [{"key": "host:invoices", "turns": 1, "errors": 0, "rounds": 1, "input_tokens": 1840, "output_tokens": 96, "cost_usd": 0.04, "ms": 1}], "showing": 1, "total": 1, "footer": "", "by": "origin"}
{"ok": true, "items": [], "showing": 0, "total": 0, "footer": "", "origin": "host:invoices"}
{"ok": true, "engine": "claude_code", "model": "scripted", "brain": ".../demo-brain", "uptime_s": 24.651, "sessions": 1, "tools": 6, "pending": {"showing": 0, "total": 0, "footer": ""}, "routes": ["GET /health", "POST /manifest", "POST /run", "GET /decisions", "GET /ledger", "GET /ledger/rollup", "GET /playbooks", "POST /decisions/<id>"], "sockets": []}
```

`playbooks` is empty and says so honestly: a fresh demo brain has had no sleep cycle, so nothing
has been distilled about this origin yet. The inbox is empty now that the card was answered.

Stop the daemon with `kill %1`, and delete `demo-brain/` and `demo-engine/` to start over.

## The voice socket

`GET /voice` with `Upgrade: websocket` is the same door with the same token: from the header, or
— for a browser page that cannot set one — as the subprotocol `athena-token.<token>`, which the
server echoes. An `Origin` CORS would not allow is refused with `foreign_origin`. It exists only
when the daemon was started with a voice backend (`--voice-backend auto` finds one whose key is
in the environment; `none` starts without it), and `/health` lists it under `sockets` (ADR 0019).

**The client sends** text frames of JSON and binary frames of audio:

```
{"type": "start", "origin": "https://…", "host_state": {…}, "project_id": ""}   the key went down
<binary>  PCM16, mono, little-endian, 16 kHz, for as long as it is held
{"type": "stop"}                                                                the key came up
{"type": "text", "text": "…", "origin": "https://…", "host_state": {…}}          typed, no microphone
{"type": "tool_result", "call_id": "…", "name": "…", "ok": true, "output": "…", "error": null, "tier": 1}
```

**The server sends** every channel event of the turn as one text frame — exactly the JSON `/run`
puts on an SSE frame, `"tool": "athena_decision"` on a card included — plus the voice family, and
audio as binary frames of a 4-byte big-endian generation number followed by PCM16 at the rate
`voice.speaking` named:

```
{"kind": "voice.transcript", "text": "what is overdue", "final": true}
{"kind": "text.delta", …}  {"kind": "tool.call", …}  {"kind": "decision.requested", …}  {"kind": "turn.finished", "tts": "Two are late.", …}
{"kind": "voice.speaking", "generation": 1, "text": "Two are late.", "truncated": false, "sample_rate": 24000}
<binary>  0x00000001 + PCM16 …
{"kind": "voice.stopped", "generation": 1, "reason": "done"}          or "barge_in", or "error"
```

What an utterance *is* is decided before it is a turn. A stop word ("stop", "never mind") spoken
over a reply cancels playback and starts no turn. "approve", "decline", "yes", "no" or an option's
own label, while a card is waiting, answers the card on top through the same path as
`POST /decisions/<id>` — the model never sees the word — and any `execute` comes back as a
`tool.call` for the page. Everything else is a message, and its turn is the ordinary one: the
ledger row says `surface = voice`, `trigger = voice`, and nothing else differs.

A `tool.call` with a host origin and no `tool.result` behind it in the same turn is the page's to
run; the client answers with `tool_result` and the turn continues on the answers, bounded at
eight. A gated call arrives as a `tool.call` refused `pending_approval` and a card — nothing runs.
The spoken line is the reply's `TTS:` first line, else its text cut to 1,200 characters and
announced with `(showing N of M)`. A new `start` over a reply, or a partial transcript arriving
over one, is a barge-in: playback stops at its next chunk and `voice.stopped` says `barge_in`
for the generation to drop.

`python -c "from athena.channels.voice import connect; …"` is a client with no shell; the tests in
`tests/channels/` are the reference for one.

## The real thing

```bash
athena doctor                       # six stages; only a `fail` sets the exit code
athena serve --port 0               # the ready line names the bound port and the token file
athena brain reconcile              # rebuild index.sqlite from the markdown tree
```

`athena serve` composes the same daemon with the user's own `claude` or `codex` CLI behind it, and
mints or reads the token from `$ATHENA_HOME/daemon.json`. Everything above is unchanged except
that the model is really thinking.
