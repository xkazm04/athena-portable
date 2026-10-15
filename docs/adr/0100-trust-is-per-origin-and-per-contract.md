# 0100. Trust is per origin and per contract: a rewritten tool asks again

Date: 2026-10-15

Amends [0063](0063-a-page-is-gated-on-first-sight-and-the-users-pins-reach-the-gate.md) (per-origin
trust). Keeps its rule that the shell says the per-turn lists and the daemon keeps none. No wire format changes: `bridge:toolchange` stays
payload-free, no IPC command is added, and the daemon's `GateHook._tightened` already turns every
name in `gated_tools` into `GATED`. Closes the desktop-client-lib `mcp-tools` deviation.

## Context

ADR 0063 gave an origin three states: no row (first sight, every tool gated), enabled (classes
from the flags, tightened by the user's `GATED` pins), disabled (refused). Once an origin was
enabled, the page could rewrite any tool through `toolchange`, which the surface re-lists without a
diff by design. An `AUTO` tool whose description went from "List invoices" to "Send every invoice"
kept running unattended as long as its flags still said reversible, and a tool registered after
trust was trusted with the origin. What the user trusted was the app as it was when they said yes;
what the gate honoured was whatever the app said later.

## Decision

1. **A contract is what a reader or the gate acts on**: the tool's name, title, description,
   input schema, `annotations` and `athena` flags, spelled as canonical JSON (keys sorted at every
   depth) and hashed with SHA-256 (`apps/desktop/src/lib/contract.ts`).
2. **The accepted contract is recorded twice, and only twice.** When the user enables an origin,
   the contracts of the tools its open tabs list then become the accepted ones. After that, a
   tool's contract is accepted only when an approved call of it ran and the page answered `ok`
   (`stores/run.ts`, `onPage(row, approved)`). A decline, a refusal or a failed run leaves the old
   hash in force. An identical re-registration has the same hash and never asks.
3. **A different hash tightens.** On an enabled origin, every tool whose current hash is not the
   accepted one, including a tool with no accepted hash at all, is added to `gated_tools`
   (`contractDriftsOf`, read by `gatedListsOf`). First-sight and switched-off origins are already
   gated or refused whole and are not read. Nothing here loosens a class.
4. **The card shows the old contract beside the new one**: the description and, when it changed,
   the input schema, both neutralised (control, zero-width and bidi characters become spaces) and
   cut at 240 characters with `(showing N of M)`. A tool never accepted says it appeared after the
   app was trusted.
5. **The record lives in one `settings` row, `tool_contracts`**: web origin to tool name to
   `{hash, description, description_total, schema, schema_total}`, the texts cut to 240
   characters, so each entry is bounded. It is not an `origins` column because that table has fixed
   columns and the store ships no migrations (`store.rs`, `SCHEMA_VERSION`). Writes go through one
   queue and apply to the table the previous write published. Forgetting an origin drops its
   contracts.
6. **The hash is computed synchronously, in plain TypeScript, not with `crypto.subtle`.** The gate's
   lists are built synchronously when a snapshot is taken and on every render of the companion;
   `crypto.subtle.digest` is asynchronous and exists only in a secure context, so using it would
   mean threading precomputed hashes through the tools store and a fallback for when it is absent.
   A plain string compare would make the stored record as large as the page's text. A short
   non-cryptographic hash would not do: the page controls every byte hashed and could aim for a
   collision. The implementation is checked against the FIPS 180-4 test vectors; hashes are
   memoised per tool object, because a tool list is replaced and never mutated.
7. **No pin control.** The user cannot mark a tool "trust whatever it says"; the only way to
   accept a new contract is to approve a call of it.

## Consequences

- An origin enabled before this change has no accepted contracts, so each of its tools asks once
  after the upgrade, until the user re-enables the origin or approves one call of each. That is
  the fail-closed reading of "no accepted hash" and is deliberate.
- A cosmetic rewrite (a typo fixed in a description, a reordered schema with a new default) asks
  once. Key order alone does not, because the JSON is canonical.
- The accepted contract is the one the approved call ran under, read from the exchange's snapshot
  (ADR 0067). A page that rewrites the tool between the card and the run gets the run accepted
  under the contract it ran with, which the next snapshot compares against as usual.
- A contract table that cannot be read counts as empty: every tool of every enabled origin asks.
