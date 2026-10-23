# 0136. A chore's page shows one money figure, labels every figure by kind, and counts your review

Date: 2026-10-23 (spark chores-uat, WP-N)

## Context
The chores UAT found one topic page showing two to four different dollar figures for the same job with no source,
"found" totals that summed scoring weights and exposure, a time-saved ratio that left out the person's review, and a
verdict computed but never shown. Operator decisions (spark chores-uat, wave 4): one measured figure plus a labelled
estimate; every figure labelled by kind.

## Decision
- The topic headline is `economics.example_usd` (ADR 0133) as "$X back, in the invented example"; without it, the
  page says in words what the chore protects. The author's estimate is one line, "Typical value: about $Y a year,
  author's estimate", opening to its basis, sources and caveat; the catalogue cell and this line share one function.
  The "Worth $X" line and "for the persona" go; the hero brief is tagged as the invented example.
- Only `money_back` sums into "found", the catalogue total, the home light, the flow result and the replay; other
  kinds use their own words; `count` never renders "$".
- Time saved is manual minutes against the run plus the person's review; the ratio uses the same sum.
- The verdict is shown with its runs; "Most value" ranks yearly money back first; a "Where it fits" block renders
  `fit` when present.
- Plain words: "test run" for bench, "Mistakes avoided" for traps avoided, "Best fit" for best edge.
- The figure helpers moved to lazy files (`scenes/chores/worth.ts`, `modules/playbooks/replay.ts`) to keep the first
  frame under its 161,000 B ceiling (ADR 0095), unchanged.

## Consequences
A brief whose markdown states a different total is labelled as the example, not rewritten; `check` does not yet
refuse it. The perf gate needs Edge on the host to run; the first-paint byte gate passed in the unit suite.
