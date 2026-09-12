# The shell

One window (README section 3.1): a thin module bar, the selected module at full width, and one
page webview per tab on a shared browsing profile. The browser is a module among the others
(ADR 0013); `src-tauri/src/layout.rs` owns every rectangle. The window comes up on **Panel**,
which is spelled in three places that must agree — `layout.rs`'s `DEFAULT_MODULE`,
`src/modules/types.ts`'s `DEFAULT_MODULE_ID`, and `src/stores/shell.ts`'s initial value.

```bash
pnpm dev                 # vite alone, for the preview harness
pnpm tauri dev           # the window (compiles the Rust crate the first time)
pnpm typecheck && pnpm lint && pnpm test
cd src-tauri && cargo check && cargo clippy --all-targets -- -D warnings && cargo test
```

`preview.html?module=browser&fixture=typical&theme=dark` renders any module against any fixture in
a plain browser with no Tauri, no IPC and no daemon.

## Dev affordances

| Variable | What it does |
|---|---|
| `ATHENA_START_URL` | the page the shell opens a tab on at launch. The first non-flag argument wins over it, so a shortcut and a shell session can each have their own answer |
| `ATHENA_SMOKE=1` | after the start url's tab is open, run one `bridge_list` against it, print one line to stdout, and exit — 0 when the page answered, 1 with the reason when it did not |
| `ATHENA_SMOKE=turn` | drive one gated turn through the run store, print four lines, and exit. The panel's claim, made in the chrome webview rather than in Rust, because the run store is the thing under test |
| `ATHENA_ENGINE_SCRIPT` | a recorded transcript the sidecar hands the daemon as `athena serve --script`, so a turn replays instead of spawning `claude`. Debug builds only, or a release build that has already opted in with `ATHENA_DEV_FALLBACK` |

## The smoke

`scripts/smoke.mjs` is the shell's end-to-end proof and the one thing `pnpm test` cannot be: it
needs WebView2, a Rust toolchain, a window and — in turn mode — a Python daemon. Two modes, one
per claim, chosen with `ATHENA_SMOKE`.

```bash
node scripts/smoke.mjs                              # the relay (c19)
ATHENA_SMOKE=turn node scripts/smoke.mjs            # one gated turn, end to end (c23)

node scripts/smoke.mjs --binary src-tauri/target/debug/athena-desktop.exe
node scripts/smoke.mjs --url https://example.test/  # a real site instead of the scratch page
node scripts/smoke.mjs --timeout 900               # a cold Rust build on a slow machine
ATHENA_SMOKE=turn node scripts/smoke.mjs --script scratch/other-round.jsonl
```

Both serve `scratch/` on `http://localhost:<port>` and point the shell at `webmcp-page.html`.
`localhost` and not `127.0.0.1` on purpose: `HostManifest.validate` takes a page origin only over
https or `http://localhost`, so the dotted spelling is refused whole and the turn would never
start.

### `ATHENA_SMOKE=1` — the relay

```
[smoke] tab 1: ok=true tools=3 transport=webmcp-polyfill
```

Which is to say: `packages/athena-bridge/inject.js` ran in the page webview before the page's own
scripts, the page answered `list` over `window.postMessage`, the forwarder carried the answer back
through `bridge_reply` — the only command a page webview may call — and the relay matched it to the
request waiting on its id. `scratch/webmcp-page.html` is the page it serves: three tools, one of
which throws on purpose.

### `ATHENA_SMOKE=turn` — the panel's run loop

```
[smoke] turn: manifest tools=3
[smoke] turn: tool.call invoice_list ok=true
[smoke] turn: decision apr_8c95fa146668 declined
[smoke] turn: ledger user_denied=1
```

Four claims, which together are the whole of P5. The page's three tools reached the daemon's
catalog through `POST /manifest`. The gate let the AUTO one — `invoice_list`, reversible with no
side effects — through to the page, and the page ran it. The GATED one — `invoice_send`, which
leaves the building — became a `decision.requested` card instead, and the turn stopped on the
user. `runActions.answer(id, "decline")` resolved the row over `POST /decisions/<id>`. The decline
is on the ledger under `user_denied`, a reason from the closed set, read back over `GET /ledger`;
the count is a difference across the answer, because the brain outlives the window and every
earlier run's decline is still there.

The engine is a recorded round, not a model: `scratch/gated-round.jsonl` is replayed through
`ScriptedTransport` by `athena serve --script`, which `smoke.mjs` points the sidecar at with
`ATHENA_ENGINE_SCRIPT`. Everything else is the real thing — the real relay, the real daemon over
loopback, the real catalog, the real gate, the real approval row. `tests/daemon/test_scripted.py`
covers the flag, and checks that transcript still addresses the tools the scratch page registers.

A failing turn prints the panel's whole transcript after its claims, which is what running the
window by hand would have shown you anyway.

A first run compiles the Rust crate, which takes minutes. That is expected; `--timeout` is there
for it.
