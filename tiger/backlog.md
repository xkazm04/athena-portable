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
