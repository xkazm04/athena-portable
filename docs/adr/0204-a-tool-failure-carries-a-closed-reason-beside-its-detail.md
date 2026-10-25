# 0204. A tool's failure carries a closed reason beside its detail

Date: 2026-10-25

## Context

README §2 invariant 6 gives a failed turn a reason from one closed set, `ERROR_REASONS`, and
collapses anything invented at a call site to `unknown`. The rule stopped one level short. A
tool's own failure crossed the contract as one free string, `ToolResult.error` (and
`ExecResult.error`), which was sometimes a reason (`unknown_ref`), sometimes a reason glued to a
detail (`outcome_unknown: send did not answer within 30000 ms`), and sometimes a page's sentence
(`No tool named frob`). The consequences:

- The lane decided "may have completed" by `error.startswith("outcome_unknown")` (ADR 0101
  decision 6), so program logic branched on the prefix of prose.
- The desktop folds its reason into the text (`execute.ts`, `${timeout}: ${detail}`) because the
  contract had nowhere else to put it.
- ADR 0146 taught the bridge to forward a page's closed-set `reason` beside its `error`, and the
  contract was the hop that dropped it.
- `tool_results_from` capped a page's `output` to 1,600 characters but passed `error` whole, so
  a page that threw a 1 MB message wrote a 1 MB system episode (invariant 4).
- `channel.py` could not use `normalize_reason`: the vocabulary lived in `harness.py`, which
  imports `channel.py`.

## Decision

1. **The vocabulary has its own module.** `ERROR_REASONS` and `normalize_reason` move to
   `athena/contracts/reasons.py`, which imports nothing. `harness.py` and the package re-export
   the same objects, so every import, the bridge parity test and the 18 members in their order
   are unchanged.
2. **`ToolResult` gains `reason: str | None`**, decided at construction: `None` on success; a
   given reason normalized onto the vocabulary; otherwise derived from a legacy error by
   `reason_of_error`, which reads the whole error or its part before a colon and accepts it only
   when it is a member, exactly as written. Any other text is `unknown`. A page's sentence never
   becomes a member by its words.
3. **`ExecResult.reason` is a derived property** by the same rule. `ExecResult.failure(reason)`
   keeps its signature, so no executor changes.
4. **The detail is bounded.** `ERROR_DETAIL_CAP = 240` lives in the contract. `tool_results_from`
   cuts `error` to it with the announced `(showing N of M)` footer and passes the surface's
   `reason` key through. The field names are the bridge's (`reason` beside `error`, ADR 0146).
5. **Amends ADR 0101 decision 6:** the episode says "may have completed" when
   `result.reason == "outcome_unknown"`. A legacy prefixed error still derives that reason, so
   nothing the desktop sends today reads differently.
6. **The wire change is additive.** `events.ts` declares `reason?: string | null`. An older
   reader drops the key by the unknown-field rule. A newer reader given an older row derives the
   reason from its error.

## Consequences

- Every failure that crosses the seam carries a closed reason, and the record branches on a
  field, not on prose. A page can no longer grow an episode without bound through its error.
- The desktop can send `reason` directly instead of a prefix (`execute.ts`), and the rounds'
  once-per-name-and-reason refusal dedupe (`harness/rounds.py`, keyed on the error text today)
  can key on `reason`. Both are one-line follow-ups, left out here.
- A prefix written with a different case (`Timeout: ...`) reads as `unknown`, not `timeout`. That
  is deliberate: only an exact member is read as one. A writer that wants the reason sends it.
