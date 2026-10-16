# 0118. A CLI's own sign-in check decides logged_in, where it was verified

Date: 2026-10-16

Amends [0007](0007-engines-are-configuration.md) ("A probe never raises, and it never claims more
than it checked"): its sentence "`logged_in` is the existence of the credential file the CLI
writes" now holds only below a dated version floor.

## Context

`engines.probe` answered setup's "is this CLI signed in" by checking that a credential file
exists (`~/.claude/.credentials.json` or `~/.claude.json`, `~/.codex/auth.json`). A file can be
present and the session behind it signed out, revoked or expired, so setup showed `found` and
the first turn then failed with the CLI's own "not signed in" (the `auth` class of ADR 0109).
The registry's agent-cli-transport/availability-probe names the fallacy: existence proves
nothing, and unknown must render as unknown.

Both CLIs now ship a sign-in check that spends no tokens. On 2026-10-16, on this repository's
build machine: `claude auth status --json` (Claude Code 2.1.301) prints `{"loggedIn": true, ...}`,
and `codex login status` (codex-cli 0.160.0) prints "Logged in using ChatGPT" with exit 0 or "Not
logged in" with exit 1. Each took about half a second.

## Decision

1. **The CLI's word, where it was verified.** `_STATUS_CHECKS` holds each CLI's check and the
   oldest version it was verified on. A probe whose `--version` parses at or above that floor runs
   the check and reads only its verdict: `loggedIn` for claude, the "logged in" / "not logged in"
   line and exit code for codex. The rest of the answer (an e-mail, an organisation) is dropped.
2. **Below the floor, the old guess.** A CLI older than its floor, or whose version does not
   parse, is never asked. A CLI that does not know the subcommand could take `auth status` for a
   prompt. Its `logged_in` stays the credential file's existence, as before. A floor is lowered
   only by running the check on that version.
3. **Unknown is unknown.** A check that times out, fails to start, or answers in a shape this does
   not read gives `logged_in = None`. It never gives `True`, whatever file is on disk.
4. **In the spawn's environment.** The check runs the binary the probe resolved, with no stdin,
   in `child_env(os.environ)`. These CLIs compute their auth report from the environment they are
   handed, so the probe asks in the same environment a turn's spawn gets.

## Consequences

- `GET /engines` says `not_logged_in` for a CLI that is installed and signed out, even when its
  credential file is still there. A signed-in CLI with no file where we used to look (claude on a
  keychain) now reads `found`.
- A probe on a verified CLI runs two subprocesses instead of one. That adds about 0.5 s per CLI,
  measured on the build machine. The daemon caches the answer for 10 s, as before.
- The floors are dated data in `engines.py`. A CLI that rewords its check reads as unknown
  (`found` on the wire), never as signed in or out by mistake.
- `tests/harness/test_engines.py` pins both verdicts per CLI, five unreadable answers as `None`,
  the floor (no check below it), and the environment and stdin the check runs with.
