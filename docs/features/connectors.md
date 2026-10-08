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
  from the arguments.
- **The vault brokers every call.** An executor asks the vault to call the service and never holds
  a token. Calls have a host allow-list, a timeout, a cap and redaction. A token or OAuth grant is
  probed before it is sealed (keyring, DPAPI or an owner-only file, `seal.py`), under
  `ATHENA_HOME/connectors/`, never inside a brain.
- **OAuth** with PKCE over a one-shot loopback listener (`oauth.py`).
- **Health is three-valued** (healthy, broken, unknown), shown with its age, probed on events and
  never on render. Structural policy checks liveness on every call.
- **No secret surface.** No tool returns, lists, mints or rotates a credential.

## The desktop module

A grid of emblem tiles that reads (connected or not, at a glance) and a layer per connector for
every write: the token field or the OAuth client pair with the consent flow's phase, the writes
switch, the allow-list, disconnect (ADR 0029).

## Not done

Only Gmail and Notion ship. Nothing in the demo depends on a connector.
