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
