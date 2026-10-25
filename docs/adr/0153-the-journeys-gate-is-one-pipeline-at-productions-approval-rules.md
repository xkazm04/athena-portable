# 0153. The journey's gate is one pipeline, at production's approval rules

Date: 2026-10-25

Applies [0038](0038-an-approval-is-spent-when-the-gate-lets-it-through.md) (single use, and a
parameter mismatch is `validator_failed` and spends nothing) to the journey's fake gate
(`examples/journey`), and reuses the demo kit's argument validator as
[0146](0146-a-page-tool-failure-is-a-failed-reply-and-a-domain-answer-is-an-answer.md) left it.

## Context

The four-act journey stands in for the daemon with an in-process gate: an approvals fake, a page
surface (`Surface`) and a connector surface (`ConnectorSurface`). That fake was weaker than the
product in four ways a run could pass on:

- `Approvals.prove` never spent a card, so a granted card authorised unlimited replays, where the
  daemon refuses the second with `approval_spent`;
- a citation whose parameters differed from the card was refused `unknown_ref`, where the daemon
  refuses `validator_failed` and leaves the grant unspent;
- a connector call went to the port without being checked against any schema, and the connector
  fakes published open schemas;
- a connector read reached the caller unfenced and uncapped, where `connectors/service.py` cuts
  every read at `READ_CAP` 1600 and fences it.

The pipeline itself (prove, check, call, write a row, refuse-writes-row-then-throws) was copied by
hand in the two surface classes and had already drifted (tier 1 fenced, tier 3 did not). Because the
page surface held a Playwright `Page`, none of it could be tested without booting four servers.

## Decision

**One tier-agnostic pipeline, `src/gate-pipeline.ts`, in the daemon's order:** validate the
arguments against the published schema (`validator_failed`), prove the card and spend it, then the
egress allow-list for a connector (`foreign_origin`, with the card already spent: the gate consumes
in `harness/hooks.py` before the service checks egress), an admission check (the page surface's
per-origin budget), the injected transport, and the output fenced with the surface's nonce, an AUTO
connector call cut to `READ_CAP` inside the fence first. Every outcome is one ledger row; every
refusal is a `GateRefusal` carrying its reason, the stage it stopped at and its row.

**Both surfaces keep their public API and delegate.** `Surface` supplies the relay or hand transport
and the budget; `ConnectorSurface` supplies `port.call`, the allow-list and the cap. Their
`refused()` helpers report a refusal from the gate's own stages and rethrow a transport failure, so
"the page said no" is never reported as "the gate held".

**`Approvals` spends.** A card gains `consumedAt`; `prove` checks exists, answered, matches
(`validator_failed`), unspent (`approval_spent`), then sets it once. `status` stays `granted`.

**Validation is the demo kit's `argumentErrors`, with production's openness rule.** An argument
the schema does not name is refused only when the schema is closed (`additionalProperties: false`),
which is `check_schema`'s rule and keeps a shell hand (open schema) from being refused for a key the
daemon would pass. Kit pages and, now, the connector fakes publish closed schemas (every argument
required), so for them this is the kit's verdict exactly.

## Consequences

- A journey run can no longer pass on a replayed card, a misspelled connector argument or an
  unfenced connector read; the record's refusal reasons match the daemon's for the same act.
- The gate has an offline spec, `tests/gate-pipeline.spec.ts`, that runs in under a second under the
  Playwright runner with no page fixture; it is a candidate for CI where the journey itself is not.
- A beat that re-cites a card, or passes a connector key its schema does not name, now fails. No beat
  in `journey.spec.ts` or `take.spec.ts` does either today (every `approveAndRun` mints its own
  card, and every connector call names exactly its schema's arguments); the full journey has not
  been re-run against this change.
- `ConnectorResult` and `Result` now share `GateResult`, so a connector result carries `fenced`.
