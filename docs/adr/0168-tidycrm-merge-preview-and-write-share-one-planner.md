# 0168. TidyCRM's merge preview and merge write share one planner

Date: 2026-10-25

Builds on ADR 0004 (the gate is the policy) and ADR 0163 (TidyCRM's stored flags have one writer
and an oracle).

## Context

`merge_contacts` is the one irreversible, GATED write in TidyCRM. Its preview, `preview_merge`,
returned the two records and the fields they disagree on, and nothing about what the merge would
do. That was decided inside `mergeContacts`, after the approval: which values the survivor adopts
(a valid phone, a newer last-activity date), which other open pairs the dropped record stood in and
would be closed as `skipped`, which flags would move (the survivor leaving Stale or Phone format,
the domain leaving Company conflicts when the dropped record held its last odd spelling). The
person approving the card approved it blind, and the silent closure of other pairs surfaced only as
a vanished queue entry. Normalise and settle-a-company already plan before they write
(`planNormalize`, `planCompany`); merge was the one write without a planner, and the irreversible
one.

## Decision

1. **One planner.** `planMerge(keepId, dropId)` in `examples/tidycrm/lib/mutations.ts` checks the
   write's refusals in the write's order with the write's words, then returns the plan: `adopts`
   (field, from, to), `closes` (the other open pairs, by the same query `closeDependentPairs` runs),
   `restamps` (each flag's rule, `deriveFlags`, applied to the inputs the write will leave, over the
   rows and the domain the write restamps), `survivor` (its stored phone, date and two row flags
   after the write) and a one-sentence `summary`.
2. **The write executes the plan.** `mergeContacts` refuses with the plan's `refusal` and otherwise
   writes the plan's adoptions through the field door (ADR 0163). It stays GATED and
   `reversible: false`; its refusals and its activity summary are unchanged.
3. **The preview carries the plan.** `previewMerge(pairId)` is `previewPair` plus the plan's
   `outcome`; `previewMergeAction` returns it, so the `preview_merge` tool, which hands the object
   back verbatim, shows the outcome with no tool change. The existing fields keep their values.

## Consequences

- What the person approves is what runs: `test/merge-plan.test.ts` walks ten merges and asserts
  the survivor equals the planned survivor field for field, every planned flag lands where planned,
  and the pairs whose status changed are exactly the settled pair plus `outcome.closes`.
- A preview of a pair that can no longer be merged says why, in the refusal the write would give.
- The plan is read outside the write's transaction, as before; the write re-plans at execution, so
  a world that moved between preview and approval gets the planner's own refusal or the new plan.
- The preview is additive: a caller that deep-equals the whole preview object now sees `outcome`.
- Nothing about the gate class changes; the preview loosens no policy.
