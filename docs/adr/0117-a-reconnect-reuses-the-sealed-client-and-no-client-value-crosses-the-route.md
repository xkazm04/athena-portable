# 0117. A reconnect reuses the sealed client, and no client value crosses the route

Date: 2026-10-15

Builds on [0021](0021-connectors-are-data-behind-one-vault-and-enter-the-catalog-like-a-page.md)
("actions cross the boundary; values never do"). Leaves
[0062](0062-the-switches-belong-to-the-account-they-were-set-under.md) as it is: a reconnect is a
connect, and the switches are kept or reset by the same rule.

## Context

Gmail's guide has the person register their own OAuth client and add themselves as a test user
(`builtin/gmail.json`). Google gives a client in Testing a refresh token that runs out after seven
days. The refresh then answers `invalid_grant`, and the vault marks the grant `needs_reauth`.

To get back, the person had to paste the client id and the client secret again. The vault already
had both: `_admit` seals the pair with the grant, and only `disconnect` destroys it. But
`connect_oauth` refused an empty client id, the route fed it only from the body, and the Accounts
panel offered only the two fields. Google shows a client's secret only when it is created, so in
practice the person made a new secret every week.

## Decision

1. **The vault reuses its own pair on request.** `connect_oauth` takes `reuse_client`. When it is
   true and no pair is pasted, the vault unseals the pair from the last admission and starts the
   flow with it. With no kept pair it refuses with "no client is kept for Gmail; a client id is
   required to connect". A pasted pair always wins, `reuse_client` or not.
2. **Nothing new is sealed early.** The flow carries the pair as before. `_admit` seals it again
   only after the provider accepted the code. A cancelled or failed reconnect leaves the record
   `needs_reauth` and the kept pair readable. Nothing is destroyed and nothing is re-sealed.
3. **No client value crosses the route.** The body says `{"reuse_client": true}` and nothing else.
   `Vault.view` says `client_kept`, a yes or a no. The authorize URL names the client id, so a flow
   started with the kept pair (`_KeptClientFlow`) leaves `authorize_url` empty in its view. The
   daemon opens the browser itself, and the consent still happens there. A surface that asked for
   `open_browser: false` on a reconnect gets a flow nobody can open; it waits out its TTL, and the
   Accounts panel never asks for that.
4. **The panel is one press.** `rowOf` sets `reconnect` for a `needs_reauth` OAuth row whose view
   says `client_kept`. The Connect panel then shows the rail with its first two steps done, one
   `Reconnect` button that calls `connect(id, { reuse_client: true })`, and `Use a different client`,
   which brings back today's two fields (and `Use the kept client` to return).

## Consequences

- A weekly chore of five steps in another console becomes one press for every Gmail user on a
  self-registered client.
- The same account keeps its writes switch and allow-list (ADR 0062). Another account resets them,
  with the notice, as any connect does.
- A reconnect started from the panel shows no "Open the consent page again" link, because that
  link would carry the client id to the surface. If the browser did not open, the person presses
  Reconnect again, or uses a different client.
- `Vault.view` now reads the seal once per OAuth connector to answer `client_kept`. It reads only
  whether a value is there and never returns it.
- Both fields are additive. An older surface ignores `client_kept`. An older daemon omits it, and
  the panel shows the two fields as before.
