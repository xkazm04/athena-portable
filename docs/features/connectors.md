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
