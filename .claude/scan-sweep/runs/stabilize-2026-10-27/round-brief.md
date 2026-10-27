# Round-agent brief - scan-sweep --stabilize, run stabilize-2026-10-27

You run ONE stabilize round over ONE context (sometimes a pair) in a SHARED checkout, while up to
three other round-agents sweep other contexts with disjoint files. Repo root = cwd. Branch
`main`. **Commit on this branch, never push, pull, rebase, reset, stash, or checkout a file you
did not change.** A director runs the loop; it owns every shared ledger and runs the full gate
after the wave.

Your prompt names: the context(s), any extra paths granted to you, and the backlog items you
must work first.

## Read first (in this order)

1. The skill: `C:/Users/kazda/.claude/skills/scan-sweep/SKILL.md` sections 1-8 (you are a round-agent under
   "Director-run fan-out" in section 7). `references/lenses.md` holds every lens's prompt;
   `references/evidence.md` holds the evidence ladder.
2. Your context's `file_paths`, `description` and `keywords` in `context-map.json` (match on
   `name`). Those paths, plus your granted paths, plus tests for them, are your write set.
3. `.ai/registry-map.json`: the row covering your paths and its subjects; resolve each subject's
   `file` through `../ai-registry/knowledge/software-engineering/index.json` (never build a path
   from a slug). Read the golden path and the techniques whose `use_when` fits. The lenses judge
   against them and name the technique in the finding.
4. The never-re-propose lists: `.claude/scan-history/backlog-challenge-2026-10-15.md` and
   `.claude/scan-history/backlog-challenge-2026-10-25.md`, plus `git log --oneline -- <your paths>`
   (anything a recent commit already fixed is not a finding). Nothing is assigned to you this run:
   every context in this run's first waves has NEVER been swept, so the whole package is fresh.
5. Repo law: `AGENTS.md`, and the overlay `.claude/scan-sweep/config.md` (gates, rules, the
   project lens `ui-perfectionist`, which joins the package when your context has UI).

## Lessons the overlay recorded since the last stabilize run (binding)

- The first-paint ceiling in `apps/desktop/scripts/first-paint.mjs` (167,000 B) is OWNER-ONLY.
  Never raise it. A fix that does not fit under it is a Lane C card naming the overshoot. Near the
  ceiling a new dynamic `import()` costs ~430 B gz; fold into an existing lazy module instead.
- `examples/atlas/test/coverage.test.ts` fails on any new `src/athena/**/*.py` not drawn or omitted;
  a fix that adds a Python module owes `examples/atlas/data/omissions.ts` (granted to you for that
  one line, coupled-file rule).
- Rust changes also owe the desktop TS suite (`src/lib/rust-mirrors.test.ts`).
- New async UI tests: wait longer than `vi.waitFor`'s 1 s default (use 5 s); the shared box is loaded.
- Never junction, remove or reinstall `node_modules`; never `pnpm install`. Use `/dev/null`, never
  `nul`, in bash.
- `pnpm perf:*` false-fails under sibling load; the director runs perf. If you touched motion or
  first paint, run `node apps/desktop/scripts/first-paint.mjs` style byte checks only via
  `pnpm test` (the first-paint test lives in the desktop suite) and say so.

## The round

- **Strategy `stabilize`.** Package = every lens in `references/lenses.md` except the two
  `Group: challenge` lenses. Deep tier: bounty-hunter, parity-auditor, error-handler,
  observability-auditor, risk-assessor, code-optimizer, ux-reviewer, visual-craft,
  state-coverage, copy-auditor, accessibility-checker, test-strategist, security-auditor. Then
  matched lenses, then the rest as a lighter pass. Lenses with no surface in your context go to
  `lens_no_surface` with a one-line reason and earn nothing.
- **Survey, then judge (section 4).** Read every file in the context. Budget 16 findings,
  deep <=3 per lens, matched <=2, rest <=1. Under 8 findings on a context of 10+ files, do the
  section 4.8 second pass before you declare. Hunt pairs (section 4.6) and hand-kept lists
  (section 4.7) - in this repo they are the best yield (TS mirrors of Python contracts, two
  renderings of one rule, a list beside the thing it lists).
- **Routing (section 5).** Lane A = `better` at `gate` or `probe`, Gate none / policy-tighten
  with a test, XS/S or M with risk <=3, inside your write set. Build Lane A, highest reward
  first. Everything else is a card: Lane B (simulation-only, M risk>=4, L, out-of-scope, needs an
  instrument) or Lane C (direction, architecture, irreversible, policy-loosen, XL,
  operator-only, needs the real Tauri window or a browser to see). Do not build B or C.
- **A "dead" claim needs its zero-consumer grep in the evidence.**
- **Your prompt does not authorize a widening.** If building an item as described would admit,
  grant or send anything the code refuses today (a host, a capability, a field), build the
  tightening part and card the widening as Lane C `policy-loosen`, even when your prompt's own
  table lists it (wave 4: a prompt's accept table admitted 127.0.0.1 and it was built).

## Building a Lane A item

1. Write or extend the test that pins it; run it and WATCH IT FAIL on the current tree (seed the
   control red). An item with no instrument gets its S-sized instrument first.
2. Fix. Stay inside your write set. A fix that grows past its size class or past your paths is
   demoted to a card (revert YOUR uncommitted change to those paths only).
3. Gates, each in its OWN invocation, exit code ASSERTED: never `| tail`, never `;`, never a
   printed `$?` you then ignore. To save output: `cmd > <your temp>/x.log 2>&1; echo EXIT=$?`,
   then read the number and stop on non-zero.
   - Python touched: `uv run ruff check <your files>`, `uv run ruff format --check <your files>`
     (`uv run ruff format <your files>` to fix; never the whole tree), `uv run mypy`, and pytest
     SCOPED: `uv run pytest <your test dirs and every test dir that imports a module you changed>
     -m "not provider and not eval"`. "Imports a module you changed" includes tests that import
     a FUNCTION you changed from anywhere: `git grep -l "<function name>" tests` for every
     function whose behaviour you changed, and add those files (wave 3: a CLI exit-code fix broke
     two tests in tests/core that call `cmd_reconcile` directly). **Never run the full pytest suite** - three agents running
     it at once ran this machine out of memory last run. The director runs it after the wave.
   - TS in examples/ or packages/: `pnpm --filter <pkg> typecheck`, `... lint`, `... test`.
     Never touch or run `examples/journey` (an e2e that boots dev servers).
   - apps/desktop: from apps/desktop `pnpm typecheck`, `pnpm lint`, `pnpm test` (the full desktop
     vitest suite; it holds the first-paint and source-guard tests). `pnpm perf:all` only if you
     touched motion or first paint - and if you did, say so.
   - Rust: from apps/desktop/src-tauri `cargo check`, `cargo clippy --all-targets`.
   A red gate on a path you did not touch is probably a sibling's in-flight work: name the
   failing paths; if none is yours, wait ~60 s, re-run once, then record it and verify what you
   can scope to your own files. Never edit outside your write set to turn a gate green.
   Known flakes (not yours): `packages/athena-bridge/test/inject.test.js` deadline test,
   `tests/adopt/test_research_lanes.py` cancel test, `tests/channels/test_voice_gateway.py`
   newest-cards test under load.
4. **One commit per finding.** Message `fix(<scope>): <the finding as a sentence>`; body: the
   lens (and technique, if one), the README section or ADR it holds to, the test added and its
   red-before, the re-measured After, and what was verified by hand (or "none"). Last line:
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Write the message to a file in
   your temp dir and `git commit -F <file> -- <paths>`; new files `git add <file>` first. Never
   a bare `git commit`, never `git add -A`/`.`/`-u`. `git diff --cached --name-only` must list
   only your paths before you commit. A decision a later reader could question gets an ADR
   (`docs/adr/`, next free number under the lock); an ordinary fix does not.
5. **CHANGELOG.md: one line per commit**, appended at the END of the `## [Unreleased]` list, in
   the same commit as the fix, under the lock below. Match the existing lines' form.

## The shared-surface lock

Before editing `CHANGELOG.md`, claiming a `docs/adr/` number, or editing any file under `docs/`:
`mkdir "$(git rev-parse --git-dir)/scan-sweep-stabilize.lock"` - retry every 5 s until it
succeeds (older than 10 minutes = stale: remove and take it). Make the shared edit, commit
IMMEDIATELY (your fix's paths + the shared paths), then `rmdir` the lock. Simplest: finish and
gate the fix, take the lock, append the changelog line, commit, release.

## Temp files are yours alone

Keep every temp file (messages, logs, probes) in `<scratchpad>/stab/<your context>/` (the
scratchpad path is in your prompt). Give a non-Bash program (Python, node, PowerShell, an env
var) the Windows form `C:\Users\...`; the Bash form `/c/Users/...` read by a Windows program
becomes `C:\c\Users\...` (wave 1 left a stray tree that way). Never write a probe, cache or log inside the repo
(`UV_CACHE_DIR`, pytest temp, npm cache all stay outside). Before your last commit,
`git status --porcelain` must show nothing of yours uncommitted.

## Never touch

`.claude/scan-history/*`, `.ai/*`, `.personas/*`, the outbox, other agents' contexts,
`examples/journey`, `.claude/settings.local.json`, anything under `.claude/skills/`.

## Return - write BOTH files BEFORE you reply

1. `.claude/scan-sweep/runs/stabilize-2026-10-27/findings/<context>.jsonl` - ONE line per
   finding you did NOT build (Lane B and Lane C), in section 9's finding shape with two extra
   fields: `"lane":"B|C"` and, for Lane B, `"instrument":"<what would decide it>"`. `body` holds
   the five `## ` sections of section 4.10 verbatim, `evidence` the proof. Rejected
   (`not-better`) findings are NOT written here; they go in the round file.
2. `.claude/scan-sweep/runs/stabilize-2026-10-27/rounds/<context>.json`:

```json
{"context":"<name>","files_read":<n>,"loc":<n>,
 "registry":"software-engineering/<subject>[, ...] | none",
 "techniques":["<slug>"],"deviations":<n>,
 "assigned":[{"title":"...","verdict":"built <sha> | backlogged B|C | false: <why> | already fixed: <sha or evidence>"}],
 "built":[{"sha":"...","title":"...","lens":"...","red_before":"<test, how it failed>","after":"<re-measured>"}],
 "rejected":[{"title":"...","before":"...","after":"..."}],
 "lens_keys":[{"key":"<lens>","checked":"<what it was pointed at: files, grep, hypothesis>"}],
 "lens_no_surface":[{"key":"<lens>","why":"..."}],
 "findings":<built+rejected+backlogged>,"lanes":"A:<n>/B:<n>/C:<n>","fp":<n>,
 "gates":{"<command>":<exit>},
 "leads":[<section 6 lead objects, usually none>],
 "degraded":false,"note":"<=80 chars",
 "notes":"<sibling reds seen, anything the director must know>"}
```

Reply in under 150 words: built (shas), backlogged count by lane, assigned items' verdicts in one
line each, gates and exit codes, anything degraded.
