# 0122. An unpriced call weighs against the cap at a stated default

Date: 2026-10-18

Amends [0030](0030-nebius-is-the-proving-ground-not-the-companion-engine.md), whose per-run caps
($1 Nemotron, $10 Claude) are the only stop on an unattended proving run.

## Context

`Budget.charge` booked a call with no known cost as free: a Nemotron error chunk, a Claude timeout,
a model missing from the price table, a CLI that printed no `total_cost_usd`. A run whose calls came
back unpriced never moved `spent`, so `can_spend` stayed true for every remaining planned call and
the cap never bound (1000 unpriced charges: `can_spend` True, spent 0.0).

## Decision

An unpriced call is counted, and for enforcement only it weighs `UNPRICED_CALL_USD[engine]`:
$0.02 on Nemotron and $0.50 on Claude, each above the dearest call that engine has made in the
recorded runs. `can_spend` and `require` compare known spend plus those assumed amounts with the
cap. `spent_usd` in every report stays the sum of known costs, and `summary()` gains
`unpriced_calls` so a reader sees how many were assumed. The two numbers are the owner's to tune;
they are constants in `proving/budget.py`.

## Consequences

A run with many failed or unpriced calls stops earlier than before (50 on Nemotron, 20 on Claude
at the default caps), which is the point. The daily cap reads `spent_usd` and is unchanged.
