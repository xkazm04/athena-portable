# 0182. A failing e2e test carries its daemons' own account

Date: 2026-10-25

## Context

Every daemon in `tests/e2e` is a subprocess. Its stdout and stderr were piped and, after the
ready line, never read again: the daemon's `[daemon] ... raised` lines were discarded, and a
child that wrote enough to stderr would block on a full pipe (measured: a stand-in that writes
200 KB before serving never answered `/health`). The `spawn` fixture's teardown kills every
daemon, so by the time pytest printed a failure the only witnesses - the live `/ledger`, the fake
providers' request log, the stderr - were gone. And a turn that broke arrives as a 200: the CLI
harness turns an engine failure into a ledger `error_reason`, so the assert that fails
(`assert results == [...]`) is usually several steps from the cause.

The ready-line failure path had a race of its own: when the child died at once, stdout's EOF
reached the reader before the exit code existed, and the failure read
`exit code None; stderr: ''` - the one case it exists to explain, explained as nothing.

## Decision

1. **Stderr is drained from spawn time** by `forensics.StderrTail`, a reader thread into a tail
   bounded twice: the last 200 lines and at most 16 KB of text. The ready-line failure keeps its
   message, `no ready line within Ns (exit code C); stderr: '<last 2000 chars>'`, now taken from
   the tail after a short wait for the exit code, so a child that died at once is reported with
   its code and its words.
2. **One section per daemon, on a failed call phase only.** The `spawn` fixture stashes its
   spawner on the test item; a `pytest_runtest_makereport` hookwrapper, when the call phase
   failed, attaches `athena daemon <n>` for each daemon started: argv, liveness, the transcript
   audit of ADR 0178, the ledger's last 5 rows (trigger, rounds, is_error, error_reason, and
   `turn ended <reason>` when the newest row is an error), the fake providers' last 20 requests
   and the stderr tail. It runs before teardown, so the daemons are still alive to be asked.
3. **The ledger is read through the daemon's own `/ledger` route**, with a 5 s timeout and any
   failure written into the section, never raised: a forensics reader must not replace the
   failure it explains.
4. **Redacted as the connector logs are.** The section passes through
   `athena.connectors.vault.redact` with the daemon's token as the secret, and `--token <value>`
   in argv is replaced; the fake log is rendered from a whitelist of fields (method, host, path,
   status, answered), so no header or body can ride along.
5. **Zero cost on green.** A passing test is asked nothing: no `/ledger` request, no section.

## Consequences

- A red e2e run shows the turn that broke and why without a re-run under a debugger; the
  full-pipe stall class is closed.
- A report section holds machine paths (argv, home). It is a local report, never committed.
- The stdout pipe is still not read after the ready line; the daemon writes nothing there by
  design (the ledger is the log), and a future writer would need the same drain.
- Not taken: copying a failed daemon's `ATHENA_HOME` to a kept folder for a replay by hand. It
  would hold a brain and a transcript beyond the test's life; the section is the bounded version.
