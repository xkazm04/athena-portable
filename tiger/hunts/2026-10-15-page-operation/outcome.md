# Outcome - page operation (2026-10-15)

Branch `tiger/page-operation` (worktree build, not pushed). Judge: claude-opus-5-5.
Final gates on f113fa7: ruff + format clean; mypy clean (128 files); pytest exit 0, no failures;
`pnpm typecheck` + `pnpm lint` clean (8 packages); desktop vitest 101 files / 1436 tests; bridge
`node --test` 26/26; demo-kit 143/143; `cargo clippy --all-targets` clean; `cargo test --lib`
135/135. Baseline red, unchanged: `examples/journey` playwright (1 of four acts fails at 9bd3cce).
Nothing was driven in the live desktop shell.

| item | commit | verify (as re-run by the judge) | status | notes |
|---|---|---|---|---|
| C1 cards name app, tier, target | e15c203 | companion + run + lib vitest 355/355; hands describe tests | landed | ADR 0099; `hands_describe` is panel-only, page webviews still have one IPC command |
| (found) hands_call arg naming | 2d16183 | cargo check + clippy clean | landed | Tauri 2 expected `tabId`; panel sent `tab_id`, so hands + captures failed at IPC in the live shell. Not live-verified |
| C2 re-gate changed contracts | 5c0b5d2 | contracts.test.ts 5/5 | landed | ADR 0100; accepted contracts in a settings row (origins table has fixed columns); existing trusted origins ask once per tool after upgrade |
| C4 outcome_unknown | 5daa68b | refusal parity 4/4; bridge 26/26; stores 178/178 | landed | ADR 0101; vocabulary added Python-first; `late` event additive in protocol.md |
| S2 read cursors | 334f6de | hands.test.ts 40/40; tests/lane pass | landed | ADR 0102; packets <= 1,500 chars |
| S1 tab-bound approvals | 5cf16c3 | 8 tab scenarios pass; tests/harness/test_tab_binding.py + lane pass | landed | ADR 0103; per-tab navigation counter from the shell |
| C3 one ordered sheet | 18f09fb | run + views + hands 176/176 | landed | ADR 0104; 10 reminders: 11 -> 2 model runs; unticked rows declined first |
| L2 tabs_read + taint | 10aa317 | run.tabs-read 8/8; taint pytest 9/9 | landed | ADR 0105; amends 0047; voice refuses tabs_read |
| L3 cross-tab checklist | f113fa7 | full suites (1436 vitest, pytest exit 0); gauntlet cross-tab fixture | landed with deviation | ADR 0106; builder also amended `constitution/law.md` (not asked; flagged to the person). Verify said a repeat answer returns `approval_spent`: the route returns 409 `pending_approval` for a repeat answer, the grant replay returns `approval_spent`; nothing runs either way |
