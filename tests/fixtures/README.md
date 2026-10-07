# Recorded transcripts

One transcript per CLI dialect, replayed by `ScriptedTransport` so the whole engine — the two
halves of the prompt, the round loop, the gate, the ledger row — is exercised with no binary, no
login and no network. The `nebius` engine has one too, replayed by a fake HTTP layer in
`tests/harness/test_tokenfactory.py` so nothing opens a socket to Token Factory.

| File | Dialect | Shape |
|---|---|---|
| `claude_code_turn.ndjson` | `claude_code` | `claude -p - --output-format stream-json`: a `system` line carrying the session id, `assistant` lines carrying text, a `result` line carrying usage and the billed cost |
| `codex_turn.ndjson` | `codex` | `codex exec --json`: `thread.started`, `item.completed` with an `agent_message`, `turn.completed` with usage |
| `tokenfactory_turn.ndjson` | `nebius` | one non-streamed Chat Completions body per round: `choices[0].message.content` (a `<think>` prefix, text, `TTS:`, `OP:`) and `usage.prompt_tokens` / `completion_tokens` |

**All three are synthetic.** They were written by hand from each engine's documented shape, not
captured from a run, and each says so in its own first comment line. That is the honest state of
them: they prove the engines parse to the same `TurnResult` and they turn a future format drift
into a red test, but they are not evidence that any engine emitted these bytes. Replacing one
with a real capture is a strict improvement and needs no code change — keep the comment
header, and say there that it was captured.

## Format

- A line whose first non-space character is `#` is a note to the reader and is not an event.
- A blank line separates one round from the next; one file may hold several rounds of one turn.
- Everything else is one JSON object per line, exactly as the CLI writes it — or, for
  `tokenfactory_turn.ndjson`, one whole HTTP response body per line.

`rounds_from_transcript` in `athena.harness.transports` is the parser, and it is the only one.
