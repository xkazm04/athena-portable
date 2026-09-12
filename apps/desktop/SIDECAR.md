# The daemon sidecar

How `athena serve` becomes a process this shell owns, and how it is made to go away. Implements
README section 3.1 (surfaces) and the "orphaned daemons" row of section 3.5. The Rust is
`src-tauri/src/daemon.rs`; the decisions behind it are ADR 0015.

**The shell proxies nothing.** Rust mints the token, spawns the daemon, reads its one ready line
for the URL, polls `/health` until it answers, and hands `{url, token}` to the `chrome` webview.
From c22 the panel calls `/manifest`, `/run` and `/decisions/<id>` over loopback itself, exactly
as a browser extension would.

## The argv contract

```
athena-daemon[.exe] \
  --port 0 \
  --token-file <appdata>/daemon.json \
  --brain <appdata>/brain \
  --engine <claude_code | codex | api> \
  --allow-origin http://127.0.0.1:1431 \
  --allow-origin http://localhost:1431 \
  --allow-origin http://tauri.localhost \
  --allow-origin tauri://localhost
```

`serve_args` in `daemon.rs` is the authority and `daemon::tests::the_arguments_are_the_contract_in_sidecar_md`
holds this table to it.

| Flag | Why the shell passes it |
|---|---|
| `--port 0` | the kernel picks a free port, so two shells (or a shell beside a hand-run daemon) never fight over 17490. The bound port comes back on the ready line — never guess it. |
| `--token-file` | **not `--token`.** The shell writes 32 random bytes as hex into that file first and the daemon reads them back (`resolve_token` in `daemon/server.py`). argv is inherited, logged and screenshotted; a path is not a secret and a token is. Owner-only where the platform has modes. |
| `--brain` | this shell's own brain directory under app data. A brain is portable by copying. |
| `--engine` | from settings (c21); changing it restarts the daemon. The shell starts on `claude_code` before anything has been configured. |
| `--allow-origin` | repeatable; the four `UI_ORIGINS` in `daemon.rs`. The dev server in both spellings of loopback, because a browser treats `127.0.0.1` and `localhost` as different origins, and the two shapes the Tauri asset protocol takes. **1431**, this shell's Vite port, not Tauri's 1420 default. |

The daemon still binds `127.0.0.1` and still wants the token on every route, `/health` included.
CORS is the browser's fence; the token is ours. Neither flag loosens the other.

## The ready protocol

The daemon prints exactly one JSON line on stdout, flushed, after the socket is bound and before
it serves (`src/athena/daemon/ready.py`):

```json
{"ok": true, "url": "http://127.0.0.1:51057", "token_file": "…/daemon.json",
 "engine": "claude_code", "brain": "…/brain"}
```

The shell:

1. reads stdout line by line and parses each one. Three outcomes, not two — the ready line, an
   `{"ok": false, "reason": …, "detail": …}` refusal, and **a line that is not the protocol at
   all** (a `uv` diagnostic, a banner). Only the first two latch; latching on a stray line would
   mask the real ready line printed after it and report a working daemon as broken;
2. bounds the wait at **20 s**. A timeout is a typed error (`SidecarError::ReadyTimeout`) shown in
   the status, not a hang — and it does **not** kill the child, because a cold `uv run` resolving
   an environment legitimately takes longer than that. The reader keeps reading, so a late ready
   line still promotes the status to `ready`;
3. takes `url` from the line. This is the whole point of `--port 0`;
4. polls `GET <url>/health` with `X-Athena-Token` until 200, giving up at 20 s. A 401 ends the
   poll immediately: the daemon is up and does not accept this token, which waiting cannot fix;
5. emits `daemon:status` at every step, to the `chrome` webview only — the payload carries the
   token, and a page webview is whatever site the user navigated to.

`health` is four states rather than a `ready` boolean: `stopped`, `starting`, `ready`, `failed`.
"Not ready" is three different sentences and the panel shows a different thing for each.

## Exit hygiene

The first build left twenty-four daemons behind after one evening. Two things had gone wrong.

**Killing the child is not enough.** A PyInstaller one-file binary is a bootloader that unpacks
itself and runs the real interpreter as a *child*; `uv run athena serve` likewise runs Python as a
child. So the shutdown is staged, and the last stage takes the tree:

1. close the child's stdin. The daemon has no shutdown route yet, so EOF is the politest signal
   there is; a daemon that learns to watch stdin needs no change on this side;
2. 150 ms of grace, so a daemon that *did* leave on its own is reaped rather than force-killed;
3. `taskkill /PID <pid> /T /F` (Windows) or `pkill -P` plus `Child::kill` (elsewhere).

This runs on window close, on app exit, and before every respawn. It is idempotent, because all
three can happen in a row.

**Some exits never reach our code at all** — Ctrl-C on `tauri dev`, a panic, `taskkill /F`, Task
Manager. On Windows the child is therefore put in a **job object with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`** at spawn time. The job's only handle belongs to the shell
process, so however the shell dies the kernel closes it and terminates everything in the job —
including the grandchildren, which is what catches the bootloader's interpreter. That guarantee
is the OS's rather than ours, which is the only kind that survives a hard kill.
`daemon::tests::closing_the_job_takes_the_whole_tree` pins it against a real two-process tree.

## Build

```bash
uv sync --extra build                      # PyInstaller lives in its own extra, not in `dev`
uv run python scripts/build-sidecar.py     # ~10 s
```

Output: `apps/desktop/src-tauri/binaries/athena-daemon-<target-triple>[.exe]`.

- The **target triple** is the Rust *host* triple, from the `host:` line of `rustc -vV`, with a
  small table off `platform` when there is no rustc and `--target-triple` overriding both. Tauri's
  `externalBin` resolves a sidecar by appending the triple and strips it when it bundles, so the
  suffix is load-bearing: without it the binary is not found.
- The **entry** is `scripts/sidecar_entry.py`, which calls `athena.cli.main(["serve", …])`. The
  whole binary is `athena serve`; the subcommand is prepended, not accepted, so nothing that
  spawns it can point it at `doctor` or `brain`.
- **Not committed.** `.gitignore` drops `src-tauri/binaries/athena-daemon-*`; this script is the
  committed part. Rebuild after any change under `src/athena/` — a frozen binary does not follow
  the working tree. In daily development, don't: use the dev fallback below.
- One triple per build, on that platform. There is no cross-compilation.

`externalBin` is declared in **`src-tauri/tauri.bundle.conf.json`**, an overlay, and not in
`tauri.conf.json`:

```bash
pnpm tauri build --config src-tauri/tauri.bundle.conf.json
```

`tauri-build` fails the *build script* when a declared external binary is missing, in `tauri dev`
as much as in `tauri build` — so putting it in the main config would make a PyInstaller run a
precondition of opening the window, which is exactly the inner loop the dev fallback exists to
avoid. Verified by hand: with `externalBin` in `tauri.conf.json` and no binary built, `pnpm tauri
dev` stops at `failed to run custom build command for athena-desktop`.

## Dev fallback

With no binary in `binaries/` and none beside the executable, the shell runs the repository:

```bash
uv run athena serve --port 0 --token-file <path> --brain <dir> --allow-origin <ui origins…>
```

from the repository root, with the same argv and the same ready protocol. This is the normal
inner loop: edit `src/athena/`, restart the shell, no PyInstaller run.

**Debug builds only.** `uv run` resolves and executes the target project's own dependencies and
entry point, so the fallback is safe only where the repository it finds is known to be ours. A
release build that has lost its sidecar refuses with the build instructions rather than running
whatever project sits above its working directory with a live token in hand. The root is found
from the executable's ancestry before the working directory's, and a directory qualifies only if
it holds both `pyproject.toml` and `src/athena/cli.py` (`is_athena_checkout`, pinned by two
tests). To run a *built* exe against a checkout on purpose, set `ATHENA_DEV_FALLBACK=1`.

## Verified

| What | How | When |
|---|---|---|
| the ready-line parser: ok, refusal, garbage before the line, nothing inside the bound | `cargo test` (`daemon::tests`) | every run |
| the argv contract, including "the token is never on argv" | `cargo test` | every run |
| `/health` carries the token and the status code is read | `cargo test`, against a real loopback socket | every run |
| `KILL_ON_JOB_CLOSE` takes a two-process tree within a second | `cargo test` (Windows only) | every run |
| the store reduces `daemon:status` | `pnpm test` (`src/stores/daemon.test.ts`) | every run |
| the dev fallback comes up: ready line, `/health` 200, the engine in the status store | **by hand**, `pnpm tauri dev` | walked 2026-09-12 |
| a staged shutdown on window close leaves no daemon behind | **by hand**, `Get-Process` before and after | walked 2026-09-12 |
| a hard `taskkill /F` of the shell leaves no daemon behind | **by hand**, `Get-Process` before and after | walked 2026-09-12 |

## Troubleshooting

| Symptom | Cause |
|---|---|
| `failed to run custom build command for athena-desktop` right after a config change | `externalBin` is declared but no binary is built. It belongs in the bundle overlay, not `tauri.conf.json`. |
| Tauri says the external binary is missing when bundling | the file is there but the triple in its name is not the one Tauri resolved. Compare with `rustc -vV`. |
| the status says `no ready line from the daemon within 20s` | usually a cold `uv run` resolving an environment. It is not fatal — leave it; the status flips to `ready` when the line lands. |
| the status says `the daemon refused this shell's token` | something else is already listening on that URL, or the token file was replaced between the write and the read. |
| `{"ok": false, …}` on the first line | the engine's CLI is not on PATH *for the spawned process*. A GUI app on Windows does not inherit a shell's PATH edits. |
| a CORS error in the panel | the webview's origin is not one of `UI_ORIGINS`. Check the exact origin, scheme and port included. |
