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

## An isolated instance

A second instance of the user's build shares their store, brain, daemon token file and WebView2
profile. `launch()` therefore refuses the user's identifier, and needs a build with its own
identifier. That build also loads its UI from `dist`, so it needs no dev server on 1431:

```bash
# from apps/desktop, in a checkout or worktree whose target is not the running app's
echo '{"identifier":"com.athena.portable.e2e","productName":"Athena E2E"}' > /tmp/athena-e2e.conf.json
pnpm tauri build --debug --no-bundle --config /tmp/athena-e2e.conf.json
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
