# 0140. One Athena pairs devices over a private overlay

Date: 2026-10-24 (spark one-athena-fleet, WP1)

Builds beside [0003](0003-disk-is-truth-one-writer-many-readers.md) (disk is truth, one writer),
[0011](0011-the-daemon-is-threaded-closes-every-connection-and-checks-the-token-everywhere.md) (the loopback daemon, its
token on every route) and the connector seal law (`connectors/seal.py`: a copy never carries a
credential). Later sections of this record are appended by WP2 (replication), WP3 (remote composer)
and WP4 (phone web app and setup leg) under **Decision**.

## Context
Athena runs on several of one person's Windows PCs and should be one Athena on all of them, and
reachable from a phone that may be on another network. Each device is a full Athena with its own
brain. Before memory can replicate or a message can be sent into another device's panel, two
devices have to come to trust each other, and something has to listen for them.

The loopback daemon cannot be that something. It binds `127.0.0.1` and nothing else
(`daemon/server.py`, `DEFAULT_HOST`; there is no `--host` flag), and its one shared token is the
window's. Opening it to a network would put that token, every route and the CORS fence in front
of every machine on the WiFi.

The device-pairing standard in the registry asks for: a human approval in the granting device's own
chrome as the only mint gate; tokens born bound, scoped and expiring, claimed once, stored as a
fingerprint; admission scoped by address class *before* auth; and a listener that is off until
trust exists. `pyproject` has `dependencies = []` and the standard library cannot make
certificates, so the transport cannot be TLS of our own.

## Decision

### Transport and its trust statement
All peer traffic rides a private overlay of the Tailscale class - WireGuard between devices the
person signed into one tailnet - including two PCs on the same WiFi (the overlay goes direct on a
LAN). The overlay is the encryption and the device authentication of the transport: a packet from
`100.64.0.0/10` or `fd7a:115c:a1e0::/48` was sent by a device in the person's tailnet. Athena does
not add its own transport encryption and says so; what it adds is *per-device* admission inside
the tailnet, because "in my tailnet" is not "may talk to my Athena". There is no mDNS, no LAN
listener and no plaintext on the LAN.

### A second listener, overlay only, up only while needed
A separate `ThreadingHTTPServer` in the daemon process (`athena.peer.listener`), on port **17491**
(`--peer-port`; `--no-peer` turns the whole peer surface off). It binds the overlay interface's own
IPv4 address, read from `tailscale ip -4` (state from `tailscale status --json`), and nothing else.
It is bound only while at least one live peer row exists, a pairing window or an unclaimed approval
is open, or the beacon is on, and closed when none holds; a lifecycle tick every 2 s reaps expired
rows and windows and reconciles. With no overlay (`absent`) or a logged-out one (`logged_out`) it
stays down and `GET /devices` says which.

### Admission: the address first, then the token, then the grant
- `verify_request` classifies the remote address before a handler exists. Only `overlay` passes
  (IPv4-mapped IPv6 is unwrapped first); the home LAN, link-local and the public internet get one
  fixed bodiless 403 and a closed socket, with nothing read. Loopback is admitted only on a listener
  built with `admit_loopback`, which only tests set.
- A request presents `Authorization: Bearer <token>`. The SHA-256 is compared
  (`compare_digest`, every row, no early exit) against `peers.json`. An unknown token is a 401
  whatever the path, so a stranger cannot map the routes.
- Each peer route names its grant (`chat`, `approve`, `memory`) and the handler checks it at one
  door: `403 {"error": "grant_missing", "grant": ...}`. Refusals keep the daemon's one shape
  (`ok`, `reason` from `ERROR_REASONS`, `detail`) and add the peer's finer `error` word.
- A request with an `Origin` other than the listener's own is refused (`foreign_origin`): the
  only browser page that may call it is its own phone page.

### Identity and files
- `$ATHENA_HOME/peer/device.json` `{device_id, name, created}`, `dev_` + 12 hex (a new id kind in
  `contracts/ids.py`; a peer's id *is* the remote device id, so there is no `peer` kind; a phone is
  minted a `dev_` id by the device that approves it). The name defaults to the computer's name.
- **The peer directory is under `athena_home()` (`$ATHENA_HOME`, else `~/.athena`), not beside
  `--brain`.** The shell passes `--brain <app data>/brain` and a token file there, while a headless
  `athena serve` uses `~/.athena`; the vault and the voice studio already resolve through
  `athena_home()`, which the shell does not override. A device is the install, not the brain:
  rooting identity beside the brain would give one machine two identities depending on how it was
  started, and a brain copied to another machine would carry this machine's identity with it.
- `peers.json` rows are exactly `{peer_id, name, kind, grants, token_sha256, created, expires,
  last_seen}`, written whole (temp, fsync, replace). The token's plaintext is never on disk; an
  unreadable file is moved aside and admits nobody. `last_seen` is written at most once a minute.
- The tokens this device calls *out* with are sealed by the OS seal the connectors use (DPAPI on
  Windows), one per peer; where each peer listens is in `reach.json`. Nothing in `peer/` is ever
  plaintext credential, and nothing in it is in the brain.
- Nothing is written until something pairs: a daemon nobody pairs with leaves no `peer/` directory.

### The pairing ceremony
- `POST /devices/pairing {kind}` (loopback, the person's own window) opens a window: a `pair_` id,
  a 128-bit nonce, a 6-character code from an alphabet without 0/O/1/I/L, TTL 300 s. The phone's QR
  is `http://<overlay-ip>:17491/m/#claim=<pairing_id>.<nonce>` - the nonce is in the fragment, so
  it never reaches a request line or a log.
- `POST /peer/pair/request` (address-gated, no token) files the window's **one** pending record,
  by `{pairing_id, nonce}` or `{code}`, and returns a `claim_secret`. A repeat from the same
  requester may refresh a pending record; nothing resets a resolved one; a second requester with
  only the code gets `window_taken`. Five wrong codes, nonces or secrets close the windows they
  could have been aimed at. A PC sends its own `device_id`; a phone sends `null`.
- `POST /devices/pending/<pairing_id> {choice, grants, expires_days}` is the **only mint door**.
  Grants may only narrow what was requested. Approval mints a 256-bit token, files the row with its
  fingerprint, and holds the plaintext in memory until the claim. An approval not claimed within
  300 s expires and its row is removed.
- `POST /peer/pair/claim` returns `{token, peer_id, device_id, name, pair_back}` exactly once; the
  code path must present the `claim_secret`, so watching a code being typed is not enough. A
  second claim is `410 claim_spent`, logged by pairing id only.
- **Pairing back (two human approvals).** When the claimer is a PC, `pair_back` is
  `{device_id, name, requested_grants}`: the granting PC asks to be let in in return, with the
  grants its person just gave. The claiming PC (`POST /devices/join` started it; its tick polls the
  claim) files that as a pending record of its own, which *its* person approves or declines in
  *its* chrome. On approval it **delivers** the token it minted to the asking PC
  (`POST /peer/pair/back {token, port}`, authenticated with the token it just claimed; the reach
  address is taken from the connection, not the body), retrying on the tick until the record's
  15-minute TTL. This replaces the brief's "the asker claims it on its next `/peer/hello`": the
  asker has no token to call `hello` with yet, and a push authenticated by the first pairing proves
  who is delivering without a second secret held for minutes.
- `DELETE /devices/<peer_id>` revokes at once (no confirm): the row and the sealed outbound key
  go, and the next request with that token is a 401.

### What never crosses
Approvals, the ledger, sessions, connectors and their sealed secrets, voice installs and the
loopback token stay on the device. No peer route returns a token except the one claim; no event
payload carries a token, a nonce or a claim secret.

### The route seam
Later packages add peer routes as `PeerRoute`s from their own modules
(`host.add_routes(<module>.peer_routes(host))`, one line in `wiring._wire_peer`), loopback routes on
`daemon.routes`, events through `host.publish`, larger bodies through `host.body_caps`
(the peer default cap is 64 KiB).

### Memory replication (WP2)

**What replicates.** Only the write-once kinds: episodes, facts and procedurals. No rewrite path exists
for them (`core/brain/store.py`), so a copy can never be stale: a device either has a memory byte for
byte or does not have it yet. That makes this a pull of files, not a sync protocol. Goals, cases and
cadence rituals are rewritten in place and stay on their device until v2 (versioned LWW).
Reflections, cycles, the backlog, `index.sqlite` and `brain/.peer/` never leave. Approvals, ledger,
sessions, connectors and sealed secrets were already device-local (see "What never crosses").

**The device stamp.** A brain built with a device writes `device: "dev_<12 hex>"` as the **last** key
of every new episode, fact and procedural, after `every_turn` (the ADR 0071 precedent). A brain with
no device omits the key and writes the bytes it always did. A legacy file has no key and reads as
"unknown" (`store.device_of`). The daemon passes the brain a callable, not a value: it returns this
install's id once `$ATHENA_HOME/peer/device.json` exists, so remembering something never mints an
identity (`wiring._device_stamp`). The stamp is kept on disk only. `companion_node` has no column it
fits (`machine` means chatter, not a host), no query reads it, and a column would mean a schema
migration with no reader. So a rebuild has nothing to restore and loses nothing.

**Wider episode ids.** New episodes are minted `ep_` + **12** hex, the width every other kind uses
(`contracts/ids.py`, `ID_SUFFIX_HEX`). At 32 bits, two devices writing a few thousand episodes each
reach the birthday bound in one shared id space. `is_id` also accepts the older widths listed in
`ID_ACCEPTED_HEX`, which for episodes is `(12, 8)`. Every 8-hex id on disk stays valid, because facts
cite them and renaming one would orphan every claim that does. Any other reader of the brain tree
(the Personas Rust code) must accept both widths. That repo was not touched here.

**Serving** (peer listener, grant `memory`):
- `GET /peer/brain/manifest?since=<iso>&after=<id>` returns
  `{items: [{id, kind, created, sha256, path}], next, next_after, truncated}`. Items come oldest
  first by `(created, id)` from the index, with the sha computed over the bytes on disk, at most 500
  per page. `next`/`next_after` mark where the next page starts, or are `null` on the last page.
  That is the truncation announcement. `after` breaks ties within one stamp, so a page that is all
  one instant still moves on. A row whose path is not one this brain's writer would have chosen, or
  whose file is missing, is left out.
- `GET /peer/brain/file?id=<id>` returns the file exactly as on disk (`text/markdown`), or
  `404 not_found` for anything that is not a replicated kind.

**Pulling.** A device pulls a peer when it granted that peer `memory` and holds a sealed key for it
(`PeerKeys`). The peer's own grant is the peer's decision: a 401 or 403 is recorded as `not_shared`
and nothing more. A pass reads the manifest from the cursor, at most 40 pages. It applies episodes
first, then facts and procedurals, each through `Brain.receive_file`. That call checks the path
against the brain's own layout (traversal, foreign directories and other kinds are refused), runs
the same provenance gate as every writer, writes the sender's bytes with the atomic writer
(ADR 0080), and indexes them with `reconcile.index_file`, the rebuild's own per-file step. A rebuild
over a merged tree therefore reproduces the same rows. Outcomes:
- same id, same sha: skipped;
- same id, different sha: the local file stays. The remote copy goes to
  `brain/.peer/conflicts/<id>.<peer_id>.md`, is counted, and is logged by id. A write-once id with
  two bodies is a fault for a person to look at, never something to settle by guessing;
- a fact or procedural citing an episode that is not here yet: deferred to the next pass and never
  written with a dead source;
- a fetch that fails, or bytes that do not match the manifest sha: retried on the next pass.

**The cursor.** `brain/.peer/cursors.json` (`{peer_id: iso}`) holds the newest `created` the pass
saw, held back to the oldest item it could not finish, minus **10 minutes** for clock skew between
PCs. Re-reading that margin is harmless because an id already present is skipped. The cursor follows
`created`, so a memory that reached peer B late from a third device C, carrying an old stamp, is not
picked up through B. It arrives from C directly, which is the v1 fleet shape: every PC paired with
every PC.

**When.** A thread subscribes to the peer host's event bus. It pulls once at start, again on every
`peer.changed` (a pairing completed, a key arrived), and every 60 s between. It ends when the bus
closes, i.e. on `PeerHost.close()`. Passes never overlap.

**Status.** `GET /devices` peer rows gain `memory`:
`{last_pull_at, pulled, conflicts, deferred, state}`, where `state` is one of `ok`, `not_shared`,
`unreachable`. The value is `null` until the first pull. `pulled` counts since the daemon started.
`conflicts` is counted from the files in `brain/.peer/conflicts/`, which are the record.

**Consequences.**
- A brain is still portable by copying. Received files sit at their writers' paths, `brain/.peer/`
  is outside the walked tree, and `reconcile_from_disk` over a merged tree is idempotent (tested).
- Provenance holds across devices: a received claim cites episodes that are live in the receiving
  brain, or it waits.
- A peer can read every write-once memory of a brain that granted it `memory`. The grant is the
  boundary, and the approve surface is where a person narrows it.
- Wire time is bounded per pass (40 pages × 500 items, a 5 s timeout per call, a 4 MiB cap per file).
  First contact with a large brain therefore takes several passes, and the cursor carries the
  progress between them.

### Remote composer (WP3)

A message from a phone or another PC is not a remote hand: it is a
message into this device's panel. Peer `POST /peer/message {text, target_app}` (grant `chat`,
text refused past 8000 characters) files a remote turn under a `job_` id and offers it to the
window as `remote.message` on the loopback `/events` bus, re-published every 0.5 s for up to 3 s.
The window takes it with `POST /remote/<id>/accept`; if nobody does, the answer is
`409 window_closed` with this device's `name`, and the asker says "Athena on <name> is asleep".
Offering-until-accepted replaces "is anyone subscribed": the `/events` stream ends every 15 s of
quiet and reconnects a second later, so a subscriber count is wrong one second in fifteen and a
message published then would be lost silently.

The window runs the message as a typed one and sends `via: {peer_id, request_id}` on every
`POST /run` of that exchange. `/run` hands `via` to `AthenaDaemon.via_tee`, which copies each
event of the run (the same JSON `/run` streams) into the turn's buffer; `via` changes nothing
about the session, the context or the gate, and a `via` naming no accepted turn of that peer tees
nothing and fails nothing. The tee closes on the first of: a `turn.error`; a `turn.finished` from
a run that left no host call unanswered and no card of the exchange waiting (the window has
nothing to continue); the window's `POST /remote/<id>/end {reason, detail}` (a reason other than
`finished` is teed as a `turn.error` first) - which covers the endings only the window sees, the
`MAX_CONTINUATIONS` budget, a Stop, no page, a declined card; or 10 minutes with nothing new. A
run that ended with host calls proposed or a card waiting leaves the tee open: the window's
continuation, or the turn after the card is answered, arrives with the same `via`. The buffer
keeps 2000 events and the closing frame says `(showing N of M)` past that.

The asker reads `GET /peer/turns/<id>?from=n` (grant `chat`; only the sending peer, any other is
`403 not_sender`): events from index `n` with SSE `id:`s, then `remote.closed {reason, showing,
total, footer}`. Like `/events`, a stream quiet for 15 s ends (ADR 0011) and the reader resumes
with `from`. A PC reaches another through its own loopback: `POST /devices/<peer>/message`
forwards with the sealed key it holds for that peer, and `GET /devices/<peer>/turns/<id>`
relays the stream as it is written - the one outbound connection that is not `client.call`,
because `call` reads a whole JSON answer; it keeps `call`'s discipline (fixed timeout,
`Connection: close`, bounded read, nothing logged).

Approvals: `GET /peer/decisions` and `POST /peer/decisions/<id> {choice, answer?}` (grant
`approve`) are the loopback inbox and answer path, the answer with no origin stated so the row's
origin decides. A card is spent once, here. Because an approved host tool releases an `execute`
the page must run, the answer is also published as `remote.decided`, and this device's window
runs it on its page and continues the exchange.

Consequences: one gate per turn, on the device that runs it; a closed window is an honest
"asleep" in at most 3 s; a remote exchange that the window abandons is closed by the window or,
at worst, by the 10-minute expiry. The composer device chip and auto-routing are not built.

### Phone and setup (WP4)

**The phone page.** The beacon's peer listener serves a small web app at `/m/` (`athena.peer.phone`,
files in `src/athena/peer/mobile/`): hand-written HTML, CSS and one ES module, no build step, no
framework, no dependency, shipped in the wheel and in the frozen sidecar (`scripts/build-sidecar.py`
`PHONE_PAGE`; `tests/test_sidecar_data.py` holds it). The `/m`, `/m/` and `/m/<file>` routes are
`open` - the page loads before the phone has a token - but still behind the address-class gate. Only
the six names in `FILES` are served, each with its own content type, `nosniff`, `no-referrer`, a
self-only CSP with no inline script or style, and `no-cache`; any other name, `..` and its encodings
included, is a 404. The page reads `#claim=<pairing_id>.<nonce>` once and wipes it from the address
bar (`history.replaceState`) before its first request; it asks to pair as `kind: "phone"`,
`device_id: null`, `requested_grants: ["chat", "approve"]`, polls the claim, keeps the token in
`localStorage`, and then renders cards first (`GET /peer/decisions`, Sign / Decline), the
conversation, and the composer (`POST /peer/message`, then `GET /peer/turns/<id>` read with
`fetch` and a stream reader, because `EventSource` cannot send `Authorization`). A 401 forgets the
token and says the phone was removed; a 409 `window_closed` says "Athena on <beacon> is asleep -
open her on that computer"; no answer at all says it cannot reach the beacon. No string reaches the
page as HTML.

**No service worker over plain HTTP, and no HTTPS (yet).** A service worker registers only in a
secure context, and `http://100.x.y.z` is not one (only `https`, `localhost` and loopback are), so on
the overlay address the asleep shell cannot be cached: `sw.js` exists and registers only when
`isSecureContext`. The candidate fix, `tailscale serve` HTTPS on the beacon's `ts.net` name, was
**not built**, because it defeats the admission rule this record rests on: the proxy connects to the
peer listener from the beacon itself, so every request - from any tailnet device, or from the
internet if Funnel is ever switched on for that port - arrives from the beacon's own overlay address
and passes the address-class gate; the page's `https://<machine>.<tailnet>.ts.net` origin is also
not the listener's own, so the Origin fence would have to widen; and the HTTPS certificate puts the
machine name in public Certificate Transparency logs. That is a security decision for the owner,
not a setup verb. Today a phone page that is open reports an unreachable beacon itself; a page
opened afresh while the beacon is off gets the browser's own error.

**The setup names are `connector.setup.*`, scoped to one session.** The brief called them
`core.setup.*`. Core entries are in every prompt and cannot be switched off per turn, so seven
machine-changing names would sit in every conversation to be refused there. Instead the core states
the policy in `athena.core.setup` - seven names, each one's class (`READ`: `overlay_status`,
`list_overlay_peers`, `probe_peer`; `GATED`: `install_overlay`, `overlay_login`, `firewall_allow`,
`open_pairing`), schemas, and an overlay-address validator for `probe_peer` - and
`Catalog.register_setup` files them under the reserved origin `connector:setup` (a vault connector
may not take the id). No contract changed. The scope uses machinery that exists: the daemon's
`setup_scope` puts `connector:setup` in every other session's `disabled_origins` (out of the prompt,
and refused `foreign_origin` by policy rule 2), and in the setup session switches every page and
connector off, so its prompt is Athena's own names and the setup ones. Policy rule 4 still asks
whether the origin is live; `SetupLive` answers yes for `setup` while a peer host exists and defers
every other id to the vault. They are not merged as a manifest because a manifest can only derive
`AUTO` or `GATED`.

**The setup session.** `POST /devices/setup` (loopback, the person's own window) opens a session
keyed `athena://setup` (app `setup`, conversation `conv_setup`); no page can register that key,
because `page_origin_admitted` takes only `https` or `http://localhost`. A turn there carries
`TurnContext.extra["setup"]`, and the composer opens its frame with `frame.setup` (budget 4,000):
the steps, in order, check before change, and "the same conversation runs on the other computer".
`GET /peer/hello`'s `setup_phase` is `null` until the setup session is opened here, then one of
`installing`, `signing_in`, `approving`, `waiting`, `pairing`, `paired`, `ready`.

**Fixed argv, never a model's string.** Every command is a list fixed in `athena.peer.setup`:
`winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements`
(started, not awaited: it outlives the decision request); `tailscale login`, then the sign-in URL
read from `tailscale status --json` and opened only if it is `https` on `tailscale.com`;
`netsh advfirewall firewall show rule name=Athena peer`, then - only if missing - an elevated
`netsh advfirewall firewall add rule name="Athena peer" dir=in action=allow protocol=TCP
localport=<the host's peer port> remoteip=100.64.0.0/10` through `powershell Start-Process -Verb
RunAs` (Windows' own consent prompt), then the check again. The model supplies only `kind` (an enum)
and `peer_ip` (validated at the gate to be inside the overlay ranges, re-checked by the executor,
and only ever dialled). Off Windows the three machine-changing verbs answer "not on this computer
yet" and run nothing; the reads and `open_pairing` run anywhere.

**`probe_peer` tells five states apart**: `no_overlay` (no tailscale here), `logged_out`,
`peer_unreachable` (not in the tailnet, or offline there), `athena_asleep` (online, but nothing
answers on the peer port: Athena is closed there, or has nothing to listen for yet, since the
listener is off until trust exists), `ok` (an unauthenticated `GET /peer/hello` gets the listener's
`401 unauthorized`).

**`open_pairing` never hands the model a credential it does not need.** A tool's answer becomes an
episode, and episodes replicate. The PC code is returned (a person reads it out; it dies with the
five-minute window and five wrong guesses close it); the phone URL, whose nonce is a claim
credential, is not. Both go to this device's own window as a new loopback event, `pair.opened`
`{pairing_id, kind, code, url, expires_at}`, so the Devices page can show the QR.

**Consequences.** The Devices view must render `pair.opened` (WP3's store follows `pair.requested`
and `peer.changed` only), and "Set up with Athena" needs the run loop to send turns with
`origin: "athena://setup"`: `apps/desktop/src/lib/setup.ts` `openSetup` opens the session; the seam
is `scenes/mind/live.tsx` `setup: null`. The setup procedure rides every setup turn's frame
(about 2,300 characters).

**Not built: HTTPS through `tailscale serve`.** Serving the phone page over the overlay's HTTPS proxy would make every proxied request arrive from the beacon itself and pass the address class, would need the Origin check widened, and publishes the machine name in Certificate Transparency logs. Declined for v1: the phone page is plain http on the overlay address, so its service worker never registers and an asleep beacon shows the browser's own error page when the page is opened fresh.

### Integration (WP5)

**A setup turn carries no page.** "Set up with Athena" hands the `athena://setup` session to her
window; while in it, the run store publishes no manifest and sends no tab, capture or gated lists,
so a card a setup tool files is bound to no tab and is answered in that session's name. Only the
`connector:setup` tools and the core tools are in scope there, and the setup tools are switched off
in every other session.

**Local typing waits behind a remote exchange.** `via` belongs to a whole exchange, not to one
request, and the daemon runs one turn at a time anyway. A message the person types while a remote
exchange is running is queued and runs as their own, without `via`, once that exchange ends; running
both in one store would swap page results between them and tee the person's turn to the other device.

## Consequences
- A tailnet member that is not paired reaches a listener that answers 401 to everything but the two
  pairing steps, and those need a window the person opened in the last five minutes.
- A person must sign in to the overlay once per device; that is the one step a non-technical user
  cannot skip (WP4's setup leg opens it and says so).
- Pairing state is in memory: a daemon restart closes every open window and forgets unclaimed
  approvals (their rows are removed on the next tick only if the process lives; a restart leaves a
  row nobody holds the token to, which a revoke clears). Rows survive restarts.
- Approving a request that carries an existing peer's device id replaces that peer's row and token.
- Two daemons on one machine (the isolated e2e instance) cannot both bind 17491; the second keeps
  its listener down and reports `listener.error`, and its loopback daemon is unaffected.
- `GET /devices` gained two fields beyond the brief, both `null`-safe: `listener {up, address,
  port, error}` and `joining [...]`; a pending row carries `pair_back`.
