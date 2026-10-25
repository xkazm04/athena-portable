# 0152. An answer to a card holds that card's lock

Date: 2026-10-25

Amends [0141](0141-a-turn-locks-its-thread-and-athena-delegates.md), the clause that keeps
`daemon.writing()` as the short write lock "for a manifest merge, an answer to a card, a connector
act". Relies on [0038](0038-an-approval-is-spent-when-the-gate-lets-it-through.md) (single use is
the table's conditional write).

## Context

ADR 0141 kept `daemon.writing()` around an answer to a card on the grounds that the answer takes
"the milliseconds the write takes". That holds for a host card, whose replay only hands back an
`execute` instruction for the page. It does not hold for a core or connector card: the replay
(`BrowserLane.answer_decision` -> `gate.run_tool`) runs the executor in place, and a connector's
executor is an outbound call - a Gmail or Notion send, an MCP `tools/call` - with a 20 s request
timeout. For all of that time the daemon's one write lock was held, so:

- `POST /manifest`, which the shell sends for every tab with an admitted origin (ADR 0065), could
  not merge. A tab opened while she sent an email had no tools, and its next turn was refused.
- Every other card's answer waited, including the voice gateway's spoken yes or no, which goes
  through the same `decide`.

The lock bought no correctness. Two answers to one card are settled in the approvals table:
`resolve` is a conditional update on `pending`, and `consume` is conditional on `consumed_at IS
NULL` (ADR 0038). The catalog replaces an origin's tools in one assignment; the vault single-flights
a connector's token refresh; turns already run connector tools from several conversations at once
with no daemon lock. The guard was keyed to the daemon when the entity it protects is one card.

## Decision

1. **A keyed lock map.** `ThreadLocks` becomes `KeyedLocks` (the old name stays as an alias): one
   lock per key, entries counted and dropped when the last holder or waiter leaves. The daemon
   keeps two: `threads`, by conversation (ADR 0141, unchanged), and `cards`, by approval id.
2. **`decide` takes `daemon.card(approval_id)`, not `daemon.writing()`.** The critical section is
   unchanged for that card - the case stamp, resolve, replay, executor, spend and the case finish -
   so no window opens between checking the row and using it. Two answers to one card still run one
   after the other, and the second reads the first's settled row (a `409` in the one refusal
   vocabulary). An answer to any other card, a manifest, a spoken answer and every read never wait
   on it.
3. **`writing()` stays for the manifest merge** and the connector acts in `daemon/connectors.py`.
   Those acts still hold it across `vault.probe` and `connect_token`, which are network calls too;
   that file belongs to the wiring context and is the named follow-up, not part of this change.

## Consequences

- Approving a send no longer freezes the daemon for up to 20 s: tabs opened meanwhile get their
  tools, and other cards and spoken answers return at once.
- An executor that relied on being alone in the daemon would now run beside a merge or another
  card's executor. None of the shipped ones does: turns already run them concurrently.
- The card-lock map holds an entry only while an answer is in flight; an executor that raises
  still gives its lock back (the map is a context manager), which a test pins.
- Tests (`tests/daemon/test_threads.py`, against a real socket and a connector whose send takes
  3 s): a manifest merges, another card is declined and the voice door answers a third card, each
  in under 1 s while the slow approval runs (all three waited the full 3 s before); two approvals
  of one card run its action once; an approve and a decline racing on one card land once; the card
  map is empty after every answer, a failed one included; `GET /health` answers; a manifest refused
  whole during the approval changes nothing.
