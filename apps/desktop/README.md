# The shell

One window (README section 3.1): the depth console, and one page webview per tab on a shared
browsing profile. The console is one scene (ADR 0087): Athena at the surface, and Apps, Chores,
Accounts, Voice and Mind as depths you dive into and rise out of; `src-tauri/src/layout.rs` owns
every rectangle, and the stage tells it which of its two shapes the window is in (ADR 0088).

```bash
pnpm dev                 # vite alone, for the preview harness
pnpm tauri dev           # the window (compiles the Rust crate the first time)
pnpm tauri:inspect       # the same, with the source inspector on (Ctrl+Shift+L, ADR 0086)
pnpm typecheck && pnpm lint && pnpm test
pnpm perf:all            # the performance budgets, scene by scene (ADR 0089)
cd src-tauri && cargo check && cargo clippy --all-targets -- -D warnings && cargo test
```

`preview.html?scene=apps&fixture=typical&theme=dark` renders any scene against any fixture in a
plain browser with no Tauri, no IPC and no daemon (`&at=%23/apps/<app>` opens it at a depth,
`&picker=1` adds a bar to change scene, fixture and theme).

## Devices

Mind has a sixth instrument, **Devices** (`#/mind/devices`, ADR 0140). It is where this computer
meets your other computers and your phone, and it reads and acts only through the loopback
`/devices*` routes; the store (`src/stores/devices.ts`) is a mirror of `GET /devices` that follows
`GET /events` while the level is open and re-reads the list on every `pair.requested`,
`peer.changed` and reconnect.

- **This computer** - its name (rename) and the private network's state: "Not set up",
  "Signed out" or "Ready".
- **Let your phone reach Athena here** - a switch (`PUT /devices/beacon`). Turning it on opens a
  phone pairing window (`POST /devices/pairing {kind: "phone"}`) and shows the address to open on
  the phone and its code. The QR code is not drawn yet (no encoder in the app, none may be added
  as a dependency).
- **Add a computer** - "Show a code for the other computer" (`POST /devices/pairing {kind: "pc"}`)
  on one side; "I have a code" (address + code, `POST /devices/join`) on the other. The joining
  side lists its outgoing requests; once the other side approves, the pair-back request appears
  here under "Waiting for you".
- **Waiting for you** - one card per pending request. Its grant pills (talk to Athena here, answer
  approvals, share memory) show only what was asked, start ticked and can only be unticked.
  Approve wakes 1.5 s after the card first showed (`ARM_MS`; the store refuses an earlier approve
  too); Decline acts at once.
- **Your other computers** - the peers table (name, kind, grants, last seen, memory status from
  replication or "-", Revoke with no confirmation), and per computer a **Send a message** box:
  `POST /devices/<peer>/message`, then the reply read back through
  `GET /devices/<peer>/turns/<request>?from=n` until `remote.closed`. A sleeping computer reads
  "Athena on <name> is asleep. Open it there and try again."
- **Set up with Athena** - disabled ("Coming next") until the setup conversation is wired.

Her window (`stores/run.ts`) follows `GET /events` too, inside the shell only: a `remote.message`
is taken (`POST /remote/<id>/accept`) and run exactly as a typed message, on the focused page
with this computer's hands and gate, shown as "From <device>: ..." in the transcript, with
`via: {peer_id, request_id}` on every request of that exchange. A `remote.decided` (a peer
answered one of this window's cards) removes the card and runs what it released on the page,
then continues the exchange. When an exchange ends without another request (budget, Stop, no
page, a decline, an app the sender named that is not open), the window says so with
`POST /remote/<id>/end`. The composer device chip is deferred.

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
