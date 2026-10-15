# 0109. A CLI round ends in a typed exit, and a gone thread is reseeded once

Date: 2026-10-15

Amends the CLI harness of [0007](0007-engines-are-configuration.md) and the shared round loop of
[0031](0031-a-token-factory-modelfn-is-a-third-engine-behind-the-same-gate.md); builds on
[0006](0006-two-output-prompt-composer.md) (a resumed session keeps the system prompt it was
opened with). README section 3.1.

## Context

The `Transport` port yielded a CLI's stdout lines and nothing else. `SubprocessTransport` piped
stderr and never read it, and used the exit code only to decide whether to kill the child. So:

- every CLI failure read the same ("the CLI reported an error and stopped");
- a CLI that exited non-zero with no output was told to the person as "the CLI exited cleanly and
  produced no text";
- a stream that stopped after some text and before its result record was a successful answer;
- a session id, once bound for `--resume`, was released only when the static half changed. A
  thread the CLI had pruned ("No conversation found with session ID") or one too long to continue
  ("Prompt is too long") failed every later turn of that conversation, and the conversation id is
  per app, so for the daemon's whole life.

## Decision

1. **The exit crosses the port beside the lines, not among them.** `Transport.run` still yields
   `str` only, so the adopt legs and their fakes, which read lines and nothing else, are untouched.
   Each `CliRequest` carries an `ExitHandle` (excluded from the request's equality) that starts at
   `ExitStatus(returncode=0, stderr_tail="")`. A transport that knows how its run ended reports it
   there after the last line; one that does not leaves it at exit 0, which is what its lines always
   meant. `SubprocessTransport` drains stderr as it is written (a full stderr pipe would otherwise
   block the child, and its stdout would never end) and keeps the last 4 KiB. `ScriptedTransport`
   takes `exits={invocation index: ExitStatus}`; an invocation it does not name exits 0, so every
   recorded transcript and every daemon fixture is unchanged.

   Making `run` yield its lines and then an `ExitStatus` was the first shape considered. It was not
   taken: every consumer that wants only lines would have had to learn to skip the last item.

2. **The dialect classifies; the harness acts.** `CliDialect.classify(status, outcome)` returns
   `None` only when the CLI exited 0 *and* wrote a result record that is not an error. Anything
   else is one closed class: `gone`, `poisoned`, `auth`, `limit`, `transient` or `unknown`, by the
   first match in the dialect's dated, lowercased signature table, read from the stderr tail and a
   failed result record's subtype and text. `Decoded` keeps those two only for a failed record (on
   success `result` is the reply). The harness now reads every round to its end, because the exit
   is reported after the last line.

3. **Fixed sentences only.** Each class has one sentence (`FAILURE_SENTENCES`); `unknown` names the
   exit code ("the CLI stopped before it finished (exit code 137)", or "reported an error and
   stopped" when a failed result record arrived). A CLI's error text can quote the request, so none
   of it reaches a `TurnError` detail or a ledger row. Every class is the existing ledger reason
   `engine_error`; no contract changes.

4. **A gone or poisoned thread is released and the round reseeded once.** When a *resumed* round
   classifies as `gone` or `poisoned`, `CliHarness` drops the conversation's session id and asks
   the same round again, unresumed: the static half as `--system-prompt-file` and the whole turn so
   far on stdin, which is what the first round of a conversation sends. The frame's recall is the
   reseed that exists by construction. The second answer is final whatever it says, because it
   resumed nothing, so one round makes at most two requests. Every other class keeps the thread
   bound, so a busy service or a reached limit does not cost the conversation its thread. `codex`
   never resumes, so it is never retried.

## Consequences

- A conversation whose thread was pruned or overfilled recovers in the turn that found it.
- The person is told which of a few things happened (sign in, wait for a limit, try again), or the
  code of an exit nobody recognised, and never a CLI's own words.
- A crash halfway through a reply is no longer streamed as an answer, and an empty failure is no
  longer called a clean exit.
- The signature tables are dated (claude 2.x, codex 0.x, as of 2026-10). A reworded message falls
  to `unknown`: still a failure, with its exit code, but without the reseed or the specific
  sentence. The tables are the place to update.
- A reseeded round's billed usage counts both invocations in the turn's row: both were billed.
- Rollback: reverting the classification commit restores the old behaviour over the new port;
  reverting the transport commit as well removes the handle. No stored state, schema or contract
  changes.
