# walkthrough-operations

**When** a walkthrough runs, **write only to scratch copies, guard the real tree with a digest, prefer an
isolated Athena for repeated runs, kill every process tree and remove every scratch directory on failure
too, and keep conversations short and focused**, **because** the harness approves every card, and a
persistent conversation grows the cost of every turn.

## Scratch data

- Copy the app's writable tree (Shadowrunr: `characters/`, `runs/sandbox`, one small tournament) into a
  temp root; point the backend's config at the copies; keep read-only inputs on the checkout; run the
  backend with the scratch root as its cwd, so even a relative default cannot reach the real tree.
- Make the backend keyless where it can be (`shadowrunr daemon --scripted`), so an AUTO "start" spends
  nothing.
- Hash the real writable tree before the suite and assert it is unchanged after (`treeDigest`). This is
  what makes it safe for the harness to approve every GATED card.
- Give Athena's daemon its own scratch `ATHENA_HOME`, `--brain`, `--token` and `--token-file`, and
  `--no-connectors --voice-backend none` for the pilot.

## Processes

- Port 0 everywhere; read the bound port off the ready line.
- Kill the tree, not the child (`taskkill /T /F` on Windows; `uv run` spawns a grandchild); close the
  pipes; on failure as well as success.
- While another Athena runs from the same checkout and holds `.venv\Scripts\athena.exe`, set
  `UV_NO_SYNC=1`.

## The real desktop: launch or attach

| | Launch (isolated) | Attach (the user's own, or any instance on a CDP port) |
|---|---|---|
| How | an exe built with its own identifier (`com.athena.portable.e2e`), loads `dist`, no dev server | `--cdp http://127.0.0.1:9222`; the instance was started with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` |
| Transport | Playwright `connectOverCDP` | raw page-level CDP (`apps/desktop/drive/raw-cdp.mjs`): a dev build's blob shared worker crashes Playwright's browser-level attach |
| State | own store, brain, token file and WebView2 profiles; refuses to start over existing app data unless `--reuse`; `stop` kills the tree and removes both app-data dirs it created | the user's: the origin row, the conversation in her brain and the ledger rows stay; Clear empties only the panel |
| Cost | $1.38 to $1.96 for the 6-test desktop suite | grows per run: $5.68 for the same 6 tests |
| Use for | every repeated run | reproducing what the user sees, once |

**Rebuild the isolated exe right before each use, from a clean tree, into its own `CARGO_TARGET_DIR`**
(the running dev app locks `src-tauri/target/debug`):

```bash
echo '{"identifier":"com.athena.portable.e2e","productName":"Athena E2E"}' > <scratch>/athena-e2e.conf.json
CARGO_TARGET_DIR=<scratch>/athena-e2e-target pnpm -C apps/desktop tauri build --debug --no-bundle --config <scratch>/athena-e2e.conf.json
```

In attach mode: serve the app on a fixed port so repeat runs reuse one origin row; close only the tab
the run opened; filter the ledger to this run's rows (`created_at >= start`, `origin == host:<app>`).

## Driving her UI

- Call `athena_open_main` first: a collapsed Main window (144x19) hides the register form. A
  seal-collapsed companion needs its seal pressed before the ledger exists.
- Press Approve and Decline only when the button is actionable (present, sized, hit by
  `elementFromPoint`, not disabled, stable over 2 polls), and re-press until the card shows "Sending..."
  or its stamp, up to 60 s; extra presses are ignored once it is answered (`drive/README.md`).
- Open the app with its target hash; the driver's `register` takes the full URL.

## Cost

- A conversation is re-read on every turn: 8 focused turns of an analysis cost $18.29 (character audit,
  2026-10-24). One dimension per turn keeps her inside her per-turn step budget (up to eight provider
  rounds make one turn), but do not split further than the step budget forces.
- Each live case is a fresh daemon and conversation; a pilot of 4 cases cost $4.22 to $5.66.
- Record cost per case from her ledger (`GET /ledger`), never from estimates.

## Cleanup checklist

- Scratch roots removed (a Windows file still held is not a failure; the root is under the OS temp dir).
- No orphaned process holding a port (`netstat` for the bound ports).
- Isolated app-data dirs removed by `stop`.
- Reports kept under the run's `out/<UTC stamp>/` (gitignored), and the cited ones copied to the app's
  `.athena/verify/`.
- Worktrees removed by the operator; on Windows a long `node_modules` path may need `rd /s /q` with the
  `\\?\` prefix.

## Evidence

Every figure above is from the Shadowrunr runs of 2026-10-23/24 recorded in overlord
`.spark/Spark/ideas/athena-copilot.md` and `.spark/Spark/reports/athena-copilot/`.

## Registry

`test-harness/fixture-economics` and `live-app-harness` (drive the shipped process on built fixtures,
agrees). `eval-harness/eval-economics` (mock modes, tiered cadence: the keyless level is the per-change
gate and the quota levels are deliberate, agrees).
