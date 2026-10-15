# 0116. A connector card names the account it acts as

Date: 2026-10-15

Amends [0026](0026-athena-is-her-own-window-and-main-is-the-workhorse.md) ("Who runs which store"): her window now holds
a read-only mirror of `/connectors`. Carries out the line of
[0021](0021-connectors-are-data-behind-one-vault-and-enter-the-catalog-like-a-page.md) that says "a
card for a connector tool names the connector as the thing that will act". Partly adopts
`docs/BACKLOG.md` C1. Leaves every gate rule as it is: the line is display only.

## Context

A connector card is the one approval that acts outside every page. Gmail sends as whichever account
the vault is connected as. The person signed the card without being told which account that was, or
whether the connection could carry the send.

- The card read `In connector:gmail - a connector, not a page`. `appOf` passed the origin to
  `hostOf`, and `new URL("connector:gmail")` parses with an empty host, so the raw origin came back.
- Her window, where cards are answered, did not run the connectors store. Nothing there knew the
  account or the standing.
- The vault flips a grant to `needs_reauth` in the middle of a call (`vault.py`). The surface heard
  about it only as a bare "could not carry it out" after the signature.
- The store's cross-window refresh listened for `store:changed` on a table named `connectors`. No
  such table exists, and Rust emits `store:changed` only for a write to `STORE_TABLES`. The branch
  was dead, and its test pinned a signal that never fires.
- The Accounts row's `isWrite` re-derived the class from the flags as `reversible === false ||
  side_effects === "external"`. `HostTool.default_class` gates anything whose `reversible` is not
  `True`, so a tool that omits `reversible` was GATED in the catalog and listed as a read.

## Decision

1. **The line is pure.** `connectorLineOf(origin, items, loaded, notice, action)` in
   `modules/connectors/model.ts` returns `null` for any origin but `connector:<id>`. For a connector
   it returns the connector's label, one line and at most one warning:
   - `Acts as mira@example.com through Gmail.` from the record's identity.
   - When the list has not answered, could not be read, or the vault's records notice stands:
     `Gmail's standing could not be confirmed.` It names no account.
   - A warning names the first cause that stops the call, followed by `, so approving now will be
     refused.` The causes, in order: the grant lapsed (`Gmail needs reconnecting`), nothing is
     connected, the connector is switched off, or writes are off for a tool the writes switch
     governs. The warning's action is `accounts`.
2. **The card carries it.** `cardView` takes the mirror as `context.connectors`. A connector card is
   named by the connector's label (`In Gmail - a connector, not a page`) and carries `connector`. A
   page's card is unchanged and carries `connector: null`. `appOf("connector:gmail")` reads `Gmail`
   even without the list. The view renders the line under the where line. A warning shows `Open
   Main`, which raises Main, where Accounts lives.
3. **Approve and Decline never read it.** The buttons are disabled only by what disabled them
   before: an answer in flight or a stamp. A warning predicts a refusal, and the gate decides at
   replay. A stale mirror can never stop a signature.
4. **Her window reads on demand.** `athena.tsx` calls `followCards` over the run store's cards. Each
   connector card that arrives triggers one `GET /connectors`. A page's card triggers none, and the
   30 s re-poll handing back the same card is not an arrival. Her window never acts on a connector.
5. **`connectors:changed` replaces the dead branch.** Every connector act that succeeds emits
   `connectors:changed {id, from}` through `lib/ipc.ts`, and so does a consent flow that settles.
   `from` is the sending window's own mark. The other window's mirror re-reads when someone there
   has asked for the list. The `store:changed` listener for `connectors` is removed.
6. **A write is what the catalog gates.** `isWrite` defers to `gate.js` `classify`, the port of
   `HostTool.default_class`. The warning reads `switchGoverns`, a mirror of `service.is_write`, the
   narrower rule the writes switch enforces. So it never predicts a refusal the daemon would not
   make.

## Consequences

- The person reads the account before signing a send. A card whose grant lapsed says so before
  the signature, not after it.
- The account is shown only in the person's own window. It never reaches the model, the page or
  the daemon.
- The identity is not bound into the approval. A reconnect under another account between the card
  and the replay is caught by the vault's generation check and the switch reset of [0062](0062-the-switches-belong-to-the-account-they-were-set-under.md), not
  by this line. Binding it is the daemon's next step.
- `Open Main` raises Main and does not choose the Accounts depth. Selecting a depth from her window
  would need a cross-window command that does not exist yet.
- The Accounts row now lists a tool that omits `reversible` under writes (gated), matching the
  catalog. The daemon's writes switch (`service.is_write`) still does not stop such a tool. The
  two Python rules disagree, and aligning them is a daemon change outside this one. No built-in
  spec omits `reversible` today.
- A reconnect in one press (a later change) edits the same store and model. `rowOf`'s shape is
  unchanged here.
