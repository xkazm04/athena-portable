# approval-cards

**When** a tool writes, **make it GATED, give it arguments a person can judge on the card, keep it
correct when it runs late or twice, and answer a write that ran as done**, **because** the card is the
only place the person sees the change, and Athena runs it only after the person signs.

## How a GATED call travels

1. She proposes the call (`OP: propose_action` naming `host.<app>.<tool>` and its params, with a
   rationale). The gate validates the params first (`validator_failed` before any card exists), then
   files an approval row and emits `decision.requested` (`harness/hooks.py` `GateHook.before_tool_call`).
2. The card shows the app, the tool, "Why: <rationale>", up to 3 facts, "Nothing runs until you sign",
   and a notice when the contract drifted; its back shows every parameter, the contract before and now,
   and a capture of the tab (`apps/desktop/src/companion/slip.tsx`; ADR 0066, 0099).
3. Approve (or key A, or voice) replays the gate with the approval id; the surface receives `execute`
   and runs the tool on the page (ADR 0010, 0038). The approval is spent once used.
4. It runs only on the tab and document it was proposed on: if the document reloaded or navigated since,
   it is refused `unknown_ref` (ADR 0103).
5. A call that times out is `outcome_unknown`; a late answer is heard (ADR 0101).

## Rules for the producer

1. **Arguments are the card.** Prefer small, readable arguments (`find`/`replace`, `tone`, `enabled`) to
   a whole document; the person reads the back of the card, not the handler.
2. **Idempotent where possible.** A write that may be re-sent after a timeout states its effect
   (`set_tone{id, tone}` sets, it does not toggle).
3. **Freshness on writes to shared state** (digest-guarded-edits).
4. **The answer of a write that ran is "done"**, even when it is too long to show (result-budget rule 5).
5. **Never reload the document from a read**, or a pending card dies with it (orient-tools rule 5).
6. **Out of reach is a decision, written down.** Publishing, sending to a person, payments, moderation of
   real users, credentials: no tool, and the guide says so ("What stays out of reach").

## Checks (keyless harness)

- An approved card returns one `execute`, the page runs it once, the scratch file changes, a backup
  exists.
- A declined card: no write, no backup, no second turn, an empty `execute`.
- On the real desktop: the card's own Approve and Decline buttons, pressed until the card is stamped
  (walkthrough-operations).

## Evidence

Shadowrunr scripted suite "Shape Malakor" and "Decline" cases; desktop e2e "shapes Malakor through a real
card" and "a declined card changes nothing" (2026-10-23, 6/6). In the exploration session she filed two
feedback marks that were approved through her UI.

## Registry

`hitl-approval`: approval binds to what was approved; "timeout is deny or hold, never proceed"; the
decision surface shows the actual change; resume runs the staged artifact (agrees on every point;
Athena's contract hash and document binding are the binding). `hitl-approval/decision-records`: the
approval table is the record.
