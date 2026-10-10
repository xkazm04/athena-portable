# 0056. How the best use of Athena is ranked

Date: 2026-10-09

Follows [0040](0040-a-playbook-is-data-and-earns-its-place-on-the-bench.md) and
[0051](0051-the-count-is-held-to-the-bar-and-deadlines-are-required.md). README section 14.
Decided before the 91 playbooks of ADR 0057 are benched.

## Context

Nine playbooks are benched, and ninety-one more are planned (ADR 0057). The point of a hundred is
to find the best use of Athena. "Best" needs a method, and the method has to be fixed before the
new results exist. Otherwise it gets fitted to them: a weight is nudged until the favourite comes
first.

What each playbook already gives:

- `playbook.json` → `economics`: `value_usd` with its `per`, `manual_minutes`,
  `incumbent_fee_pct` on three of the nine, and `sources`. `edge`: `difficulty` and `usefulness`,
  1 to 5 each, which `spec.py` checks. `expectation`: `recall`, `false_claims`, `minutes`.
- `bench.json` → `verdict.word`, and `score` (`found`/`eligible`, `value_found_usd`/
  `value_total_usd`, `recall_value`, `false_claims`, `traps_filed`, `traps_total`). Also `wall_s`
  and `your_time_s`, which is a model of the time spent signing: 30 s a card plus 10 s a nudge,
  `SECONDS_PER_CARD` in `bench.py`.

Two readings of those files settle what the inputs mean:

- `per` takes four values so far: `year` (carrier-accessorials, cpg-deductions,
  fba-reimbursements, freelancer-receivables, lien-desk, ltc-claims), `month` (clinic-denials),
  `estate` (estate-settlement) and `episode` (medical-bills). medical-bills' basis calls its
  episode "one year with an ER visit and a surgery".
- `manual_minutes` is the time by hand for **the chore the bench world holds**, not for a whole
  `per`. The README's "36 minutes of her time against about 95 hours by hand" is the sum of the
  nine `wall_s` (2,150 s) against the sum of the nine `manual_minutes` (5,730). carrier-accessorials
  gives 150 minutes for a world that holds two weeks of loads, so its 150 minutes are not a year
  of work.

## Decision

### (a) One annual footing for money: a stated table, and no field for it

| `per` | Times a year | Recurs |
|---|---|---|
| `year` | 1 | yes |
| `quarter` | 4 | yes |
| `month` | 12 | yes |
| `week` | 52 | yes |
| `estate` | 1, in the year it happens | no |
| `episode` | 1, in the year it happens | no |

`annual_usd = value_usd × table[per]`. A one-off counts once, because its value lands on the
person in the year they have the chore: the executor's year, the bad health year. `recurs` is
reported beside it, so a reader sees that a one-off is not money every year. `rank` refuses a
`per` outside this table and names the playbook. Adding a row to the table takes an amendment to
this ADR.

### (c) Minutes saved per year: one new optional field

**One new optional field: `economics.times_per_year`, a number greater than 0, default 1. It
gives how many times a year the persona does the chore that the bench world holds, at its
`manual_minutes`. It multiplies minutes saved, and never money.**

```
person_minutes      = (bench.wall_s + bench.your_time_s) / 60
saved_per_time      = manual_minutes − person_minutes
saved_minutes_year  = saved_per_time × times_per_year
```

The person's minutes are the run's wall clock and the modelled signing time, added together. That
is the conservative reading: she may watch the run, and she certainly signs it. A frequency is a
claim, so when the field is present the playbook's `economics.basis` says where it comes from.
When it is absent the frequency is 1: the ranking never assumes a recurrence that nobody wrote
down. `spec.py` leaves `economics` open, so the nine existing playbooks load unchanged, and with
the default they are ranked on one pass of their world. Every playbook of ADR 0057 carries the
field.

### (b) How the bench weights a claim

`proven_usd_year = annual_usd × recall_value`, using `recall_value` from the `bench.json` run (not
from its history).

A playbook is **not ranked**, and is listed under `unranked` with the reason, when any of the
following holds:

- it has no `bench.json`;
- its verdict is `short` (it ships short with its reasons, ADR 0057);
- `false_claims > 0` or `traps_filed > 0`, whatever its expectation allowed;
- `economics.sources` has no entry with a URL;
- its `per` is not in the table.

These rules exclude a playbook; they never demote it. A false claim is the one thing Athena may
not do: an irreversible act on a wrong claim. If a false claim only demoted a playbook, enough
money could buy the demotion back. `meets` and `exceeds` are treated alike. The count of items
already enters through the verdict (ADR 0051), so it is not counted twice.

`incumbent_fee_pct`, where it is present, is reported as `fee_avoided_usd_year = proven_usd_year ×
pct / 100` and is not added to the score. That money is part of what was found, and adding it
would count it twice.

### (d) The combination: three points of 0 to 5, equal weight

```
money_points = clamp(log10(proven_usd_year) − 1, 0, 5)       $100 → 1, $10k → 3, $1M → 5
time_points  = clamp(1 + log10(saved_minutes_year / 60), 0, 5)   1 h → 1, 100 h → 3, 10,000 h → 5
edge_points  = sqrt(difficulty × usefulness)                   4/4 → 4, 5/5 → 5, 5/1 → 2.24
score        = money_points + time_points + edge_points        (rounded to 0.01)
```

- **Logarithms**, because the economics are sourced estimates good to a factor of two or so.
  Orders of magnitude are what the sources can support. A logarithm also stops one figure from
  carrying the ranking: lien-desk's $380,000 is 4.58 points, not seven times cpg-deductions'.
- **The two scales meet at $100 an hour.** One point per factor of ten on each scale, with 1 hour
  = 1 point and $100 = 1 point. That rate sits inside the hourly fees the sources quote for doing
  these chores for someone (patient advocates at $50–250 an hour, medical-bills' sources).
- **The edge is a geometric mean,** so that a lopsided 5/1 scores below a balanced 3/3. It keeps
  the order of the desktop's own sort by `difficulty × usefulness`.
- **The weights are equal.** Nothing measured yet justifies weighting one axis above another, and
  choosing a weight after seeing the results is exactly the fit this ADR exists to prevent.
- **Tie-breaks, in order:** higher `proven_usd_year`, then more `saved_minutes_year`, then the
  `id` alphabetically. A one-off and a recurring chore are not separated by a tie-break. `recurs`
  is reported instead.

### (e) The output: `playbooks/ranking.json`

A later `python -m athena.proving.playbooks rank` regenerates it, and `rank --check` exits 1 when
the committed file differs from what it would write. This run does not build the command. The
file carries no timestamp, so that regenerating it from the same inputs gives the same bytes.
`load_all` skips it because it is a file, not a directory with a `playbook.json`, and the
desktop's glob (`playbooks/*/playbook.json`) does not match it.

```json
{
  "schema": 1,
  "method": "docs/adr/0056-how-the-best-use-of-athena-is-ranked.md",
  "ranked": [
    {
      "rank": 1, "playbook": "lien-desk", "domain": "Construction", "audience": "work",
      "score": 11.98,
      "points": {"money": 4.58, "time": 2.4, "edge": 5.0},
      "money": {"value_usd": 380000, "per": "year", "annual_usd": 380000, "recurs": true,
                "recall_value": 1.0, "proven_usd_year": 380000,
                "incumbent_fee_pct": null, "fee_avoided_usd_year": null},
      "minutes": {"manual": 1500, "person": 8.8, "saved_per_time": 1491.2,
                  "times_per_year": 1, "times_per_year_stated": false,
                  "saved_per_year": 1491.2},
      "edge": {"difficulty": 5, "usefulness": 5},
      "bench": {"run_at": "2026-10-07T23:43:59Z", "model": "sonnet", "verdict": "exceeds",
                "found": 10, "eligible": 10, "false_claims": 0,
                "traps_filed": 0, "traps_total": 12}
    }
  ],
  "unranked": [{"playbook": "<id>", "why": "short: found 2 of 10 items, expected 75%"}]
}
```

### (f) What the ranking cannot claim

- **The worlds are mock.** A bench proves her judgement on the data and the rules a world holds,
  not that a real portal registers these tools (ADR 0040). `recall_value` is measured on one
  world, on one run, with one model (Sonnet). Applying it to an annual figure is an
  extrapolation, and the file says so in its method.
- **The actors are invented.** No ranked figure is any real person's money.
- **The economics are sourced estimates.** Several sources are vendor figures, and the playbooks
  say so. A rank is as good as its playbook's sources, and the ranking reports the figure; it does
  not vouch for it.
- **The money is not all of one kind.** lien-desk's value is "protection, not recovery", what a
  missed day would put at risk. estate-settlement's is professional fees avoided. Most of the
  rest is money recovered. The ranking adds them as though they were one kind. It cannot claim
  that lien-desk's $380,000 would otherwise be lost. (Even at a tenth of that, lien-desk scores
  10.98 and stays first.)
- **The default frequency understates.** A playbook without `times_per_year` is ranked on one pass
  of its world. carrier-accessorials' world is two weeks, so its minutes a year are understated
  until the field is added with a source.
- **The edge is the author's judgement.** It is the only input set without a source. ADR 0057 fixes
  it before the first bench, along with the expectation.

### Worked on the nine benched playbooks

From the committed `playbook.json` and `bench.json` on this branch, with `times_per_year`
defaulted to 1 for all nine. Every one is `exceeds` with 0 false claims and 0 traps filed, so all
nine are ranked.

| # | Playbook | value / per → annual | recall | proven $/yr | money pts | d/u → edge pts | manual − person = saved min/yr | time pts | score |
|---|---|---|---|---|---|---|---|---|---|
| 1 | lien-desk | 380,000 / year → 380,000 | 1.000 | 380,000 | 4.58 | 5/5 → 5.00 | 1500 − 8.8 = 1491.2 | 2.40 | **11.98** |
| 2 | clinic-denials | 4,200 / month → 50,400 | 1.000 | 50,400 | 3.70 | 5/5 → 5.00 | 600 − 7.6 = 592.4 | 1.99 | **10.70** |
| 3 | estate-settlement | 20,000 / estate → 20,000 (one-off) | 0.920 | 18,400 | 3.26 | 5/5 → 5.00 | 1200 − 11.5 = 1188.5 | 2.30 | **10.56** |
| 4 | ltc-claims | 20,000 / year → 20,000 | 1.000 | 20,000 | 3.30 | 5/5 → 5.00 | 360 − 9.8 = 350.2 | 1.77 | **10.07** |
| 5 | cpg-deductions | 60,000 / year → 60,000 | 1.000 | 60,000 | 3.78 | 4/4 → 4.00 | 900 − 7.7 = 892.3 | 2.17 | **9.95** |
| 6 | carrier-accessorials | 12,000 / year → 12,000 | 1.000 | 12,000 | 3.08 | 4/4 → 4.00 | 150 − 9.0 = 141.0 | 1.37 | **8.45** |
| 7 | medical-bills | 3,423 / episode → 3,423 (one-off) | 1.000 | 3,423 | 2.53 | 4/4 → 4.00 | 480 − 5.8 = 474.2 | 1.90 | **8.43** |
| 8 | fba-reimbursements | 5,000 / year → 5,000 | 1.000 | 5,000 | 2.70 | 4/4 → 4.00 | 300 − 5.1 = 294.9 | 1.69 | **8.39** |
| 9 | freelancer-receivables | 6,000 / year → 6,000 | 0.979 | 5,874 | 2.77 | 4/4 → 4.00 | 240 − 6.0 = 234.0 | 1.59 | **8.36** |

Fees avoided, reported and not scored: cpg-deductions $18,000 a year (30%), fba-reimbursements
$1,250 (25%), medical-bills $856 (25%).

What the table shows, read before anything new is benched:

- The four 5/5 playbooks lead, and the edge separates them from the 4/4 group by a full point.
  cpg-deductions, at 4/4, is 0.88 ahead of ltc-claims on money and time together, and still ends
  0.12 behind it.
- Places 6 to 9 sit within 0.09 of one another. At this resolution they are a tie, and the
  tie-breaks or a better-sourced `times_per_year` will decide them.

## Consequences

- The method is fixed in writing before the 91 runs exist. A change to it is an amendment to this
  ADR, dated, with the table worked again, so a fit would be visible as an amendment that
  postdates the results.
- `rank` is not built in this run. Until it is, the table above is the ranking, and it holds only
  for the commits it was read from.
- Adding `times_per_year` to the nine existing playbooks, with a source each, is a later change to
  `playbooks/`. It can only raise their minutes, because the default is the floor.
- `spec.py` does not check `times_per_year` or `per`. `rank` refuses a bad `per`; a later change
  may make `check` refuse it too, with a test.

## Alternatives that lost

- **Scaling minutes by money** (`manual_minutes × annual_usd / value_total_usd`). No field is
  needed, but it reads estate-settlement as 215 minutes a year (its world holds a $93,200
  disclaimer that is not the $20,000 a year) and lien-desk as 23 hours, for a desk its own basis
  says runs every month.
- **A linear weighted sum of dollars and hours.** lien-desk's $380,000 would outweigh every other
  input in every playbook, and so would the next large figure an author wrote.
- **Rank sums (Borda).** They are robust to outliers, but each playbook's place would depend on
  which others are in the set, so a new batch would reorder old rows for no reason in those rows.
- **Demoting rather than excluding a short or false-claim run.** Enough money could then buy back
  a wrong claim.
- **Counting a one-off as a fraction of a year** (an estate every twenty years). It ranks the
  chore by how rarely it happens rather than by what it is worth to the person who has it.

## Amendment, 2026-10-09: a playbook worth no money, and a chore she does no faster

Checked against the code and the data before writing. `bench.py` sets `recall_value` to `None`
when the truth's total value is 0 (`round(found_value / total_value, 3) if total_value else
None`), and `verdict` reads that as `float(… or 0.0)`. A world whose items are all worth $0 is
therefore always `short`, whatever it finds. `playbooks/data-broker-deletion` (ADR 0057 row 6,
"$0 / year, mostly minutes") was authored around this: each truth item is weighted $6.45, a fifth
of DeleteMe's $32.25 a sweep, the weight is stated in each item's `why` and in `economics.basis`
as a price avoided, and `economics.value_usd` stays 0. Three more rows of ADR 0057 start their
value cell with "$0 /": `name-change-everywhere` (B4), `denied-party-screening` (B5) and
`bid-opportunity-triage` (B9). Section (d) has a second hole of the same kind: `log10` is
undefined at 0 and below, and `proven_usd_year` is 0 for every one of these rows, while
`saved_minutes_year / 60` is not above 0 for any playbook whose person minutes reach
`manual_minutes`. `rank` and M4's ranking command need a rule, and the method has to be fixed
before the data reaches them.

**The rule, from here on:**

1. **A row worth $0 keeps `economics.value_usd` at 0.** Each truth item is weighted at a stated
   per-act price: the price an incumbent publicly charges for that act, with its source, equal
   across items whose acts are alike. Where no public price exists, each item is weighted $1 and
   called a count weight. The weight is written in each item's `why` and in `economics.basis` as a
   price avoided, not money recovered, and the README section 14 row says so. The verdict then
   reads the count. The weights give the ranking no money, because `proven_usd_year = annual_usd ×
   recall_value = 0 × recall_value = 0`.
2. **A non-positive input to either logarithm in (d) scores 0 points on that axis,** which is the
   clamp's lower bound. `rank` never evaluates `log10` of a value ≤ 0: it tests the input first. Such
   a playbook is still ranked on its other points, unless one of (b)'s exclusions applies.

**The constraint that forced it.** The scorer's fallback cannot be changed to make a bench pass
(the operator's rule: never weaken a gate, the scorer or `truth.json`), and the ranking needs a
finite score for every ranked row. The weights give the bench a number to divide by; the clamp
gives the ranking a number to add.

**Alternatives that lost**

- **Making `bench.py` fall back to count recall when the total value is 0.** It edits the scorer,
  which the operator's rule keeps out of bounds for making a bench pass, and the convention
  leaves all 15 benched verdicts unchanged, so it buys nothing the convention does not.
- **Excluding $0 rows from the ranking.** They are the roster's purest test of the time axis,
  which ADR 0057 chose on purpose; dropping them would drop the rows that test it.
- **A $1 floor on money** (`proven_usd_year` of at least $1, so the logarithm is defined). It
  invents money the row does not find, and a fitted floor is the nudge this ADR exists to
  prevent.

**What this does not change.** The table of nine above, the clamp's bounds, the weights of the
three axes and the exclusions in (b) stand. Nothing already ranked moves: none of the nine has a
non-positive input.

## Amendment, 2026-10-10: a flat fee is not a share

`incumbent_fee_pct` is a contingency share only; a flat fee is never converted into it. The ruling,
and how row 37 (`household-employer-tax`, the one converted flat fee) is read, are in
[0064](0064-a-flat-incumbent-fee-is-not-a-share.md). The table of nine and every score stand.
