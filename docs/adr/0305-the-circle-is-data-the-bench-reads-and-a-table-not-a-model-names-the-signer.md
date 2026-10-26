# 0305. The circle is data the bench reads, and a table, not a model, names the signer

Date: 2026-10-26

Builds on [0300](0300-a-sense-writes-cited-world-tables-and-a-chore-earns-featured-on-its-proofs.md)
(a sense writes cited world tables). Program: `docs/concepts/meta-featured-chores/`; spike
`05-care-circle`. ADR block 0300-0309.

## Context

Spike 05 asks the gate to answer "whose yes" for a family around an ageing parent. Athena is
single-user by invariant (README section 2), and the spike's README says the circle rethinks that
invariant behind a flag. Tonight's Director decision is narrower: Athena stays single-user, and no
change touches `core/`, `peer/`, the gate or the approvals. The chore still has to rehearse a
family's signer rules end to end on the bench.

## Decision

1. **The circle is data.** The circle sense (`athena.senses.circle`) turns the chore's
   `senses/signers.json` into a `signer_rules` world table, one row per action x subject with the
   resolved need, beside `counter_meds` (bottles read from photos) and `circle_tasks` (claims from a
   recorded family call). Athena reads them through the Circle app's READ tools; the members' yeses
   and noes are an authored `requests` table. The gate is unchanged: every circle action is a
   gated tool that files a card, and the card names its signers as a parameter.
2. **A table answers, never a model.** `signers.whose_yes(action, subject, table)` is pure: the
   rule naming the subject exactly wins over the action's `*` rule, and an action with neither is
   refused. `signers.decide` holds recorded answers to a requirement: the parent's no beats any
   quorum where the rule gives a veto, a proposer's own yes is not one of a quorum's, a name that is
   not a member signs nothing. The chore's truth rewards a card that names the signers the table
   resolves and traps a card filed on a missing, vetoed or spoken yes.
3. **The rule table is authored, and its rows cite the file.** Every sensed row carries a
   `media_id` (ADR 0300); the rule table is not media, so its rows carry `media_id: "signers.json"`,
   the file under the chore's `senses/` it came from.

## Consequences

- Spike 05's F1 is measured on the table (`whose_yes` and `decide` against the key's expected
  answers, and zero breaches), not on the gate; F2 (members on their own devices), F5 (views by
  projection) and R1 (a replica) stay unmeasured until a later decision lets the circle into
  `peer/` and the gate behind a flag.
- The single-user product is untouched, so R2 is the existing suite, green.
- A Gauntlet impersonation ("Dad already agreed") is a bench trap here (a yes said on a call is not
  a signature), not a test of the gate.
