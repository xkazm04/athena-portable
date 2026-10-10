# 0062. The switches belong to the account they were set under

Date: 2026-10-10

Amends `connectors/vault.py` (`_admit`, `set_writes`, `set_allowlist`), after ADR 0021, on one
point only. Found by the gmail-and-notion-connectors full council round 1 (run 3832907a, craft:
"A reconnect as a different account keeps the writes switch and the recipient allow-list").

## Context

ADR 0021 keeps the writes switch and the allow-list across a disconnect, because they are the
person's and not the credential's. That choice stands. What it left open is a connect as someone
else: disconnect cleared the identity, `_admit` overwrote it, and nothing compared the two. A
person who turned Gmail writes on for account A, disconnected, and connected account B got B live
with writes on and A's recipients. The approval card still stands, but the second gate was now
authorising for an account the person never configured.

## Decision

- The connection record carries `switches_identity`: the identity the switches were set under.
  `set_writes` and `set_allowlist` write it whenever a grant exists (status `connected` or
  `needs_reauth`), from the record's current identity. A disconnect keeps it. A switch set while
  disconnected leaves it as it was.
- `_admit` compares the probed identity with `switches_identity` before the record goes live. If
  either switch is on and the two differ, writes are turned off and the allow-list emptied, and the
  record's health detail says, in words, which account it is now, that the switches were set under
  another (or without a known one), that writes are off and that the list was emptied. If they are
  the same, the switches are kept.
- It fails closed. A switch with no stored identity (a record written before this change, or a
  probe that named no account) is reset on the next connect. The one exception is a record that is
  `connected` when it loads: it adopts its current identity, so an upgrade does not wipe a live
  setup. A probe that returns no identity never matches, so it resets too.
- Comparison is exact. Nothing is normalised, so a different spelling is a different account.

### What the identity can and cannot tell apart

Gmail's identity is the profile's `emailAddress`: two accounts never share one. Notion's is the
integration bot's `name` (`identity_field` stays `name`): two workspaces with an integration of the
same name look like one account, so a connect to the other workspace keeps the switches. The
allow-list there is page ids, which do not exist in the other workspace, so it admits nothing
there; the writes switch stays on. The bot's own id would tell workspaces apart, but changing the
probe is a scope decision, not made here (it was not raised at the time; see the amendment below).

## Consequences

Connecting as a different account costs the person a writes switch and a list to set again; the
detail says why. A person who sets the switches before the first connect sets them again after it.
Reconnecting as the same account is unchanged. The record gains one field, with no secret in it.

## Alternatives that lost

- **Clear the switches on disconnect.** Reverses ADR 0021 for the common case, a reconnect after a
  needs-reauth, to fix the rare one.
- **Ask the person at connect.** The OAuth flow completes in a browser callback with no one to
  ask; refusing the switches is the safe default and the person can set them again.
- **Keep them when no identity is known.** Open by default; the gate is the policy.

## Amended 2026-10-10: Notion is keyed on the bot's id

*Corrected 2026-10-10:* this section first said the operator decided it; he did not.

The App Master decided what the section above left open, headless on 2026-10-10 while the operator
was away. It was not put to him then, and it stands until he rules on it.
The comparison is made on a key, not on the name a person reads.

- The probe spec gains an optional `key_field`. Notion's is `id`, the top-level id of
  `GET /v1/users/me`; Gmail names none, so its identity (`emailAddress`) is its own key.
- The record carries `account` (the key as probed) and `switches_account` (the key the switches
  were set under) beside `identity` and `switches_identity`, which stay for display. Notion's
  display is the bot's `name`, with `bot.workspace_name` in brackets when the probe has one;
  neither is ever compared.
- It fails closed. A probe that names no key resets the switches, with the reason in the health
  detail. A Notion record whose stored switches identity is only a name (written before this
  amendment) has no `switches_account`, so it resets once on its next connect, and the health
  detail says it was known only by its name. A switch set after that carries the id.
- Gmail's records are unchanged: a record with a `switches_identity` and no `switches_account` is
  compared on the identity, so an upgrade does not reset a Gmail setup.
- Two workspaces with a bot of the same name are now two accounts; the writes switch no longer
  survives a move between them.
