# 0041. A refusal is told to the model in the same turn

Date: 2026-10-07

Refines the round loop of [0031](0031-a-token-factory-modelfn-is-a-third-engine-behind-the-same-gate.md)
(`harness/rounds.py`, shared by every engine). Found by the medical-bills playbook (ADR 0040).

## Context

The round loop fed back only what executed. A gated op waits on the user, a host tool waits on
the page, a dropped envelope is told next turn; none of those needed another round. A *refused*
op — the structural policy saying no (`origin_pinning`, `origin_enabled`, an allow-list), or a
validator — was streamed as a failed `tool.result` and then nothing: if nothing else was in
flight, the turn ended.

The first medical-bills bench showed what that costs. Working in Cedar, Athena tried to re-read
the insurer's EOBs; the gate correctly refused every call (`origin_pinning`). She never heard it:
her turn ended with "once these reads return, I'll file the CB-3 dispute, the CB-7 refund and the
CB-11 payment as separate cards". Nothing was in flight, so nothing returned, and nothing was
filed — $1,795 of the run's value, and later a $1,240 appeal the same way. A person watching the
desktop would have waited on a promise the system had already broken.

## Decision

1. **A refusal is fed back in the same turn.** A `Cancel` without a card is final, so it joins
   the round's feedback and the model gets one more round to adapt: to recall what it read
   elsewhere, to ask the person to switch tabs, or to say plainly what it cannot do.
2. **Told once.** The same refusal (tool name and reason) is fed back once per turn. A model that
   retries it is refused again and not told again, so a stuck model ends the turn rather than
   spending the eight-round budget.
3. **A card is not a refusal.** A gated call that filed a card is still not fed back: it is
   waiting on the user, and asking the model again would only invite a second card.
4. **The `origin_pinning` sentence says what to do instead**: another tab's tools cannot be called
   from this one; use `core.recall` for what was read there, or ask the person to switch.

## Consequences

- A turn with a refused op costs one more provider round. It is still one turn and one ledger
  row, and the round count in the row shows it.
- Tests that scripted one model reply per refused turn now script the reply she gives after
  hearing the refusal (`tests/daemon/test_disabled_origins.py`); a new test pins "told once".
- The Gauntlet's injected model, which only obeys the attack, now retries a refused write once in
  a turn. The verdict still comes from the gate's records and is unchanged: held.

## Amendment: a dropped op too (same day)

The clinic-denials playbook found the second door into the same dead end. Athena's first ops of
a session were dropped — one named no tool (`'' is not a name you can address here`), and a
malformed envelope is dropped the same way — and a drop, like a refusal before this ADR, was told
"in the next turn's frame". There was no next turn: nothing was in flight, so the phase ended with
her saying "I'll read each claim from there" and nothing read, and every later phase starved for
claim ids. A dropped op (an unknown name or an unparseable envelope) is now told in the same turn,
once per name and reason, through the same path as a refusal; the unknown-name sentence carries
the envelope as she wrote it, so she can see what she got wrong.
