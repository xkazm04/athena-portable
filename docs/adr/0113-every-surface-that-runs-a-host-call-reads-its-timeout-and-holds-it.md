# 0113. Every surface that runs a host call reads its timeout and holds it

Date: 2026-10-15

Amends [0101](0101-a-timed-out-write-is-outcome-unknown-and-a-late-answer-is-heard.md): its
decisions 2 and 3 (the timeout reading and the unsure hold) belong to the window, not to the
panel's run loop. Leaves [0103](0103-an-approval-runs-on-the-tab-and-document-it-was-proposed-on.md),
[0105](0105-read-a-trusted-tab-by-name-and-hold-the-rest-of-the-turn-to-cards.md) and
[0106](0106-another-open-trusted-tab-may-be-proposed-on-and-every-such-call-is-a-card.md) as they
are: binding, `tabs_read` and `open_apps` stay panel-only.

## Context

ADR 0101 says "the hold is per window". In code it was per store. `stores/run.ts` read a page
`timeout` on a write as `outcome_unknown`, remembered the tool, added it to `gated_tools` on every
request, and refused locally a proposal that reached the page before the gate heard. Push-to-talk
(`stores/voice.ts`) runs the same host calls through its own copy of the loop, and that copy had
none of this. It reported the raw error, never remembered, never held, and sent the snapshot's
`gated_tools` without the unsure tools.

So a spoken "pay INV-118" whose page call timed out read as a plain failure, and the model was
invited to try again. The gate was not told to card it. A tool a typed turn had left unsure ran
unattended on the next spoken turn. That is the double send 0101 exists to prevent, and it came back
through the second surface.

## Decision

1. **One executor module.** `apps/desktop/src/lib/execute.ts` holds the rules, I/O-free apart from
   the `localStorage` mirror: `readTimeout`, `isReadCall`, `settleHostCall` (what an answer comes
   to: the timeout reason, the result's error, the transcript line), `heldBefore` (the local
   hold), and the unsure set (`rememberUnsure`, `forgetUnsure`, `unsureTools`, `withUnsure`). The
   set is module state on purpose, so both stores read one set.
2. **Both stores drive it.** The run loop's behaviour does not change; `stores/run.ts` re-exports
   the old names (`timeoutReasonOf`, `isReadCall`, `unsureTools`, `withUnsure`, `UNSURE_CAP`,
   `Unsure`, `PageAnswer`). The voice store now holds an unsure tool's call before the page, reads
   a timed-out write as `outcome_unknown` and remembers it, and sends `withUnsure(gated)` on its
   `start` and `text` frames.
3. **A spoken answer is an answer.** A `decision.resolved` by the user on the voice socket lifts
   the hold on the card's action, as the panel's button does. The gateway sends it before the
   approved call, so the approval runs. Without this, a spoken yes to an unsure tool's card would
   hold its own execute.

## Consequences

- Every surface in the window that runs a host call applies 0101. The next rule added to the
  executor reaches voice by construction instead of by a second copy.
- Voice gains a hold and a tighter `gated_tools`. Nothing loosens: the panel's cases in
  `run.test.ts` pass unchanged, and `voice.test.ts` pins the new ones.
- A spoken call of an unsure tool now gets `outcome_unknown` back before the page is asked, where
  it used to run. That is the intended cost: one card after a slow write, on either channel.
