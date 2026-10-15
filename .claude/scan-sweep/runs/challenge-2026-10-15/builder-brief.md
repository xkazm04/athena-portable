# Builder brief - scan-sweep --challenge, run challenge-2026-10-15

You build ONE approved challenge card in a SHARED checkout, alongside up to three other builders
working on disjoint files at the same time. Repo root = cwd. Branch: `main`. **Commit on this
branch, never push, never pull, never rebase, never reset, never stash, never checkout a file
you did not change.**

Your card: `.claude/scan-sweep/runs/challenge-2026-10-15/cards/<host>.json`, the slot named in
your prompt, plus any revision in your prompt (the revision WINS over the card). Read the card
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
- Commit message: `type(scope): what changed, as a sentence`; the body names the design section
  (README section or ADR), the tests added, and what was verified by hand, or "none". End every
  commit message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Desktop UI (apps/desktop): tokens only (spacing, colour, radius, duration, easing from
  `src/styles/app.css` and the depth tokens), no text under 12px, animate transform and opacity
  only, honour Calm and prefers-reduced-motion. First paint is pinned by `console/graph.test.ts`:
  never add a static import of a depth view, fixture or preview to the first-paint graph.
- No machine paths in committed files.

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
     `uv run ruff format <your files>` to fix, never the whole tree), `uv run mypy`,
     `uv run pytest -m "not provider and not eval"` (FULL suite, ~5 min, before the last commit).
   - TS in examples/ or packages/ touched: `pnpm --filter <pkg> typecheck`, `... lint`, `... test`,
     and before the last commit the workspace suite `pnpm -r --filter "!journey" --if-present run test`
     plus `pnpm typecheck` and `pnpm lint` from the root. (`examples/journey` is an e2e that boots
     dev servers; it is excluded - do not run it.)
   - apps/desktop touched: from apps/desktop `pnpm typecheck`, `pnpm lint`, `pnpm test` (full
     suite: it holds the first-paint and source-guard tests); `pnpm perf:all` only if you touched
     motion or first paint.
   - Rust touched: from apps/desktop/src-tauri `cargo check`, `cargo clippy --all-targets`.
   The repo keeps guards AWAY from what they guard (source-guard tests in sibling folders,
   import budgets). The full suite of every surface you touched, not just your folder, is the gate.
   Never point a cache (uv, npm, cargo, pytest temp) inside the repo.
5. **A red whole-tree gate on a path you did not touch is a sibling's in-flight work.** Get the
   failing paths. If none is yours: wait ~60 s, re-run once; still red and still not yours ->
   record it in `notes`, verify what you can scope to your own files, and carry on. Never edit a
   file outside your write set to make a gate green. Known flake: none at base (the one base red,
   `tests/adopt/test_research_lanes.py`, was fixed before the run).
6. **Commit as a short series, every commit green on your surface.** A tests-only commit
   would be red, so the acceptance tests ride in the same commit as the implementation they
   pin (the red-before is recorded in your return file, not in history). A series is e.g.
   `refactor(<scope>): ...` (a no-behaviour seam move, green) then `feat|fix(<scope>): ...`
   (tests + behaviour + ADR + changelog line). One commit is also acceptable.
   **Commit with only-paths semantics:** for new files `git add <those files>` first, then
   `git commit -m "..." -- <every path of yours>`. Never a bare `git commit`, never `git add -A`
   / `.` / `-u`. Before committing, `git diff --cached --name-only` must list only your paths.
   Use a message file (`git commit -F <file in your temp dir> -- <paths>`) for multi-line bodies;
   never write a message or a regex through a shell heredoc that contains backslashes.

## Your temp files are yours alone

Siblings share the session scratchpad directory. Keep every temp file you write (commit
message files, ADR drafts, gate output) in a subdirectory named for your card, e.g.
`<scratchpad>/<host>-<slot>/`, and never read, write or delete a file outside it. (Wave 1: two
builders overwrote each other's ADR draft and commit message in the shared root.)

## The shared-surface lock

Before editing `CHANGELOG.md`, any `docs/adr/` file (to claim a number), `docs/daemon.md`,
`docs/kit-camera-contract.md` or `docs/layered-ui-formula.md`:
`mkdir "$(git rev-parse --git-dir)/scan-sweep-challenge.lock"` - retry every 5 s until it
succeeds (stale after 10 minutes: then remove it and take it). Make the edit, commit it
IMMEDIATELY with only those shared paths (plus your ADR file), then `rmdir` the lock. Append at
the END of a list; never reflow a file. Simplest: do all your shared-surface edits in your final
commit, taking the lock just for that commit.

## Generated files

None of the declared write sets contains a generated artefact. If you find a file you were going
to edit is generated (a header says so, or a guard test pins it to a generator), do not hand-edit
it: regenerate with its own command if it is inside your surface, else stop and note it.

## Return - write it BEFORE you reply

`.claude/scan-sweep/runs/challenge-2026-10-15/builds/<host>-<slot>.json` (Write tool):

```json
{"card":"<host>/<slot>","status":"landed|demoted|partial","shas":["..."],
 "tests_added":["<test file::name>"],"guard_cases":[<indexes>],
 "cases_total":<n>,"cases_red_before":<n>,"cases_green_after":<n>,
 "gates":{"<gate command>":<exit code>},
 "files_changed":<n>,"lines_changed":<n>,
 "deviations_from_card":"<what you did differently and why, or none>",
 "notes":"<sibling reds seen, anything the coordinator must know>"}
```

Reply in under 120 words: status, shas, cases red-before/green-after, gates.
