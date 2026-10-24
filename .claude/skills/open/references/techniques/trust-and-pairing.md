# trust-and-pairing

**When** an app is paired with Athena, **register its origin in her Apps page, switch the app's opt-in
on, then re-trust the origin so the contracts listed now are the accepted ones, and let the app's own
backend admit only that origin, with no token through the page**, **because** Athena trusts per origin
AND per contract (ADR 0100), and the person's acts in her UI are the only grant.

## Athena's side

| State | Effect | Source |
|---|---|---|
| No row (first sight) | every tool of the app is GATED, reads included | ADR 0063 |
| Enabled row | classes as the flags imply, tightened by the person's GATED pins | ADR 0063 |
| Disabled row | every call refused `foreign_origin` | ADR 0063 |
| Contract accepted | the SHA-256 of `{name,title,description,inputSchema,annotations,athena}` the tab listed when the origin was enabled, or after an approved call ran ok | ADR 0100; `apps/desktop/src/lib/contract.ts:76-96`; `stores/origins.ts:174-182`; `stores/run.ts:1310-1320` |
| Contract new or changed | that tool asks for approval, "This tool appeared after you trusted this app." | `stores/run.ts` `contractDriftsOf`; `companion/slip.tsx:67` |

Registering an app saves an enabled row before its tab has listed anything (read from
`apps/desktop/src/modules/browser/index.ts:66-75`, and observed on the real desktop), so it accepts no
contracts: **every tool asks once until the origin is re-trusted.**

## The pairing sequence (goes into the app's guide)

1. Start the backend with an Origin allowlist that admits the page's origin.
2. Open the app in an Athena tab at `http://localhost:<port>/` (never `127.0.0.1`, ADR 0119), with the
   backend parameter if needed.
3. Register the origin: Apps, "Address of the app to register".
4. Switch the app's toggle on ("Athena driving").
5. **Re-trust**: in her ledger, Origins, press **Disable** then **Enable** on `localhost:<port>`. Reads
   become AUTO, writes stay GATED. (Approving a tool's first call accepts that one tool too.)
6. Check: a read runs without a card; a write files one.
7. **Repeat step 5 after every app update that changes a tool**, its description included.

A fixed port keeps one origin row across runs; every new port is a new row in the person's trust table.

## The app's side

1. **An Origin allowlist on its backend.** Answer CORS only for the allowed origins and refuse any
   request or WebSocket upgrade that carries another `Origin`; requests with no `Origin` are non-browser
   clients. Shadowrunr: `http://localhost:*`, `tauri://localhost`, `http://tauri.localhost`, plus
   configured extras (`crates/shadowrunr-daemon/src/server.rs:96-171`). Requiring
   `content-type: application/json` forces a preflight for any cross-origin call.
2. **Bind to loopback.** A backend that listens off loopback, or that brokers spend or credentials, needs
   a real pairing ceremony and a bound token (registry `device-pairing`); an Origin allowlist alone is the
   floor for a loopback, single-operator backend only.
3. **No token through the page.** No tool returns, lists or accepts a credential; the page never holds
   Athena's daemon token (`X-Athena-Token` stays in her shell; the driver's `status` and `daemon` calls
   never return it). Tabs share one browsing profile (`tabs.rs:236-238`), so anything the page stores,
   every tab can read.
4. **The page's claims are claims.** Meta tags and flags never open a permission; only the person's row
   does (protocol.md, "page").

## Checks

- Backend test: allowed origins pass; `http://localhost.evil.example`, `http://127.0.0.1:*` and others
  are refused (Shadowrunr `only_local_and_tauri_origins_are_allowed`).
- Keyless harness: the registered origin is not in `gated_origins` and pins nothing; the same tab
  unregistered is first sight.
- Real desktop: after `retrust`, a read is AUTO and a write GATED (`drive retrust <host>`).

## Evidence

Real desktop, 2026-10-23: registered while the toggle was off, every tool, reads included, asked for
approval until Origins Disable/Enable. Found only in the real app; the guide gained step 5
(overlord `dfff8f0`).

## Registry

`device-pairing`: "the human approval is the only mint gate", on a surface "the requester cannot draw"
(agrees: Athena's own UI). The same subject's bound-token ceremony is not met by a loopback daemon with an
Origin allowlist; that is a recorded deviation with the scope above. `mcp-tools/transport-selection`
(origin checks "on unless deliberately removed", agrees). `hitl-approval/consent-gates`: consent binds to
a fingerprint (agrees: the contract hash).
