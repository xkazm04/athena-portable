# 0155. One act machine per card: one armed gate, one write in flight, one door

Date: 2026-10-25

## Context

The ledgerbox L2 card ran its acts on states that could not see each other: the card's own
`useRun` (for Evidence's apply and unapply and the AUTO rows), one more `useRun` inside every
`Gate`, and one `armedOn` per `Gate`. So a person could arm Record and Void at the same time, and
could confirm Send while a redraft they had just pressed was still in flight, because an idle or
armed gate read only its own pending. `sendReminderAction` sends whichever unsent draft is newest
at the server, so that send could dispatch a letter the person never saw: approval of version N
became approval of N+1 across an in-flight write that `gateSubject` could not see, since the
subject check only ran on the next render. A double click on a confirm could land twice before
`useTransition`'s pending repainted. And because the act list was built inline in JSX, its rules
(which rows gate, what each is armed on, which refusal each prints) were pinned by regexes over
`Decide.tsx`, not by behaviour.

## Decision

1. **The list is data.** `components/lanes/card/acts.ts` `actSpecs(mark, detail, tone, category)`
   returns each act's tool, label, what it reaches, its `blocked` line (`actRefusal`'s), `gated`
   (`!isAuto(TOOL_CLASSES[tool])`), question, subject (`gateSubject`) and an issue descriptor.
   `Decide` maps only the per-act parameters (tone, file-under) to JSX and the descriptor to its
   server action.
2. **One machine.** `reduceActs` over `{armed, issuing, ticket, focus}`: arming refuses while any
   write is in flight and disarms any other armed act; take and confirm refuse while any write is
   in flight; an armed gate stays armed while its own confirm is in flight; `observe` closes an
   armed gate whose subject moved or whose act is now refused; `settle` ignores a stale ticket and
   otherwise closes the gate, answered or thrown.
3. **One door.** `createActDoor` holds the state in a closure that moves synchronously before the
   view is told, and every write the card issues passes through it: the five listed acts and
   Evidence's apply and unapply. A second press in the same tick is refused with no call made.
   `useRun` is its transport (toast, refresh, the throw path), not a per-component state.
4. **Gate is controlled.** It takes `armed`, `busy`, `onArm`, `onCancel`, `onConfirm` and holds
   no armed state and runs no write.
5. **Focus is the machine's answer.** A cancelled or settled act hands focus to its own row; a row
   that is now disabled cannot hold it, so focus goes to the list's heading.

## Consequences

- No two confirms can be armed on one card, no confirm or arm is accepted while another write on
  the invoice is in flight, and a double submit issues once.
- The act list's rules are pinned as behaviour in `test/ledgerbox-lanes-ui.test.ts`; three source
  regexes over `Decide.tsx` were removed.
- Not closed here: an agent's `draft_reminder` landing at the server between the person's arm and
  confirm still races, because the send does not name the draft it was armed on. That needs a
  compare-and-set argument on `sendReminderAction` (`app/actions.ts`) and is left to that file's
  own change.
