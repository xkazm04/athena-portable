# 0162. A send is approved on its letter

Date: 2026-10-25

Builds on ADR 0017 (the demo kit's shared activity log) and the hirelane gate contract (DESIGN-LAW
section 7). Governing standard: hitl-approval (oracle-before-gate, resume-after-decision).

## Context

Hirelane has two acts that reach a person and can never be taken back: `send_rejection` and
`send_scheduling_email`. Both were approved without the words. The dossier's armed gate named the
rejection by its wording's label and the slot by its select row, and Athena's approval card could
quote only `template: "encouraging"`. Nobody read the letter until it had gone. One label was
also false: "Encouraging - names the strengths" sat over a body that names no strength and reads no
scorecard, so the reviewer was approving on a claim the letter contradicts.

The letter is a pure function of data the board already holds (`rejectionMail` and
`schedulingMail` in `lib/mail.ts`, client-safe), so it can be computed before the act.

## Decision

1. **`preview_message` is an AUTO read on the board layer.** `previewMessage(board, { applicant_id,
   kind, template?, slot_id? })` in `components/board/tools/preview.ts` composes through the same
   two functions with the same arguments the actions pass (name, address, role title, slot). It is
   `reversible: true, sideEffects: "none"`: it writes nothing, and the sends stay GATED.
2. **It refuses where the send refuses, in the send's words.** The checks run in the actions'
   order with the predicates they guard with (`decidedReason`, `scheduleReason`, `canBook`) and
   return `REFUSAL` sentences. A preview that showed a letter the action would not send would be a
   second, kinder gate.
3. **The armed gate shows the letter.** Gate.tsx renders the subject and body from `letterFor`
   (the function `previewMessage` composes with) above the controls in both armed states, and it
   follows the wording and slot selects. `DossierGate` takes the role's title as a prop for this.
4. **A label claims nothing the letter does not say.** The encouraging label becomes "Encouraging
   - warm, says it was a hard decision". The sent wording does not change. Making the letter name
   the applicant's strongest criteria would change what leaves the building, so it is left as a
   separate direction.

## Consequences

- `test/preview.test.ts` compares every preview with the real send's `mail` on a scratch database,
  byte for byte, so the letter shown cannot drift from the letter sent. It also pins the refusals,
  a no-write sweep over every applicant, and a mechanical label check: a label may use "strengths"
  or a rubric criterion's word only if its letter does.
- The register gains a seventeenth tool, an AUTO read. The foot's counts derive from the manifest,
  so nothing is retyped.
- The dossier read's two send acts name `preview_message` (`read_the_letter_with`), so an agent
  knows where the words are before it raises an approval.
