# Tiger backlog

## Kept, not chosen

- **S3 Operating notes per app** (M) - wire `core.write_procedural` (gated, provenance-checked) so Athena keeps "how app X is operated" notes; up to 3 per frame. Pool P08, P15. Run [2026-10-15-page-operation](hunts/2026-10-15-page-operation/scope.md).
- **L1 Saved operations for sites without WebMCP** (L) - a form signed once by role + label saved as an always-gated named tool; grant binds slots + recipe hash; export as a WebMCP stub. Every seat proposed it. Pool P27, P22, P09, P16, P01, P21. Depends on S3. Same run.

## Follow-ups found while building

- Live-shell check of the 2026-10-15 branch: `hands_call` IPC fix (2d16183), `hands_describe`, navigation counter firing on reload (ADR 0103), sheet and checklist on screen.
- `tests/daemon/test_hands_manifest.py` keeps its own copy of the hand schemas, already missing `cursor` and `expect`.
- The companion tool list does not show a tool held by outcome_unknown (ADR 0101) as GATED.
- Taint (ADR 0105) ends at the next user message while the read text stays in the conversation.
- `cargo fmt --check` fails across existing Rust files at baseline.

## 2026-10-22 chores-playbooks

Run [2026-10-22-chores-playbooks](hunts/2026-10-22-chores-playbooks/scope.md).

- **Kept, not chosen - Outcome desk per invoice** (L) - carry each receivable through waiting to verified settlement across sessions (stable identity, sourced checkpoints, closes only on payment evidence). Pool P13. Now buildable on the case file (ADR 0123), receipts (0124/0127) and due reviews (0131).
- **Kept, not chosen - Live read-only dry-run on real tabs** - the page-lane half of P04; a new harness mode, so it belongs to a page-operation hunt.
- **Failed, needs a new idea - second-run duplicates.** A prompt block listing last run's calls raised run-1 duplicates 6 -> 14 (ADR 0130). The `--second-run` bench is the instrument; the baseline already recalls run 1's episodes. Next attempt should change the gate or the card, not the prompt.
- **L2 finding - new work in session 2.** The follow-through pilot missed the new invoice GH-03 in 4 of 9 second sessions; one lost answer was re-proposed unchecked (1 of 3).
- **Evidence films stale for the 20 re-benched playbooks** - `evidence --all --verify` reads 80 of 100 current; refresh with `evidence <id>` (local TTS + capture + ffmpeg, no model cost).
- **Bench costs ran over estimate** - per-session cost for multi-phase worlds is ~$3.6, not the $1.61 library mean; price the next paid check from the playbook's own history.
- **L1 gaps** - no daily notice cap (attention-budgets); quiet hours have a route but no desktop control; the dock notice waits while Main is at the surface; zone fallback to local time on a machine without a zone database.
- **Small follow-ups** - preview fixtures never show the rehearsal's `shaped` path (C3); repeat approvals of an unchanged brief add an episode each (C1); `core/ledger.py:24-27` docstring says ids.py has no turn prefix (it has); misplaced `stampOf` docstring in `stores/run.ts`; `evidence --stills-only --dry` prints `01..06` whatever the still count; `bench.json` keeps 12 history lines, so a correction spends one.
- **Paid check not run - C2 rework** - `bench estate-settlement --case --cap 8` should match the no-case baseline ($3.10-3.45, exceeds); the claim is held by tests (same conversation with and without a case).
