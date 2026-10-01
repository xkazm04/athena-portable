# env - how to reach a known start state (the per-app file)

## Stack and recipe
Windows 11, Tauri 2 (WebView2), Vite dev server on 127.0.0.1:1431, Python daemon sidecar spawned by the shell.
The debug binary loads its UI from the dev server, so **the dev server must be up first**.

```bash
cd apps/desktop && pnpm dev                      # serve 1431 (reuse if already up)
cd src-tauri && cargo build                      # debug binary
# L2 start state: fresh store + a CDP port into WebView2
ATHENA_STORE=<tmp>/fresh.sqlite WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 \
  ./target/debug/athena-desktop.exe
```
`ATHENA_STORE` points the shell at a throwaway store (first launch = `settings.onboarded` absent).
Delete the file to repeat first launch. `ATHENA_START_URL` opens a tab at launch.

## Windows and how to see them
Two windows: `main` (webview `chrome` + one `page-*` webview per tab) and `athena` (one webview). CDP lists ONLY `chrome.html` and
`athena.html`. **A browsed tab is not a CDP target** (measured, run 2026-10-01-r1): reach it through the shell's own commands
(`tabs_list`, `tabs_focus`, `bridge_call`) via `invoke(chrome, ...)`. Hidden webviews still run and can be driven over CDP. Real pixels: screenshot the screen and crop to the window rect (a transparent
window has no pixels of its own; `driver/crop.ps1`).

## Fixtures the Characters need
- fresh store (J1); an onboarded store (J2-J5): run J1 first or write `settings.onboarded=true`.
- real fixture ids (the README's INV-118 does NOT exist in ledgerbox): invoice numbers are `LB-2026-xxxx` but the page tools take ids `inv_xxxx`
  (e.g. inv_0002 Northwind-sized, inv_0029 Kestrel Labs, inv_0058 Ironwood, disputed). Ledgerbox keeps a fixed demo clock.
- the example hosts: `pnpm dev:ledgerbox` (3001), `dev:hirelane` (3002), `dev:tidycrm` (3004).
- a decision card: one real, GATED turn on ledgerbox through the user's own Claude CLI (spends their
  subscription; every action is gated so nothing executes). No scripted-engine path exists in the shell (the
  daemon has `--transcript`, the sidecar launcher does not pass it): **fixture gap, see accepted-gaps if closed.**
- engine: Claude Code present on this host; Codex absent (priya's arm is read from the engine probe).

## Residue
Every L2 run records what it wrote (settings rows, tabs, approvals) in `runs/<id>/RESIDUE.md`.

## Driver rules learned (run 2026-10-01-r1)
- `athena_show` / a tray show moves the OS foreground to her; never use it as cleanup in a run that measures focus.
- A second origin of the same app takes tab focus and turns on the first are then refused (`foreign_origin ... no manifest`). Focus the right tab first.
- Daemon HTTP from the chrome page: `fetch(url + route, { headers: {"X-Athena-Token": token} })` with `daemon_status` giving `url` and `token`
  (never log the token). `/decisions` returns `{ok, pending:[...], showing, total, footer}`.
- A real-engine turn takes 12 s to 5 min; poll with a predicate and a long timeout. Windows' foreground lock stops a spawned Notepad taking focus.
