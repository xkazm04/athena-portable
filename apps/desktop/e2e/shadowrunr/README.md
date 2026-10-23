# Athena drives Shadowrunr, end to end

This suite boots both systems, pairs them, lets Athena work the Shadowrunr console through
the WebMCP tools it publishes, and runs the example use cases against real files. The console
side is described in overlord's `docs/guide/athena.md`.

## What it boots

| Piece | How |
|---|---|
| Shadowrunr daemon | The built binary (`SHADOWRUNR_BIN`), run as `shadowrunr --config <scratch>/shadowrunr.toml daemon --scripted --port 0`. The port comes off its ready line. |
| Its config | `shadowrunr.example.toml` copied, with `[paths]` rewritten. `characters` is a temp copy of the overlord checkout's `characters/`. `data` is an empty temp dir. `runs` is a temp dir that holds a copy of the main checkout's `runs/sandbox` and one small tournament (`pilot-d1ef98d3a6`) under `runs/sim/`. `policy`, `sim` and `segments` stay on that checkout and are read only. The daemon's cwd is the scratch root. |
| Console | The built `apps/console/dist`, served from the test process on an ephemeral port and opened as `http://localhost:<port>/?daemon=http://127.0.0.1:<port>`. The daemon admits `http://localhost:*` only. |
| Page | Playwright Chromium (`playwright-core`). Before navigation it gets `inject.js` and a relay init script, as `examples/journey/src/relay.ts` installs them, plus `localStorage["shadowrunr.athena.drive"] = "1"`. |
| Athena | Scripted: `../support/daemon.ts` `startDaemon` over a rendered transcript. Live: `support/athena.ts` `startLiveDaemon`, which runs `uv run athena serve --port 0 --engine claude_code` with a scratch `ATHENA_HOME`, `--brain`, `--token` and `--token-file`. |
| Run loop | The shell's `src/stores/run.ts` through `setRunDeps`. `call` is the page relay. `manifest` is `manifestBodyOf` over the page's `list`. `gated` is `gatedListsOf` over an origins table in which the console's origin is registered and enabled and its current contracts are accepted (ADR 0063). |

Every process is killed as a tree, and the scratch dirs are removed, on failure too. Both
suites end by asserting that the real `characters/` did not change.

## Run it

```bash
# The gate: scripted transcripts, no quota.
pnpm -C apps/desktop test:e2e:shadowrunr

# The live pilot: four conversations on your signed-in Claude CLI (spends quota).
ATHENA_LIVE=1 pnpm -C apps/desktop test:e2e:shadowrunr
```

`ATHENA_LIVE=1` skips the scripted file and runs only the pilot, so nothing else shares the
run. In PowerShell, set it first: `$env:ATHENA_LIVE = "1"; pnpm -C apps/desktop test:e2e:shadowrunr`.

When a piece is missing (the binary, the console build, `characters/malakor` or
`runs/sandbox`), both files skip and say why. Build them first:

```bash
cargo build -p shadowrunr-daemon            # in the overlord checkout
pnpm -C apps/console build                  # in the overlord checkout
```

Environment overrides:

| Variable | Default |
|---|---|
| `SHADOWRUNR_ROOT` | `../overlord`, a sibling of this repository |
| `SHADOWRUNR_MAIN` | `SHADOWRUNR_ROOT` (its `runs/sandbox` is copied; set it when the root is a worktree) |
| `SHADOWRUNR_BIN` | `<root>/target/debug/shadowrunr(.exe)` |
| `SHADOWRUNR_CONSOLE_DIST` | `<root>/apps/console/dist` |
| `SHADOWRUNR_TOURNAMENT` | `pilot-d1ef98d3a6` |
| `ATHENA_BROWSER` | the Playwright Chromium for `playwright-core` |

## The scripted suite (`shadowrunr.e2e.test.ts`)

The transcripts in `transcripts/` use the `stream-json` shape of the other e2e transcripts.
`{{NAME}}` placeholders hold values that exist only at run time: the scratch bible's digest, the
new text, a real session id and line, and a run id. `support/athena.ts` `renderTranscript` fills
them in.

| Case | Asserts |
|---|---|
| Pairing | The `athena:app` meta is `shadowrunr`. `data-role="athena-drive"` is visible and `aria-pressed`. The relay lists the catalog. `POST /manifest` takes the shell's body, with no `problems`. The registered origin is not in `gated_origins` and pins nothing, while the same tab unregistered is first sight. |
| Orientation | `where_am_i` then `go_to`. The page hash is `#/characters/malakor/package/bible`, and the turn ends with text. |
| Review walkthrough | `list_sessions` then `open_moment` on the newest copied session. The hash is `#/review/<s>/timeline/<line>`. |
| Shape Malakor | `read_character_doc` runs, and `set_character_doc` files one card while the file has not moved. Approval returns one `execute`, the page runs it once, the scratch `bible.md` holds the new text, and a backup exists under `<data>/character-backups/malakor/`. |
| Decline | No write, no backup, no second turn, and an empty `execute`. |
| Scripted sim | `start_sim` returns a run id and the hash is `#/simulator`. |
| Opt-out | After the toggle is clicked off, the relay lists zero tools. |

## The live pilot (`shadowrunr.live.e2e.test.ts`)

Each of the four prompts is a fresh Athena daemon and conversation, and each starts on a
different page:

1. Cold orientation, on `#/segments`.
2. Review walkthrough, on `#/characters`.
3. Shape Malakor, on `#/review`.
4. Analyze sims, on `#/brain`.

**The harness approves every GATED card.** This is safe because every write lands on the
scratch copy. The characters, runs and data dir are temp copies, and the Shadowrunr daemon is
`--scripted`, so a sim or sandbox it starts is keyless. Nothing outside the scratch root is
written, and the suite asserts that the real `characters/` is unchanged.

The report goes to `out/<UTC stamp>/report.json` and `report.md` (`out/` is gitignored). For
each case it records:

- the turns (`POST /run` requests);
- every tool call, with its name, args, and ok or error;
- the hashes visited;
- the cards filed and approved;
- the final answer;
- the wall time and the `GET /ledger` totals (rows, rounds, tokens, cost).

It also records the orientation measure: the number of calls before the first content-bearing
call (anything except `where_am_i`, `app_map` and `go_to`), and whether she named a tool that
does not exist.

A live case fails only when the page never navigated, a call errored on an unknown tool, or no
final answer arrived. Everything else is reported.

The live file uses the real `fetch` with a 10 minute turn deadline, because
`../support/setup.ts` puts a 90 s ceiling on `/run` and a live round can take longer.
