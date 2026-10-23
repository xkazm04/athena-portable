# 0133. A chore's figures say what kind of money they are, and the example's money is derived

Date: 2026-10-23

Amends [0056](0056-how-the-best-use-of-athena-is-ranked.md) (what earns money points) and
[0040](0040-a-playbook-is-data-and-earns-its-place-on-the-bench.md) (what `playbook.json` carries).
Follows the chores UAT of [0132](0132-chores-are-certified-by-a-character-played-onboarding-and-rehearsal.md),
run `uat/runs/2026-10-23-chores/` (themes 1, 2, 7 and 9). README section 14.

## Context

The chores UAT found two in three figures on a chore's page without a source, and many of them
disagreeing with each other or not money at all. Three things in the data caused it:

- One number, `economics.value_usd`, the author's yearly estimate, was shown beside the bench
  world's answer-key total as if they were the same quantity. They are not: one is a guess about a
  typical year, the other is what the invented example case holds.
- Truth weights were summed as "found" whatever they were. ADR 0056's 2026-10-09 amendment let a
  playbook weight its items at a per-act price or an exposure unit so the scorer has something to
  weigh; the desktop then added those weights to real refunds. A $1 screening weight, a $5,000
  liquidated-damages claim, a $16,550 penalty ceiling and a $380,000 lien exposure all became
  "dollars found" (39 to 66% of some areas' totals, finding families freight-03, employment-04,
  consumer-03).
- Nothing said where a chore works or for whom: Texas, California and New York chores ran for
  people in other states, and "is this for a shop my size?" went unanswered 11 times in 11.

The operator ruled (fix contract, 2026-10-23): one measured figure plus a labelled estimate, and
every figure labelled by kind.

## Decision

1. **`economics.value_kind`** says what the author's estimate is: `money_back` (money that comes
   back to the person), `money_protected` (exposure or loss avoided, payments released earlier) or
   `penalty_avoided`. Absent means `money_back`.
2. **`economics.kinds`** maps every truth target tool to the kind of its `value_usd` weights: the
   three above, or `count`, a scoring weight that is never shown as dollars. When present it names
   exactly the truth's targets, so a renamed or added target cannot keep a stale kind or default
   silently. A tool it leaves out is `money_back` to every reader.
3. **`economics.example_usd`** is the example case's money back: the sum of the eligible items of
   the `money_back` targets, rounded to cents, `null` when no target is `money_back` (unmeasured is
   not zero). It is derived, never typed: `python -m athena.proving.playbooks derive` writes it by
   editing that one value in place and keeping every other byte of the file, so a hand-formatted
   playbook stays as written; a second run changes nothing; `--check` reports drift.
4. **`fit`** says where the chore works (`"US"`, `"EU"`, another region word, or a list of USPS
   state codes), a sentence on why, who it fits, who it does not, what it will ask for, and what it
   costs the person. Absent means the surfaces say nothing about fit; no default is invented.
5. **Where the checks sit.** The loader checks the shape of all four when present, so a playbook
   mid-edit still loads and benches. `check` also requires `example_usd` to be present and equal to
   its derivation, so the committed library cannot carry a typed or stale figure.
6. **Only `money_back` earns money points (amends ADR 0056 (a)).** A row whose `value_kind` is
   `money_protected` or `penalty_avoided` scores 0 money points and is ranked on its minutes and
   its edge; the row still carries `value_usd`, `value_kind` and `counted`, so a reader sees what
   was left out and why. Exposure and penalty ceilings are upper bounds that are rarely paid in
   full, and a lien protected is not a dollar received; summing them with refunds is the error the
   UAT found, and the ranking made it too.
7. **A price or a wage is not money back.** Where the author's estimate was the price a service
   would charge for the work, or staff time at a wage, the estimate is `$0` of money back and the
   price moves into `basis` as the price of the hours, which `manual_minutes` already scores
   (ADR 0056's amendment for a playbook worth no money). Its truth weights are `count`.

## Consequences

- `bench.content_digest` reads only `world.json`, `truth.json`, `command` and `expectation`, so
  none of these fields touches bench comparability; no playbook needs a re-bench for them.
- `ranking.json` changes shape (two keys per row) and order (protected and penalty estimates lose
  their money points); `rank --check` stays the drift test once it is regenerated.
- Until every playbook is derived, `check` refuses the library. The wave that lands this ADR
  derives all of it before commit.
- The desktop, the adopt brief and the rehearsal read the same fields with the same defaults
  (packages WP-N, WP-B and WP-R of the same wave).

## Alternatives that lost

- **Hand-typed `example_usd`.** It would drift from the truth the first time an item moved, which
  is how the topic page came to show three figures for one quantity.
- **Kinds on each truth item in `truth.json`.** Closer to the data, but `truth.json` keys bench
  comparability; editing it would orphan every committed run.
- **A non-money `value_kind` for prices and wages (`price_avoided`).** It would keep a dollar figure
  on chores that return none, and the contract's three kinds already say what the person gets.
