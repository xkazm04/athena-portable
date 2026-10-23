# Driving the Athena desktop app

`athena-drive.mjs` is a library and `drive.mjs` a one-command-per-call CLI (JSON on stdout) that
launch the real desktop app, or attach to one that is running, and work its UI as a person does:
the Apps register form, the companion's message box, the cards' own Approve and Decline buttons,
the Origins tab, and the browsed tabs through the shell's own commands. They suit an agent
driving Athena, a person scripting a reproduction, and the e2e suite in `../e2e/desktop/`.

## How it reaches the app

Athena is Tauri on WebView2. Started with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<n>`, her two privileged webviews
(`chrome.html`, the Main window's chrome, and `athena.html`, the companion) are CDP targets, and
Playwright attaches with `connectOverCDP`. A browsed tab is not a target: tabs run in a second
WebView2 environment (uat/env.md). So a tab is reached through the shell's commands, invoked from
the chrome page:
- `tabs_list` and `tabs_focus` for the tabs;
- `bridge_list` and `bridge_call` for the page's own WebMCP tools (no model, no gate);
- `hands_call` for the DOM hands (`page_find`, `page_click`, `page_read`, ...).

### Two transports

`launch()` uses Playwright's `connectOverCDP`. `attach()` defaults to `raw-cdp.mjs`, which reads
`/json/list` and speaks CDP to each page target over its own socket. A dev build (UI from Vite on
1431) runs a blob shared worker that WebView2 reports without a `browserContextId`. Playwright
1.63 and 1.64 assert on it from inside an event handler, which kills the process rather than
rejecting, so this cannot be caught and retried.

The raw transport covers what the driver uses:
- `evaluate`;
- a small `locator` with `count`, `isVisible`, `getAttribute`, `click`, `fill` and `press("Enter")`;
- `screenshot`.

Its clicks are real `Input.dispatchMouseEvent`s, made once the element is actionable: enabled,
topmost at its centre, and not moving. Pass `transport: "playwright"`, or set
`ATHENA_DRIVE_TRANSPORT=playwright`, to use Playwright instead.

### Pressing Approve and Decline

A press that lands just as a card arrives can be dropped. The companion's machine ignores a
decision while it still holds the previous one, or before it has counted the new card
(`companion/machine.ts`, `decide`). Pressing again is safe for the same reason, so `approve` and
`decline` press until the card shows "Sending…" or its stamp, for up to 60 s.

## Your own running Athena

```bash
pnpm drive --cdp http://127.0.0.1:9222 status
ATHENA_DESKTOP=1 ATHENA_CDP=http://127.0.0.1:9222 pnpm test:e2e:desktop
```

In attach mode the e2e:
- launches and stops nothing;
- brings Main forward when it is collapsed (`athena_open_main`);
- serves the console on a fixed port (`SHADOWRUNR_CONSOLE_PORT`, default 5193), so every run
  reuses one origin row;
- closes the tab it opened.

It leaves in that Athena:
- the origin registered and trusted;
- the conversation in her brain, which she remembers across runs ("You approved this exact call
  at 21:06...");
- its ledger rows. `run.json` keeps only this run's `host:shadowrunr` rows.

That conversation keeps growing, and her Clear empties only the panel, not the daemon's session.
So an attach run costs more each time: 2026-10-23 measured $5.68, against $1.38 for an isolated
launch of the same six tests. Use the isolated instance for repeated runs.

## An isolated instance

A second instance of the user's build shares their store, brain, daemon token file and WebView2
profile. `launch()` therefore refuses the user's identifier, and needs a build with its own
identifier. That build also loads its UI from `dist`, so it needs no dev server on 1431:

```bash
# from apps/desktop; a running dev app locks src-tauri/target/debug, so build elsewhere
echo '{"identifier":"com.athena.portable.e2e","productName":"Athena E2E"}' > /tmp/athena-e2e.conf.json
CARGO_TARGET_DIR=/tmp/athena-e2e-target pnpm tauri build --debug --no-bundle --config /tmp/athena-e2e.conf.json
ATHENA_DESKTOP=1 ATHENA_DESKTOP_EXE=/tmp/athena-e2e-target/debug/athena-desktop.exe pnpm test:e2e:desktop
```

Everything that instance writes lands under `%APPDATA%\com.athena.portable.e2e` and
`%LOCALAPPDATA%\com.athena.portable.e2e`. `stop` kills its process tree, its daemon included, and
removes both directories. It removes them only when the launch created them; a launch over
existing data is refused unless `--reuse` is passed.

Its daemon runs `uv run athena serve` from the checkout root on the engine in its store (default
`claude_code`), so a conversation spends the signed-in CLI's quota. There is no scripted engine
path in the shell. While another Athena runs from the same checkout and holds
`.venv\Scripts\athena.exe`, set `UV_NO_SYNC=1`.

## The CLI

```bash
pnpm drive launch [--exe <path>] [--start-url <url>]   # starts it, records a session file
pnpm drive ready                                         # waits for the daemon's /health
pnpm drive onboard                                       # skips the first-run wizard
pnpm drive register "http://localhost:5191/?daemon=http://127.0.0.1:7791"
pnpm drive tabs
pnpm drive tools 1                                       # what tab 1 registered
pnpm drive hand 1 page_find '{"query":"Athena"}'
pnpm drive hand 1 page_click '{"ref":"ref_1_...","expect":"Athena"}'
pnpm drive retrust localhost:5191                        # Origins: Disable then Enable
pnpm drive say "Where are we?"                           # waits until she answers or asks
pnpm drive cards                                         # cards and sheets, pending flagged
pnpm drive approve apr_...                               # or sheet:<id>; waits for the turn
pnpm drive transcript
pnpm drive shot athena out.png
pnpm drive stop
```

`--cdp http://127.0.0.1:9222` attaches to any instance started with a CDP port, the user's own
included; `stop` never touches an instance this tool did not launch. `status` and `daemon <route>`
never return the daemon token: the request is made inside the page. `eval <chrome|athena> <js>`
is an escape hatch for inspection, and it can read anything the page can.

## What the companion looks like to a driver

- **Collapsed:** the seal button `.aw-seal`. Pressing it opens the ledger.
- **Ledger open:** a rail (`[data-tab=talk|record|origins]`), and in Talk the
  `[role=log][aria-label=Conversation]` holds:
  - `.msg.msg-you` and `.msg.msg-athena` messages, with the speaker in `.msg-who`;
  - a `ul.acts[aria-label="What ran"]` list after each of her messages;
  - cards (`article.slip[data-card]`) and batch sheets (`article.slip[data-sheet]`) that carry
    their own `[data-act=approve|decline]`.
- **Card-forward ("waiting on you"):** one slip in front and no log. The window's own
  `button[data-act=approve|decline]` sit outside the article.

`showAthena`, `cards`, `transcript` and the decisions handle all three states.
