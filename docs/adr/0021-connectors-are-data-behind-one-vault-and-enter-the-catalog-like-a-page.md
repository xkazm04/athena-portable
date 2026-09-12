# 0021. Connectors are data behind one vault, and enter the catalog like a page

Date: 2026-09-12

## Status

Accepted. Implements README §4, which reserved the seam; builds on ADR 0004 (the gate is the
policy), ADR 0010 (the lane holds no gated executor) and ADR 0011 (the token on every route).

## Context

Act 2's chase drafts and act 3's guidance both want a service that is not a page: mail to send,
a workspace to write a note into. The reference product had a connectors subsystem of some six
thousand lines — specs, a vault with two seals, an OAuth flow, a gate module, a store, an audit
table, three providers — and its own desktop module. This build reserved the seam in P1 and P2
(`ConnectorPort`, the `connector:<id>` origin kind, the `connector_enabled` policy rule) and
left the rest. The question now was how much of the reference to carry across without pasting
it, and where each rule lives so a connector can never be a second gate.

## Decision

**A connector is data.** One JSON spec per service under `connectors/builtin/` declares how a
credential is acquired (a pasted token, or a delegated grant), the hosts the broker will ever
dial, the probe that admits a credential, what its write allow-list is a list of, and its tools
in the manifest's own shape: `name`, `description`, `params_schema`, `reversible`,
`side_effects`. Gmail and Notion ship. The parser is partial and typed: unknown keys are ignored,
a malformed required field refuses the spec whole.

**It enters the catalog like a page.** `Service` implements `ConnectorPort` over one spec and the
vault; `Catalog.merge_connector` merges its tools under `connector:<id>` with the same validation
and the same class derivation a page's manifest gets. The class is the catalog's decision from
the spec's flags; nothing in the connectors package names a class. A disconnect re-merges an
empty tool list, so a dead connector is not mentioned to the model at all rather than mentioned
and then refused.

**One vault brokers every call.** Credentials live under `ATHENA_HOME/connectors/`, never in a
brain, so a brain stays portable by copying. The record a surface may see is one JSON file with
no field that could hold a value; the values are sealed beside it — by the platform keystore
when the `keyring` extra is installed, by DPAPI on Windows through `ctypes`, by an owner-only
file elsewhere, and the record says which. `Vault.request` is the only place plaintext exists: it
refuses a host outside the spec, refreshes a grant that is nearly up, attaches the credential,
holds the call to a 20-second timeout and a 1 MB answer, and redacts the provider's error text.
Admission is a live probe: a token or a grant is sealed only after the provider accepted it.

**The delegated grant lands on a one-shot loopback listener.** The daemon's routes require the
token on every request (ADR 0011) and a provider redirecting a browser cannot carry one, so the
callback lands on a listener bound to `127.0.0.1:0` for one flow, with PKCE, a signed `state`,
a TTL and a junk budget. The daemon opens the browser; the surface polls the flow. The client is
the user's own: a tool distributed as source cannot keep a client secret.

**Writes are gated twice and reads are fenced.** A tool the catalog classes `GATED` runs only
while the connector's writes switch is on — off by default — and only when every value in its
named egress parameters is on the allow-list, normalised, with an empty list refusing every
write. The switch layers on the approval card; it never replaces it, and the model never sees the
switch. A read's text is capped at 1,600 characters inside the nonce fence, so a mailbox is
never read as instructions and the harness has nothing left to cut. Every result is tier 3.

**Structural policy asks the vault on every call.** `Policy(connectors=vault)` makes rule 4 live:
a `connector:` entry is permitted only while the vault says the connection is live now. A
deployment built without a vault refuses every connector, closed.

**Five routes, no secret on the wire.** `GET /connectors` lists every spec with its record;
`POST /connectors/<id>/connect|flow|disconnect|probe|settings` are the acts. A refused credential
is a 409 in the gate's vocabulary with no value in its detail. `--no-connectors` starts a daemon
without the vault.

## Consequences

- `src/athena/connectors/` grows `spec.py`, `seal.py`, `vault.py`, `oauth.py`, `service.py`
  and `providers/{gmail,notion}.py`, all standard library; `keyring` is an optional extra the
  seal imports lazily.
- `wiring.build_local(vault=...)` merges live connectors, re-merges on change and serves the
  routes; `AthenaLocal.vault` closes with the brain.
- `tests/connectors/` runs the vault over a fake provider (admission, refusal, the door, the cap,
  redaction, the switches, disconnect, a grant that is gone), the port (registration follows
  connection, the class from the catalog, fenced and capped reads, the writes switch and the
  egress gate in order, Gmail addresses inside display names), the spec parser, the consent flow
  against a real loopback listener, and the routes over a real socket.
- The desktop gains a Connectors module that reads these routes; a card for a connector tool
  names the connector as the thing that will act.
- The catalog's manifest rule classes a reversible read `AUTO`, as it does a page's read; the
  `READ` class remains Athena's own tools'. A connector read is therefore `AUTO` in the
  capability block, and the cap and the fence README §4 asks of a read are the service's, applied
  before the result leaves the port.
- Not carried from the reference: the audit table (a connector call is a tool call and lands in
  the episode record like any other), Exa, and Notion's OAuth (declared unavailable there too).
