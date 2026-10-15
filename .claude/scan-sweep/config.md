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

## Project lens: ui-perfectionist

The skill is linked from ai-registry, whose lens catalog has no project lenses, so this repo's
extra lens lives here. Add it to any stabilize package that touches UI; `coverage.mjs` counts
only the registry catalog, so its runs show in the ledger's `lens_keys` but not in the N/M total.

Match: `/ui|css|style|layout|component|scene|motion|transition|animation|spacing|theme|panel|view/i`

Reads one surface the way a person with a ruler and a stopwatch would, and owns what
`visual-craft` and `ux-reviewer` leave between them: spacing off the token scale or inconsistent
between siblings (a 10px where the scale says 8 or 12, uneven gaps in one row, padding that
differs by one pixel between twin controls), alignment and baseline slips, a hard clip or layout
jump where content arrives, a state change with no transition or a transition on the wrong
property (anything but transform and opacity in a hot path, `transition: all`, a duration or
easing that is not a motion token), enter without exit, focus and hover states that jump,
reduced-motion and Calm paths that leave a surface broken, and a flow with one click too many or
no feedback after one. Every claim is checkable from the CSS and the component: the value, the
token it should be, the sibling it disagrees with.

Anchor examples:
- A gap or padding off the spacing scale, or different between two sibling rows
- A state swap (empty to loaded, open to closed) that jumps instead of easing
- A hover or focus state with no transition while its siblings have one
- A control whose size, weight or position misstates its importance

## Strategy for this run

`--stabilize`, package `ui-perfectionist` first, then visual-craft, ux-reviewer, state-coverage, accessibility-checker, copy-auditor, mobile-specialist, code-optimizer.
