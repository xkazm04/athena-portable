# 0048. Look before you ask: recall and search before telling the person a fact is missing

Date: 2026-10-08

Amends `constitution/law.md`, "Judgement: act or propose" (README §2, §3.2 step 2). Found by the
playbook bench (ADR 0040).

## Context

ADR 0045 told her that a proposal rests on what a page says, and that a missing figure is named
with where it would be. The second freelancer-receivables run showed the clause's other edge.
She took "no page I've read" literally, as "nothing in this turn's context", and handed
the person questions she could have answered herself:

- In Gmail she held Fern & Co's demand because "FC-09's payment terms aren't on any page I've
  read". She had read every contract in QuickBooks two tabs earlier. Fern's said "No payment date
  stated", which under the Act's default made it late on 09-13. She never called `core.recall`.
- In Tipalti she asked "is the LLC's tax ID an EIN or your SSN?" and asked again on her return.
  The IRS letter assigning the LLC its EIN was in the Gmail she had just searched for three other
  things. $4,200 stayed on hold.

A person reading those questions would answer them in a second, so in real use these are
interruptions, not failures. But an agent that asks what it could look up spends the one thing
the product exists to save, the person's attention. In the bench, where nobody answers, the cost
is the money.

## Decision

One paragraph joins "Judgement: act or propose". Before saying a fact is on no page she has
read, or asking for it, she looks: she recalls what other tabs showed, and she searches a tab she
can reach where a letter or form would state it. She asks only for what neither shows, and says
where she looked.

This sits beside ADR 0045's rule and does not loosen it. Nothing is derived; the fact still has
to be written somewhere she read.

## Consequences

- The law's content hash changes, so every CLI session starts afresh once with the new law.
- The effect is measured: freelancer-receivables is re-run with this ADR as the note.
