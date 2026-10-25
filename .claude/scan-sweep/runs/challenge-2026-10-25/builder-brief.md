# Builder brief - scan-sweep --challenge, run challenge-2026-10-25

You build ONE approved challenge card in a SHARED checkout, alongside up to three other builders
working on disjoint files at the same time. Repo root = cwd. Branch: `main`. **Commit on this
branch, never push, never pull, never rebase, never reset, never stash, never checkout a file
you did not change.** Peer Personas sessions work in their own worktrees; ignore them.

Your card: `.claude/scan-sweep/runs/challenge-2026-10-25/<RUN>/cards/<host>.json`, the slot named
in your prompt, plus any revision in your prompt (the revision WINS over the card). Read the card
verbatim: `acceptance`, `guard_cases`, `write_set`, `new_files`, `premise`, `body`.

## Repo law you will trip (AGENTS.md, README.md section 2 invariants)

- **Contracts first.** `src/athena/contracts/` is the seam between packages; a change there is a
  contract change with its own test in `tests/contracts/`.
- **One decision, one ADR.** A choice a later reader could question gets
  `docs/adr/NNNN-<slug>.md` (context, decision, consequences). NNNN is the next free number at
  the moment you write it, taken UNDER THE LOCK below (siblings write ADRs too). Look at
  `docs/adr/` for the form.
- **CHANGELOG.md**: one line for your change, under the top/unreleased section, appended at the
  END of that section's list, under the lock.
- Commit message: `type(scope): what changed, as a sentence`; the body names the lens
  (architecture-challenger or ux-elevation), the design section (README section or ADR), the
  tests added, and what was verified by hand, or "none". End every commit message with the line
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Desktop UI (apps/desktop): tokens only (spacing, colour, radius, duration, easing from
  `src/styles/app.css` and the depth tokens), no text under 12px, animate transform and opacity
  only, honour Calm and prefers-reduced-motion. First paint is pinned by `console/graph.test.ts`
  and a byte ratchet (`apps/desktop/scripts/first-paint.test.ts`): never add a static import of a
  depth view, fixture or preview to the first-paint graph. The first-paint ceiling
  (`apps/desktop/scripts/first-paint.mjs`) is RAISED ONLY BY THE OWNER - never raise it. If your
  diff pushes it over, move the new code behind a lazy import or out of the first frame; if that
  is impossible, return `demoted` naming the overshoot in bytes.
- Example-app tests may only open a scratch database (the demo kit's openDb refuses any other
  file under test). The ledgerbox dev server may hold `examples/ledgerbox/data` - never touch it.
- No machine paths in committed files.
- **A new `src/athena/**/*.py` module must be accounted for in the atlas coverage ledger**
  (`examples/atlas/data/omissions.ts`, or drawn in `components.ts`): `examples/atlas/test/coverage.test.ts`
  fails on any module neither drawn nor omitted. Add the omission entry (path, one-line reason,
  source, `modules`), or bump the enclosing directory entry's `modules` count, in the same
  commit, and run `pnpm --filter atlas test`. That file is coupled, not out of scope.

## Order - do not skip or reorder

1. **Re-verify the premise** on the current tree (`premise` and `evidence`). False or already
   fixed -> write your return file with `status: "demoted"`, no code, and reply.
2. **Write the acceptance cases as tests FIRST.** One test per case, named so the case is
   recognisable. Run them and WATCH THEM FAIL on the current tree (guard cases excepted - those
   pass before by design; say which). Record `cases_red_before`. A case you cannot make red
   before the change is a case that cannot catch a wrong build: rewrite it until it can.
3. **Build** inside `write_set` + `new_files` (+ the shared surfaces). You may shrink the set.
   Growing it by more than tests and one coupled doc, or past ~800 changed lines, is a
   demotion: revert YOUR uncommitted work (`git checkout -- <only your paths>`, delete only your
   new files) and return `demoted` with why.
4. **Gates, each in its OWN invocation, exit code ASSERTED** - never `| tail`, never `;`, never
   a printed `$?` you then ignore. Use `cmd > file 2>&1; echo EXIT=$?` only to SAVE output, and
   then read the number and stop on non-zero. Run what your surface needs:
   - Python touched: `uv run ruff check .`, `uv run ruff format --check .` (run
     `uv run ruff format <your files>` to fix, never the whole tree), `uv run mypy`, and the
     tests for your package (`uv run pytest tests/<area> -m "not provider and not eval"`) plus
     every test file that imports a module you changed (grep for it). **Do NOT run the full
     pytest suite** - the coordinator runs it once per wave at integration (four concurrent full
     suites exhaust memory on this machine).
   - TS in examples/ or packages/ touched: `pnpm --filter <pkg> typecheck`, `... lint`, `... test`,
     and before the last commit `pnpm typecheck` and `pnpm lint` from the root, plus the test
     suite of every workspace package that imports the package you changed. (`examples/journey`
     tests are an e2e that boots dev servers; never run them - typecheck/lint it only.)
   - apps/desktop touched: from apps/desktop `pnpm typecheck`, `pnpm lint`, `pnpm test` (full
     desktop suite: it holds the first-paint and source-guard tests). Do NOT run `pnpm perf:*`
     (it false-fails under sibling load, and `perf:chores` is red at the run base on this machine);
     say in `notes` if you touched motion or first paint and the coordinator runs it.
   - Rust touched: from apps/desktop/src-tauri `cargo check`, `cargo clippy --all-targets`, AND from
     apps/desktop `pnpm typecheck` and `pnpm test` - `src/lib/rust-mirrors.test.ts` pins every
     Rust struct the UI reads to its TS interface, so a new field needs the TS mirror and fixtures
     in the same commit.
   The repo keeps guards AWAY from what they guard (source-guard tests in sibling folders,
   import budgets). The full suite of every surface you touched, not just your folder, is the gate
   (Python excepted, as above). Never point a cache (uv, npm, cargo, pytest temp) inside the repo.
5. **A red whole-tree gate on a path you did not touch is a sibling's in-flight work.** Get the
   failing paths. If none is yours: wait ~60 s, re-run once; still red and still not yours ->
   record it in `notes`, verify what you can scope to your own files, and carry on. Never edit a
   file outside your write set to make a gate green. Known flakes: the `packages/athena-bridge`
   deadline test (about 1 in 10), the research-lanes cancel test.
6. **Commit as a short series, every commit green on your surface.** A tests-only commit
   would be red, so the acceptance tests ride in the same commit as the implementation they
   pin (the red-before is recorded in your return file, not in history). A series is e.g.
   `refactor(<scope>): ...` (a no-behaviour seam move, green) then `feat|fix(<scope>): ...`
   (tests + behaviour + ADR + changelog line). One commit is also acceptable.
   **Commit with only-paths semantics:** for new files `git add <those files>` first, then
   `git commit -F <msgfile> -- <every path of yours>`. Never a bare `git commit`, never `git add -A`
   / `.` / `-u`. Before committing, `git diff --cached --name-only` must list only your paths.
   Never write a message or a regex through a shell heredoc that contains backslashes.
   The tree a commit creates must compile: a changed signature goes in with every caller.

## Your temp files are yours alone

In bash, discard output to `/dev/null`, never `nul` (that creates a file named `nul` in the tree).

Siblings share the session scratchpad directory. Keep every temp file you write (commit
message files, ADR drafts, gate output) in a subdirectory named for your card, e.g.
`<scratchpad>/<RUN>-<host>-<slot>/`, and never read, write or delete a file outside it.

## The shared-surface lock

Before editing `CHANGELOG.md`, any `docs/adr/` file (to claim a number), or any other file your
prompt names as shared: `mkdir "$(git rev-parse --git-dir)/scan-sweep-challenge.lock"` - retry
every 5 s until it succeeds (stale after 10 minutes: then remove it and take it). Make the edit,
commit it IMMEDIATELY (with the code it describes, or alone if the code is already committed),
then `rmdir` the lock. Append at the END of a list; never reflow a file. Simplest: do all your
shared-surface edits in your final commit, taking the lock just for that commit.

## Generated files

If you find a file you were going to edit is generated (a header says so, or a guard test pins
it to a generator), do not hand-edit it: regenerate with its own command if it is inside your
surface, else stop and note it.

## Return - write it BEFORE you reply

`.claude/scan-sweep/runs/challenge-2026-10-25/<RUN>/builds/<host>-<slot>.json` (Write tool):

```json
{"card":"<host>/<slot>","status":"landed|demoted|partial","shas":["..."],
 "tests_added":["<test file::name>"],"guard_cases":[<indexes>],
 "cases_total":<n>,"cases_red_before":<n>,"cases_green_after":<n>,
 "gates":{"<gate command>":<exit code>},
 "files_changed":<n>,"lines_changed":<n>,
 "touched_python":true,"touched_desktop_motion_or_first_paint":false,
 "deviations_from_card":"<what you did differently and why, or none>",
 "notes":"<sibling reds seen, anything the coordinator must know>"}
```

Reply in under 80 words: status, shas, cases red-before/green-after, gates (all 0 or which not).
