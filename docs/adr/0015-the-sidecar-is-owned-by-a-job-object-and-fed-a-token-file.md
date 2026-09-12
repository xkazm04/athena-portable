# 0015. The daemon is spawned into a Windows job object and handed its token in a file

Date: 2026-09-12

> Numbered 0015 because 0014 was taken by another branch in the same milestone.

## Context

The shell has to run one `athena serve` per window, learn which port the kernel gave it, prove it
is answering, and — the part the first build got wrong — make sure it is gone afterwards. That
build left **twenty-four orphaned daemons after one evening**, each holding a port, a brain
directory and whatever the engine had open. README section 3.5 carries it as a day-zero decision:
the lifecycle is written and tested in the same commit that first spawns a daemon, not in a later
one about tidying up.

Two independent reasons the first build's `child.kill()` was not enough, and they need different
answers:

1. **The daemon is never one process.** A PyInstaller one-file binary is a bootloader that unpacks
   itself into a temp directory and runs the real interpreter as a child. The dev fallback,
   `uv run athena serve`, runs Python as a child of `uv`. Terminating the process the shell
   spawned leaves the actual daemon running with no parent left to stop it.
2. **Some exits never reach the shell's code.** Ctrl-C against `tauri dev`, a panic, `taskkill
   /F`, Task Manager, a debugger detaching. No `Drop`, no exit handler and no window event runs on
   those paths, so any answer written in Rust is an answer that sometimes does not execute.

A third question arrives with the token. `athena serve` accepts both `--token` and `--token-file`.
argv on Windows is readable by any process of the same user through WMI, and it is also what the
shell's own stderr, a crash report and a screenshot of Task Manager all contain.

## Decision

**The child goes into a Windows job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` at spawn
time, and the shell keeps the job's only handle.** However the shell dies, the kernel closes that
handle, and closing the last handle to such a job terminates everything inside it. A child's own
children join its job automatically, so the bootloader's interpreter and `uv`'s Python are covered
without the shell knowing either exists. This is the answer to reason 2, and it is the only one
that survives a hard kill, because the guarantee belongs to the OS rather than to our code.

**The clean exits still get a staged shutdown**, because the job is a backstop and not a design:
close the child's stdin (the daemon has no shutdown route yet; EOF is the politest signal there
is, and a daemon that learns to watch it needs no change here), wait 150 ms so a daemon that left
on its own is reaped rather than force-killed, then kill the *tree* — `taskkill /T /F`, or `pkill
-P` plus `Child::kill` elsewhere. It runs on window close, on app exit and before every respawn,
and it is idempotent because all three can happen in a row.

**The token travels in a file, never on argv.** The shell mints 32 bytes from the OS, writes them
as hex into `<app data>/daemon.json` in the shape `resolve_token` reads, owner-only where the
platform has modes and created that way rather than chmod'ed afterwards, and passes
`--token-file <path>`. A path on an inherited, logged, screenshotted command line is not a secret.

**The 20 s bound on the ready line reports and does not kill.** A timeout is a typed error the
panel renders, so nothing hangs silently — but a cold `uv run` resolving an environment, or a
frozen binary being unpacked by a scanner, legitimately takes longer, and killing a daemon that
was about to work would be worse than saying so. The reader keeps reading; a late ready line still
promotes the status to ready.

**`externalBin` lives in `src-tauri/tauri.bundle.conf.json`, an overlay, not in
`tauri.conf.json`.** `tauri-build` fails the build script when a declared external binary is
missing, in `tauri dev` as much as in `tauri build`. Declaring it in the main config would make a
PyInstaller run a precondition of opening the window and delete the dev fallback's whole reason to
exist. A bundle is built with `--config src-tauri/tauri.bundle.conf.json`.

**PyInstaller is a `build` extra, not a `dev` one.** The daily loop never freezes anything; the
shell falls back to the checkout. A twenty-megabyte toolchain has no business in the environment
CI and every contributor installs.

**Two small dependencies and no third.** `getrandom` for the token, because a guessable token is
an open daemon reachable from every page the shell drives. `windows-sys` for the job object,
because there is no portable API for it. The `/health` probe is a hand-written loopback `GET`
rather than an HTTP client: the daemon speaks HTTP/1.1 on 127.0.0.1 and answers `Connection:
close` on every response, this shell will never point the call anywhere else, and the alternative
is a TLS-capable dependency for one request whose whole job is to read a status code.

**The two commands are declared in `daemon.rs`, beside the state they read**, rather than as
wrappers in `lib.rs` like `tabs_*` and `layout_*`. Three branches were adding Rust modules to that
file at once, and the registration blocks exist so they collide on adjacent lines rather than on
one list — a module that needs exactly two lines there instead of ten is the cheapest thing to
merge. The ACL name is the function name wherever the function is declared, so `build.rs` and
`capabilities/ui.json` are unaffected.

## Consequences

There is a microsecond window between `CreateProcess` returning and `AssignProcessToJobObject`
running in which the child could start a grandchild outside the job. Closing it would mean
spawning suspended, which means giving up `std::process::Command` for raw `CreateProcess`. The
tree kill covers every clean exit regardless, and a bootloader has to unpack itself before it can
start anything, so the window is accepted and written down rather than engineered away.

On Windows the token file gets no mode, because there is none to set. The per-user app data
directory is the protection, as it is for every other credential a CLI keeps there.

The job object is process-global and deliberately never closed: closing it is exactly what kills
the daemon, so the only thing permitted to close it is process death. The unit test therefore
creates a job of its own rather than borrowing that one.

`daemon:status` carries the token, so it is emitted with `ui_emit` and reaches the `chrome`
webview alone. That is the habit `lib.rs` established in c18 for the commit where the secret
finally exists; nothing in this crate may call `app.emit`.

A restart mints a fresh token and a fresh port, so anything holding the old pair gets a 401 rather
than a stale success. The panel's store keeps the last error across a restart for the same reason:
an event says only what is true now, and "starting, after it failed" is a different thing to show
than "starting, for the first time".

What this leaves open: the daemon has no shutdown route, so stage one of the staged shutdown is
currently a no-op that costs 150 ms of grace. When `POST /shutdown` exists, it replaces the stdin
close and the grace period earns its name. And the non-Windows half of exit hygiene is a tree kill
only — there is no job object on macOS or Linux, and a process group with `setsid` is the shape
that would answer it there. Phase 1 ships on Windows.
