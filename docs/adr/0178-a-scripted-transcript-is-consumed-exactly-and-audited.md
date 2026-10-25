# 0178. A scripted e2e transcript is consumed exactly, and the harness audits it

Date: 2026-10-25

## Context

The e2e suite spawns `tests/e2e/serve_scripted.py`, whose engine replays a recorded transcript in
the child process (ADR 0007). A round the script lacks raises `TransportError` there, and the CLI
harness turns that raise into a turn that ends `engine_error`; the HTTP reply is still a 200
stream ending in `turn.finished`. Nothing ever carried the raise back to the test, so a test that
asserted only a `tool.result` frame passed on a broken turn, and a test that scripted a round no
turn spent was never told either.

ADR 0041 made a refused op cost one more round. Measured on the tree at this date with the audit
below: 2 of 40 e2e tests overdrew their transcript behind a green run (the vault-on connector test
and the revoke-then-retry journey, both on the pre-0041 count), and 2 more scripted a round that
no turn could reach (a refused-before-the-stream turn and a read-only playbooks claim).

## Decision

1. **Every provider invocation is recorded.** `serve_scripted.py` installs `RecordingTransport`, a
   `ScriptedTransport` that writes `{index, available, served}` to
   `ATHENA_HOME/scripted/asked.ndjson` before replaying, so an overdraft still ends the turn as
   before and the record is the witness that crosses the process boundary.
2. **Exact is the default.** The `spawn` fixture's teardown fails a test unless each scripted
   daemon was asked for exactly the rounds its transcript holds, naming the round overdrawn
   ("round 2 was asked for; the script has 1") or left ("round 2 of 2 was never asked for"). The
   audit is read before the daemons are stopped and raised after, so a failing check never leaves
   a process behind.
3. **The opt-out is explicit.** `Spawn.scripted(..., exact=False)` is the one greppable way to
   over-supply on purpose. A test that runs no turn scripts no round.
4. **A turn can state its spend.** `Daemon.run(message, rounds=n)` checks the delta of the record
   across that one turn, so an added turn cannot hide a moved count behind a total that still adds
   up.

Production code is untouched; the seam is still the transport factory `wiring.build_local` takes.

## Consequences

- The next change to the round loop fails, by name, in each test whose transcript it invalidated.
- A test that fails midway also fails its teardown on the rounds it never reached; the call-phase
  failure stays the first one reported.
- Tests that over-supplied must now say so or shrink; none here needed `exact=False`.
