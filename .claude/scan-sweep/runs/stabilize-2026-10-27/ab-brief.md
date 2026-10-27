# Lane B worker brief - scan-sweep stabilize-2026-10-27

You are a scan-sweep **Lane B worker**. You own a GROUP of finding cards that share files. Your job
for each card, in order, one commit per card: decide by measurement whether the card's change makes
its figure better, and land it only if it does.

Repo root = cwd (`C:\Users\kazda\kiro\athena-portable`), branch `main`, a SHARED checkout: other
Lane B workers edit disjoint files at the same time, and a foreign (non-sweep) session may edit
`src/athena/harness/**`, `tests/harness/**`, `src/athena/senses/**`. **Never push, pull, rebase,
reset, stash, or checkout a file you did not change.** (This repo runs Lane B in the shared checkout,
not worktrees: the overlay sets `challenge.worktrees: false` and a junctioned `node_modules` was once
emptied mid-wave. Disjoint write sets and pathspec commits are the isolation.)

## Read first

1. `C:/Users/kazda/.claude/skills/scan-sweep/references/ab-lane.md`, section "The worker contract" -
   steps 1-8 bind you, read with the substitutions in this brief (no worktree; "your branch" is `main`
   with pathspec commits).
2. `.claude/scan-sweep/runs/stabilize-2026-10-27/round-brief.md` - its gates, commit form,
   shared-surface lock (CHANGELOG.md, docs/), temp-file rules, never-touch list and lessons all bind
   you too. Ignore its "The round" and "Return" sections.
3. Your cards: the lines in `.claude/scan-sweep/runs/stabilize-2026-10-27/findings/<context>.jsonl`
   whose titles your prompt lists. The card (body + evidence + size + method) is your spec.

## Per card, in order (stop the card at the first step that fails, then go to the next card)

1. **Re-measure A** on today's tree with the card's own method. Does not reproduce -> verdict `fp`,
   build nothing.
2. **Build the instrument first** (most cards are `simulation`): the test, probe or counter that
   takes the card's figure. Run it on the unchanged tree: it must show the defect (RED). If the
   instrument cannot be built at S/M, verdict `unmeasurable` naming it. If it shows the card's claim
   is wrong (A already fine, or B would not be better), verdict `not-better` with both figures.
3. **Build B** within the card's size and files (plus tests, plus a coupled CHANGELOG line). Needs a
   file the card does not name that another worker owns, or grows a size class -> revert your
   uncommitted change to those paths, verdict `demoted`.
4. **Take the same figure on B** (GREEN).
5. **Gates**, each in its own invocation, exit code ASSERTED (round-brief rules: never `| tail`,
   never `;` before a commit; scoped pytest only, never the full suite; from apps/desktop
   `pnpm typecheck`, `pnpm lint`, `pnpm test` for desktop files; first paint must stay under the
   owner-only 167,000 B ceiling - card it `demoted` rather than raise).
6. **Seed the control**: revert only B's source change, run the instrument, require RED; restore.
7. **Commit**: `fix(<scope>): <the finding as a sentence>`; body names `Lane B` and the lens, Before
   and After as re-measured, the seeded-control result, gate exit codes; CHANGELOG line under the
   lock; last line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git commit -F <msg> --
   <paths>` only; `git diff --cached --name-only` must list only your paths.

`policy-loosen` guard: if building a card would admit, grant or send anything the code refuses
today, build only the tightening part and return the rest as `unmeasurable` with the note
"policy-loosen: owner call".

## Return - write the file BEFORE you reply

`.claude/scan-sweep/runs/stabilize-2026-10-27/ab/<group>.jsonl`, one line per card:

```json
{"context":"...","title":"<card title verbatim>","verdict":"better|not-better|unmeasurable|fp|demoted",
 "before":"...","after":"...","method":"gate|probe|experiment","seeded_red":true,
 "gates":{"<command>":0},"sha":"<sha or null>","size_actual":"XS|S|M|L","files":["..."],"note":"<=200 chars"}
```

Then reply in under 120 words: per card one line (verdict, sha), gates, anything the director must
know (sibling reds, foreign-session paths seen dirty).
