# 0031. A Token Factory ModelFn is a third engine behind the same gate

Date: 2026-10-07

Extends [0007](0007-engines-are-configuration.md): an engine is still configuration, and the gate,
the grammar and the ledger row are still the harness's. What changes is that an engine can now be
a function rather than a binary. The round loop that `CliHarness` owned moves into a shared base,
so the function engine reuses it instead of getting a second copy.

## Context

The Proving Ground (ADR 0030) measures Athena on NVIDIA Nemotron served by Nebius Token Factory.
Nemotron runs as one row of a matrix, next to the Claude CLI, while the Proving Ground attacks
Athena's gate. That comparison means something only if the Nemotron row runs behind the same
gate, hooks, `OP:` grammar, fences and ledger row as the CLI rows. If it ran through a separate
harness, the comparison would test that harness instead of the model.

Token Factory has no CLI. It is an OpenAI-compatible HTTP API: `POST
https://api.tokenfactory.nebius.com/v1/chat/completions` with a bearer key, as the API reference
introduction shows (checked 2026-10-07). A dialect cannot describe it, because a `CliDialect`
models argv, stdin and stdout lines. `harness/ports.py` already declared the seam for this case:
`ModelFn = Callable[[ModelRequest], AsyncIterator[ModelChunk]]`, "the one function a non-CLI
engine supplies". It was exported and tested, and nothing called it.

Before this change the round loop lived inside `CliHarness.run_turn`, with the engine call inlined
as `_request` followed by `_invoke`. The two ways to add an engine were to subclass `CliHarness`,
inheriting a transport, a dialect, a prompt file and a cwd that mean nothing to an HTTP call, or
to copy the loop. A copied loop is exactly what ADR 0007 rules out: two loops are two gates.

## Decision

**The loop becomes `RoundHarness`, and an engine supplies one method.** `harness/rounds.py`
holds the turn: the prompt halves, the eight-round budget, `parse_turn`, the dispatcher through
`GateHook.run_tool`, the nonce fence around tool results, the `TurnSummary` and the one
`LedgerHook.after_turn` row. An engine implements `_round(conversation_id, static_text, history,
replies, result) -> (text, failure)`. `CliHarness` becomes `RoundHarness` plus its dialect, and its
`_round` is the old `_request` and `_invoke`, unchanged. `_turn_started` is a hook only the CLI
uses, to drop a resumed session when the static half has changed. The CLI tests pass unchanged,
and that is the test of the refactor.

**`ApiHarness` drives any `ModelFn` through that loop.** It turns the turn's history into
alternating `user` and `assistant` `ModelMessage`s. The static half goes in `ModelRequest.system`
and the frame goes in the first user message, so ADR 0006's split still holds. Text chunks
accumulate, usage chunks add tokens and cost, and an `error` chunk becomes the failure with its
reason. A `ModelFn` that raises is still a ledgered `engine_error`. The model is offered **no
provider tools**: it asks for a tool by writing an `OP:` line, exactly as a CLI does, so a single
parser reads every engine. A native `tool_call` chunk, if a provider sends one anyway, is
rendered as an `OP:` line and parsed with the rest. It meets the same gate, because nothing
reaches an executor except through the dispatcher.

**`TokenFactoryModel` is the `ModelFn`, on stdlib `urllib`.** It makes one non-streamed POST per
round, on a worker thread. It is non-streamed because the harness parses a round's text whole (an
`OP:` line is an op only once its JSON closes), so a token stream would change nothing anyone
sees. The non-streamed reply is also where `usage` reliably arrives. The port is unchanged: one
request yields `thinking`, `text`, `usage` and `done` chunks, or a single `error` chunk. A leading
`<think>…</think>` and `reasoning_content` become `thinking` chunks, which are never said, parsed
or acted on. Failures map onto `ERROR_REASONS` with no new member: 401/403/404/429/5xx become
`engine_error`, a socket timeout or 408/504 becomes `timeout`, a body that is not a Chat
Completion becomes `parse_error`, and a missing key becomes `engine_error` with no request made.

**The key is a presence, never a value.** `NEBIUS_API_KEY` is read at call time, sent in one
header, and kept out of `repr`. An HTTP failure is reported by its status only, because a
provider's error body is third-party text and may echo what it was sent. `GET /engines` reports
`nebius` as `found` if the key is set and `not_found` if it is not, and never makes a call: a
probe that spent tokens would bill the user for opening the setup screen.

**`nebius` is a third value of `ENGINES`.** `athena serve --engine nebius [--model <id>]` builds
it. `wiring.build_local` takes a `model_fn` for tests, just as it takes a `transport` for the
CLIs. The default model is the single constant `tokenfactory.DEFAULT_MODEL =
"nvidia/nemotron-3-super-120b-a12b"`, taken from Nebius's announcement of Nemotron 3 Super on
Token Factory. It has **not** been read back from `GET /v1/models` because no key was available.
The comment beside the constant says how to check it.

**Cost is an estimate from a table, or it is omitted.** `PRICES` maps a model to USD per million
input and output tokens. A known model writes `cost_usd` with `cost_estimated = true`. A model
missing from the table writes no cost at all, never 0, because a 0 would be believed. The
figures are read from Token Factory's own `GET /v1/models?verbose=true`, which carries per-token
pricing. Lightning (`LIGHTNING_MODEL`, $0.06 / $0.24) is the first rung a measured role is tried on,
and Super ($0.30 / $0.90) is the default and the escalation.

**No extra.** The engine needs nothing outside the standard library, so `pyproject.toml` gains no
`nebius` extra. An empty extra would suggest an install step that does not exist.

## Consequences

The CLI rows and the Nemotron row of the Proving Ground run through the same lines of code, from
`parse_turn` to the ledger write. A difference between rows is therefore a difference between
models, and `tests/harness/test_tokenfactory.py` makes that concrete: the same gated op files the
same card and never runs, and a timeout, a 401 or a bad body each produce one row with a reason
from the closed set and no key anywhere.

`RoundHarness` is now the class a reader opens to understand a turn, and `cli_harness.py` is
shorter and only about CLIs. `CliHarness` keyword construction is unchanged. Its positional field
order did change, because the base class's fields now come first, and no caller in this
repository constructs it positionally.

`nebius` appears in `GET /engines` and in `probe_all`. A setup screen that lists every engine
will show it as `not_found` on a machine without the key. That is accurate, but `nebius` is the
measured engine and not the daily one (ADR 0030), so the desktop shell may want to hide it. That
belongs to the shell and is not decided here.

Like a single-shot CLI, the API engine is stateless across turns. Continuity comes from the frame,
which costs more input tokens than a resumed session would, the same trade-off ADR 0007 records
for `codex`.

The fixture `tests/fixtures/tokenfactory_turn.ndjson` is synthetic and says so. A real capture
can replace it with no code change once a key exists. The live test
`test_live_one_turn_against_nemotron_super` is a `provider` test and is skipped without the key.

Amended by [0035](0035-the-nebius-engine-keeps-reasoning-on-and-can-turn-it-off.md): `TokenFactoryModel`
takes a `thinking` setting. It defaults to on, where the model reasons as served, because a live
A/B on Lightning found that turning reasoning off made empty answers more common. The opt-out is
`--no-nebius-thinking`.
