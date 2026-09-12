# The shell

One window (README section 3.1): a thin module bar, the selected module at full width, and one
page webview per tab on a shared browsing profile. The browser is a module among the others
(ADR 0013); `src-tauri/src/layout.rs` owns every rectangle.

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

## The smoke (c19)

`scripts/smoke.mjs` is the relay's end-to-end proof and the one thing `pnpm test` cannot be: it
needs WebView2, a Rust toolchain and a window.

```bash
node scripts/smoke.mjs                  # serves scratch/webmcp-page.html, runs `pnpm tauri dev`
node scripts/smoke.mjs --binary src-tauri/target/debug/athena-desktop.exe
node scripts/smoke.mjs --url https://example.test/  # a real site instead of the scratch page
node scripts/smoke.mjs --timeout 900    # a cold Rust build on a slow machine
```

It asserts one line:

```
[smoke] tab 1: ok=true tools=3 transport=webmcp-polyfill
```

Which is to say: `packages/athena-bridge/inject.js` ran in the page webview before the page's own
scripts, the page answered `list` over `window.postMessage`, the forwarder carried the answer back
through `bridge_reply` — the only command a page webview may call — and the relay matched it to the
request waiting on its id. `scratch/webmcp-page.html` is the page it serves: three tools, one of
which throws on purpose.

A first run compiles the Rust crate, which takes minutes. That is expected; `--timeout` is there
for it.
