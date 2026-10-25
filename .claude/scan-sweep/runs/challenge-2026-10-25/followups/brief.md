# Follow-up builder brief - challenge-2026-10-25 triage

The owner triaged the run's backlog (`.claude/scan-history/backlog-challenge-2026-10-25.md`, section
"Triage with the owner"). You build the item(s) named in your prompt. There is no card file: your
prompt is the card, and the owner's decision in that table is the scope.

Follow `.claude/scan-sweep/runs/challenge-2026-10-25/builder-brief.md` for everything else - repo law,
the order (re-verify -> tests first and watch them fail -> build -> gates by asserted exit code ->
commit with only-paths), the shared-surface lock for CHANGELOG/ADRs, the first-paint rules, the
atlas coverage-ledger rule, Rust builders owing the desktop TS suite, `/dev/null` not `nul`, and
"never junction or remove worktrees around node_modules". Where a decision in your prompt is the
owner's (a ceiling raise, an ADR cap change), say "owner-approved in triage 2026-10-25" in the commit
body and the ADR.

Write your return file to `.claude/scan-sweep/runs/challenge-2026-10-25/followups/<item>.json` with the
same shape as the builder brief's return (use `"card":"followup/<item>"`), before replying. Reply in
under 80 words.
