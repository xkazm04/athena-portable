# 0007. Engines are configuration; the gate is the same behind all of them

Date: 2026-09-12

## Context

Athena runs turns through a model, and which model is a choice the user makes at setup: their
`claude` CLI billed to a Claude subscription, or their `codex` CLI billed to a ChatGPT plan. The
plan's demo deliberately includes swapping one for the other on stage, because "same rules,
different engine" is the one-line demonstration that the model is a part of this system and not
the product.

That claim is only true if it is structural. The obvious shape — one class per engine, each
running its own loop and calling the catalog when it remembers to — makes the claim a promise
instead. Two engines that each implement the gate are two gates, and the second one is the one
that will differ: it will file a card a beat later, normalise a reason differently, or count a
turn as three model invocations and write three ledger rows for what the user saw as one answer.
The first build had one harness per provider and discovered exactly this, which is why the hooks
were pulled out of the Strands adapter there rather than designed out at the start.

There is a second question underneath it. A CLI engine has no tool-call API to bind to — it
prints text — so *something* has to define how the model asks for a tool, and that something is
easy to make per-engine as well.

## Decision

**One harness, and an engine is a `CliDialect` inside it.** `CliHarness` owns the turn: the two
halves of the prompt, the round loop, the dispatcher, the gate, the ledger row, the events.
A dialect owns three functions and no state — which arguments to pass, what goes on stdin, and
how to read one line of stdout. `CLAUDE` and `CODEX` are two values of that dataclass. Adding a
third CLI is a third value; it cannot be a third policy, because there is nowhere to put one.

**The gate is handed to the engine, never built by it.** `build_harness` takes the `GateHook`,
the `LedgerHook` and the `TruncationHook` as arguments. An engine that wanted its own would have
to be constructed by a caller that made it one, and the caller is `wiring`, which makes exactly
one of each. The `OP:` grammar sits beside them for the same reason: the calling convention is
the harness's, so both dialects are parsed by one parser with one set of repair rules.

**Eight rounds are one turn and one ledger row.** `TurnResult.rounds` carries the count. A row is
one turn's cost, not one HTTP call, because the thing a user recognises and a cost is attributed
to is the answer they asked for. A round only follows a round in which something actually
executed: a gated op is waiting on the user, a host tool is waiting on the page, and a dropped
envelope is reported in the next turn's frame — none of the three is a reason to ask the same
model the same question again inside the same turn.

**A dialect that cannot resume is told the static half every invocation.** `claude` resumes a
session, so the static blocks are written to a file and passed as the system prompt on the first
invocation of a conversation and never again; every later turn sends the frame alone. `codex exec`
is single-shot, so it gets the static half on stdin every time. This is not an exception to
ADR 0006 — nothing that can move between turns is composed into the static half either way. It is
the same rule meeting two CLIs, and the difference is a dialect flag rather than a branch in the
turn loop.

**A probe never raises, and it never claims more than it checked.** `probe` answers a setup
screen, and a setup screen that crashes because a binary is missing cannot tell the user what is
missing. Every failure is an `EngineStatus` with `available = False` and a sentence. It proves the
binary answers `--version` and nothing else: `logged_in` is the existence of the credential file
the CLI writes, never its contents, and it is `None` when there is no cheap way to tell — because
"I do not know" and "no" are different things to show someone at first launch.

**Both dialects are pinned by a recorded transcript.** `tests/fixtures/*.ndjson` hold one turn per
dialect, replayed through `ScriptedTransport`. They are synthetic — written from each CLI's
documented event shape, not captured — and each says so in its own header. They buy two things:
the whole engine is exercised with no binary, no login and no network, and a drift in either CLI's
event format becomes a red test instead of a failure on stage.

## Consequences

Swapping engines is a string in configuration, and the demo's claim is checkable rather than
asserted: the same gate test, the same ledger test and the same grammar test cover both dialects,
and `test_the_two_dialects_parse_to_the_same_turn_result` says so directly.

The cost is that `CliDialect` is a slightly awkward shape — a frozen dataclass with two abstract
methods and two subclasses that add no fields. A protocol would be tidier and would lose the
thing that makes this work, which is that `DIALECTS` is a table an engine name indexes into.

The synthetic fixtures are the weakest part of this commit and are labelled as such. They prove
the parser reads the shape the CLIs are documented to write; they are not evidence that either
binary emitted those bytes. Replacing one with a real capture needs no code change, and until
then a format drift is caught only where the fixture was right to begin with.

`codex` is not resumed. The consequence is real: its conversation continuity comes entirely from
the frame — recalled episodes and last turn's results — so a long codex conversation costs more
input tokens than the same conversation on `claude`, and remembers only what recall puts in front
of it. That is a property of a single-shot CLI, and the two-output composer is what makes it
survivable rather than broken.
