# Connectors

`src/athena/connectors/` and the desktop's Connectors module. Tier 3 of capability: services beside
the browser, reached through one vault (ADR 0021).

## What is built

- **Data, not code.** One JSON spec per service (`builtin/gmail.json`, `builtin/notion.json`)
  declares its auth methods, the only hosts the broker will dial, the probe that admits a
  credential, and a few intent-shaped tools ("search mail", not nine endpoints).
- **It enters the catalog like a page.** A connector presents a manifest of the same shape, with
  origin `connector:<id>`, and gets the same class decision. Reads are `READ`; writes are `GATED`
  and sit behind a per-connector switch that is off by default plus an egress allow-list checked
  from the arguments. One item of `to` or `cc` is exactly one address: a value that parses to
  several, to none, or that carries CR or LF is refused by name, and the headers are built only from
  the addresses the check allowed (ADR 0061).
- **The vault brokers every call.** An executor asks the vault to call the service and never holds
  a token. Calls have a host allow-list, a timeout, a cap and redaction, and follow no redirect: a 3xx is returned as a failure, so the
  credential never rides to a host the pin did not name. A token or OAuth grant is
  probed before it is sealed (keyring, DPAPI or an owner-only file, `seal.py`), under
  `ATHENA_HOME/connectors/`, never inside a brain.
- **A sealed file is born owner-only.** The file rung writes each value to a sibling created
  exclusively with mode `0600`, flushes it and renames it over the old one, so the value is never
  readable by anyone else, even for a moment; on POSIX a file that comes out looser is refused, not
  kept. A keystore or DPAPI failure comes back as the vault's own error, never an untyped one.
- **A refresh is classified before it costs a grant.** Only a terminal answer from the token
  endpoint (a 4xx naming `invalid_grant`, `invalid_client` or `unauthorized_client`, or a 400 or 401
  with no readable error) marks the connection `needs_reauth`. A 429, a 5xx, a 3xx, a timeout, a
  2xx without a token or an expiry that is not a number leaves it connected, and the model is told
  the status. A refresh that rotates the refresh token is sealed; one that does not keeps the old.
- **The refresh runs off the lock, once.** The token POST is made with the vault's lock released,
  so the vault keeps answering while it is out; concurrent calls with a stale token wait for the
  one refresh instead of each sending their own; and a disconnect or reconnect made meanwhile is
  never undone by it.
- **A rate limit is not a lost grant.** A 429 from any connector, or a Google 403 whose body names
  `rateLimitExceeded`, `userRateLimitExceeded`, `quotaExceeded`, `dailyLimitExceeded` or
  `RESOURCE_EXHAUSTED`, keeps the connection and tells the model it was rate limited, with the
  provider's `Retry-After` seconds when it sent them (at most a day). Nothing retries. A 401, or any
  other 403, on an OAuth call still marks `needs_reauth`.
- **The OAuth client pair is sealed only by a flow that worked.** It rides on the consent flow and
  is sealed with the grant after the exchange is admitted; a flow that fails, is cancelled or runs
  out leaves the sealed pair and a live grant as they were.
- **Each seal says what it protects against.** The Connectors module words the keystore as a
  keystore, Windows DPAPI as encrypted with the Windows sign-in and readable by any program running
  as that user, and the owner-only file as not encrypted; the copy around it says only "stored on
  this machine", which is true of every rung.
- **An unreadable connections file is a banner, not a quiet empty list.** While the vault carries a
  `records_notice` the module shows it verbatim at the top, with no way to dismiss it, and no tile
  reads "connected" until it goes.
- **A connect's own word stays on the layer.** What the daemon said at connect (for instance that
  writes were turned off because the account changed) shows on that connector's layer as a plain
  note, not an error, until the next probe replaces it.
- **The switches wait for a connection.** The writes switch and the allow-list editor are disabled
  while the connector is not connected, with the reason beside them.
- **The records file is swapped in, never rewritten.** `connections.json` is written whole to a
  sibling file, flushed to disk and renamed over the old one, so a crash leaves the previous file.
  A file that cannot be read (an I/O error, invalid JSON, a top level that is not an object) is
  never taken for "nothing connected" and never lost: its bytes are copied aside as
  `connections.json.unreadable-<UTC stamp>`, and `GET /connectors` and `Vault.views()` carry a
  `records_notice` in plain words until the person looks.
- **The switches belong to the account they were set under.** A disconnect keeps the writes
  switch and the allow-list (ADR 0021), and the record keeps the identity they were set under. A
  connect as another account, or one whose probe names none, turns writes off and empties the list
  before the record goes live, and its health detail says so; the same account keeps them. A record
  from before this, live at load, adopts its identity; any other switch with no identity is reset on
  the next connect. Notion's identity is the integration's name, which cannot tell two workspaces
  with a same-named integration apart (ADR 0062).
- **A provider's refusal never ends the turn.** A mail subject with a line break is refused as
  `validator_failed` before any request, and a `ValueError` a provider raises comes back as a
  failure from `Service.call`.
- **OAuth** with PKCE over a one-shot loopback listener (`oauth.py`).
- **Health is three-valued** (healthy, broken, unknown), shown with its age, probed on events and
  never on render. Structural policy checks liveness on every call.
- **No secret surface.** No tool returns, lists, mints or rotates a credential.

## The journey test

`tests/e2e/test_connectors_journey.py` (uat J6) runs the scripted daemon with `--fake-providers`
(`tests/e2e/serve_scripted.py`). The vault is the production one, built with `tests/e2e/
fake_providers.py` as its transport and as the browser at the consent page; the specs and the host
pin are untouched, and the fake answers the pinned production hosts of `gmail.json` and
`notion.json`. It walks: paste a client pair and connect; search and read a mail (fenced); turn
writes on for one recipient; a reply files a card and an approval sends exactly one message to that
address; a recipient off the list is refused by name; a decline sends nothing and is recorded as
`user_denied`; a revoked grant shows `needs_reauth`; a Notion page that was never shared is reported
as unreadable; a connect as a second account turns writes off (ADR 0062). Every test ends by
asserting each request the vault made was answered by the fake. No real provider is reached.

## The desktop module

A grid of emblem tiles that reads (connected or not, at a glance) and a layer per connector for
every write: the token field or the OAuth client pair with the consent flow's phase, the writes
switch, the allow-list, disconnect (ADR 0029).

## Not done

Only Gmail and Notion ship. Nothing in the demo depends on a connector.
