# 0134. A brief says where each line came from, carries the dates, and never borrows the example's case

Date: 2026-10-23 (spark chores-uat, WP-B)

## Context
The chores UAT (ADR 0132, run 2026-10-23-chores) found rules the playbook researched and cites written into briefs
as "(my guess)" (65 times in 28 health briefs, 23 of 24 freight briefs), because a slot was "confirmed" only when the
person said it. The brief had no place for a deadline, so real dates never reached it. The first card offered the
playbook's invented app names, Athena's opening line told the example's story, briefs stated example facts as the
person's, and "Start for real" handed Athena the playbook's world-specific `command`.

## Decision
- A rule the playbook states is stored confirmed with source `default` (no contract change; the desktop already reads
  `default` as "from the playbook") and renders "(from the playbook)"; lane-read values render "(from research / your
  document / your account)"; "(my guess)" is kept only for Athena's inference about this person. A value the person
  gave is confirmed even when she asks Athena to check it. A reopened case keeps a playbook rule as `default`.
- The brief JSON gains `dates` (`what`, `when`, `rule`, `if_missed`), rendered as "Dates that matter"; the writer never
  invents a date, and the interviewer may ask for the person's own anchor dates, never for the law.
- Portal slots start empty and ask by role; card options and brief lines that name the example's apps, people or
  amounts are dropped and counted (`example_option_dropped`, `example_leak_dropped`). `playbook_block` fences the
  example as "EXAMPLE (invented, someone else's case)". The opening line is the title and the fit.
- `fitted_command` is built from the approved brief only; the playbook's `command` stays world-specific for the bench.
- `playbook_block` carries `fit`; the interviewer answers a fit or cost question in one line and says when the person
  is outside `fit.where`.

## Consequences
The leak guard is a heuristic (capitalised names, amounts); a lone first name or "your son" is left to the prompt
rule. The adopt-tier bench's input changed (its command no longer starts with the playbook command), so its 2026-10-15
figures are not comparable with a re-run.
