# 0051. The count of items is held to the same bar as the money, and a deadline can be required

Date: 2026-10-08

Amends the playbook bench's verdict (`proving/playbooks/bench.py`, ADR 0040).

## Context

The verdict compared a run with its playbook's expectation by the share of the money found, the
false claims, duplicates, forbidden cards and minutes. That works when a world's items are of
similar size. The estate-settlement world is not like that. Its $93,200 IRA disclaimer is 83% of
the $111,644 the world holds, and the third run, which filed the disclaimer and two other cards
out of twelve, came back "exceeds". A reader of that verdict would believe something false.

There is a second gap of the same kind. Some items are deadlines, not money: a disclaimer seven
days out, the IRS before anyone else. Missing one is a failure whatever else was found.

## Decision

- The share of items found (`recall_count`) is held to the same expectation as the share of the
  value. Falling under it is short, with the reason "found N of M items".
- An eligible item can say `"required": true` in `truth.json`. Missing a required item is short,
  with the reason "missed <key>, which could not wait". `score()` carries the flag on the missed
  row.

## Consequences

- No committed playbook's latest run changes verdict: each was rescored and checked. The estate
  run that found 3 of 12 is short, as it should have been.
- `tests/proving/test_playbooks.py` drives both rules: one large item cannot carry a run, and a
  missed required item is short.
