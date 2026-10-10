# 0064. A flat incumbent fee is not a share

Date: 2026-10-10

Follows [0056](0056-how-the-best-use-of-athena-is-ranked.md) (b) and
[0057](0057-the-roster-of-100-playbooks-and-the-rules-they-are-authored-by.md) rule 5. Decided
before M4's `rank` is built, so that the ranking's first output reads row 37 the way this ADR says.

## Context

ADR 0056 (b) reports `fee_avoided_usd_year = proven_usd_year × pct / 100` wherever a playbook
carries `incumbent_fee_pct`, and never adds it to the score. ADR 0057 rule 5 asks for
`incumbent_fee_pct` "wherever an incumbent takes a share", and freezes the sourced economics at
the first bench.

Row 37, `household-employer-tax` (commit 2927d2e), stores Care.com HomePay's flat $708 a year as
`incumbent_fee_pct` 88.5 of the roster's $800 a year. Its own `economics.incumbent` says the
percent is a conversion: "a flat fee is owed whatever is found, so the percent is a conversion,
not a contingency".

Twenty committed `playbook.json` files carry an `incumbent_fee_pct`. Each one's
`economics.incumbent` was read. Nineteen name a share of what an incumbent recovers, collects or
saves (cpg-deductions' 30% is a real share, SupplyPike's industry standard). Row 37 is the only
flat fee among them. Since B5a, every batch brief has said not to convert a flat fee, so no later
row has done it. Nothing in `check` or in the method text says what the field means, so the next
reader of the ranking would take 88.5% for a contingency.

## Decision

`incumbent_fee_pct` means a contingency share only. This is the App Master's ruling, decided
headless on 2026-10-10. It changes no score, and the operator may overrule it.

1. **`incumbent_fee_pct` is the part of what is recovered that an incumbent takes.** A flat fee (a
   subscription, a per-filing price, an hourly rate) is never converted into it. A flat fee is
   written in `economics.incumbent` with its source, and the ranking computes nothing from it.
   There is no new field.
2. **Row 37 keeps its 88.5.** Rule 5 freezes it, and 0056 (b) reports the figure without scoring
   it, so no score moves. Its reported fee avoided is 800 × 1.0 × 0.885 = $708 (its `bench.json`
   has `recall_value` 1.0). That equals the flat fee only because recall is 1.0. The ranking's
   method text names row 37 as the one converted flat fee. `rank` gets no special case keyed on a
   playbook id.

## Consequences

- M4's `rank` reports row 37 as written, and the method text flags it.
- The table of nine in 0056 is unchanged, because row 37 is not in it.
- A later playbook whose incumbent charges a flat fee carries no `incumbent_fee_pct`.
- `check` is not changed, because a machine cannot tell a conversion from a share.

## Alternatives that lost

- **Editing row 37's `playbook.json`.** It breaks rule 5's freeze after the first bench.
- **Converting every flat fee to a share for uniformity.** A flat fee is owed whatever is found, so
  scaling it by recall misstates it whenever recall is below 1.
- **A new `incumbent_fee_usd_year` field.** It adds schema for a figure on one row that is
  reported and never scored.
- **A `rank` special case keyed on the id.** It puts one row's history into code.
