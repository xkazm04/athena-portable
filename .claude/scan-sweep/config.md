# scan-sweep overlay — athena-portable

contextMap: .claude/scan-sweep/context-map.json
memoryOutbox: .claude/scan-history/memory-outbox.jsonl
backlogDigest: none
openBacklogs: .claude/scan-history/open-backlogs.jsonl
handoff: off
depth: 16
neverSweep: generated, vendored, tests, the preview harness fixtures

## Gates (run each in its own invocation, && chained, exit code asserted)

- desktop UI, from apps/desktop: `pnpm typecheck && pnpm lint && pnpm test`
- motion and first paint, from apps/desktop: `pnpm perf:all` (ADR 0089 budgets; transform and opacity only, no per-frame script)
- Rust shell, from apps/desktop/src-tauri: `cargo check && cargo clippy --all-targets`, then `cargo test`

## Rules specific to this repo

- Tokens only: spacing, colour, radius, duration and easing come from `src/styles/app.css` and the depth tokens; no text under 12px.
- Animate transform and opacity only; the shared clock is `lib/motion.ts`; honour Calm (system/calm/full) and prefers-reduced-motion.
- First paint (about 125 kB gz) is pinned by `console/graph.test.ts`; a fix may not add a static import of a depth view, fixture or preview.
- One commit per finding, message `fix(scope): sentence`, body names the lens, the design section and what was verified by hand; end with the Co-Authored-By line from AGENTS.md. A CHANGELOG line per commit.
- No machine paths in committed files.
- Stage by explicit pathspec; `.claude/worktrees/` is gitignored.

## Strategy for this run

`--stabilize`, package `ui-perfectionist` first, then visual-craft, ux-reviewer, state-coverage, accessibility-checker, copy-auditor, mobile-specialist, code-optimizer.
