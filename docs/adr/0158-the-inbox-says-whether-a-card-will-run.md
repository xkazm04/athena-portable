# 0158. The inbox says whether a card will run

Date: 2026-10-25

Extends [0060](0060-an-approved-card-refused-at-its-replay-can-be-answered-again.md) (the panel
explains a switched-off refusal after the approve was refused). Reads the rules of README §3.3
and the replay of README §3.2 step 6; changes neither.

## Context

`GET /decisions` listed each pending card's fields and nothing about whether approving it could
work. Some cannot: the app is switched off, the page whose tools the card names has closed, or
the connector is disconnected. The person learned that only after pressing Approve, from a `409`
and a sentence written after the fact (ADR 0060), and after a reload the card could be lost. The
daemon already held every fact needed to say so first: the approve path judges a card by two pure
reads, `catalog.get(action)` and `gate.policy.authorize(entry, params, ctx)`, under
`_decision_ctx`, which can be built without answering.

## Decision

1. **Each inbox row carries `will_run` and `blocked`.** `blocked` is `null` or
   `{reason, rule, sentence, remedy}`: `reason` is the member of `ERROR_REASONS` the replay would
   refuse with, `rule` is the policy rule or `tools_gone` (the catalog has no entry), `sentence` is
   plain words with no rule id, and `remedy` is one act a surface can offer as a single press -
   `{act: "switch_on", origin}`, `{act: "open_app", origin: <the app's pinned page origin, or
   null>}` or `{act: "reconnect", connector}` - or `null` when no press fixes it (a lane
   allow-list).
2. **The preflight is the gate's rules asked early, not a second gate.** `_preflight` makes the
   replay's reads in the replay's order under the replay's context, and writes nothing: no
   resolve, no consume, no ledger row, no episode. The replay still decides; tests pin that the
   prediction equals its outcome for each blocked kind.
3. **`?disabled_origins=` carries the shell's switched-off table** as a comma list, parsed by
   `disabled_origins_from` and refused whole past `MAX_DISABLED_ORIGINS` (a `400
   validator_failed`), as `POST /run` and `POST /decisions/<id>` refuse it - never cut, since a cut
   list would read the origins past the cap as switched on.

## Consequences

- An approve that cannot work stops costing a press and a refusal; the fix is shown in place. The
  inbox and the gate cannot disagree on the rules, because one `Policy.authorize` answers both.
- The keys are additive: every existing row key, `showing`, `total` and `footer` are unchanged.
- Cost: one catalog lookup and one in-memory policy evaluation per listed row, O(rows) under the
  existing limit.
- A row's verdict is true at the moment of the read; a page can close between the read and the
  press, and the replay's own refusal (ADR 0060) still covers that.
- Follow-up, not in this change: the desktop card render (`apps/desktop/src/lib/api.ts` row type
  and the companion card) reads `will_run` and `blocked`, sends `disabled_origins` on the inbox
  read, and holds Approve behind the remedy.
- Tests (`tests/daemon/test_decisions.py`): a live host card will run; a switched-off app, tools
  gone and a connector not live each name reason, rule and remedy, and the approve is refused with
  the same reason; reading a blocked card writes nothing and the card runs once switched back on;
  257 origins are refused whole; a 25-card inbox keeps its keys and footer; every blocked sentence
  is plain.
