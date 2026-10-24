# verification-ladder

**When** an exposure is verified, **climb four levels in order (producer catalogue tests, the keyless
scripted harness, the live pilot, the real desktop through Athena's UI) and assert at each level that
something ran**, **because** each level catches a class of defect the level below cannot see, and a
suite that skipped everything exits green.

## The levels

| Level | What runs | Cost | Catches | Cannot catch |
|---|---|---|---|---|
| **0. Producer tests** (the app's own suite) | the catalogue with a fake `modelContext` and a realistic fake backend | none | a description over 240; an array without `maxItems`; a footprint over 5,000 with her renderer port; a result over 1,500 at realistic size; wrong class flags; `tools_here` naming a missing tool; the opt-in gate | anything about her real validator, gate, trust or model |
| **1. Keyless harness** (`apps/desktop/e2e/<app>/`, scripted) | the app's real backend on scratch data, its built UI in headless Chromium with `inject.js` and the relay, a real `athena serve` replaying scripted transcripts, the shell's own run loop | none (no model) | the real manifest refused at her door; the relay and the page tools working end to end; a card filed, approved once, executed once on the scratch copy; a decline writing nothing; opt-out leaving zero tools; the hash actually moving | how a model chooses tools; anything in her desktop UI |
| **2. Live pilot** (`ATHENA_LIVE=1`) | the same, with `athena serve --engine claude_code` and fresh conversations, cards approved by the harness | quota, ~$1 per case | orientation cost (calls before content); descriptions that hide what she needs; unknown tools; ambiguous ids; tool gaps (she reads the page); a landing route stealing navigation; truncation she cannot recover from | trust, the capability-block cut with hands present, her UI |
| **3. Real desktop** (`ATHENA_DESKTOP=1`) | the built Athena app over CDP (launch an isolated build, or attach to a running one), pairing through her UI, the card's own buttons | quota, $1.38 to $5.68 for 6 tests | per-contract trust; the capability-block cut (hands included); the Main window and companion states; the toggle as a person presses it | statistical claims (n is tiny) |

## Rules

1. **Lower first.** A level-0 failure never spends level-2 quota.
2. **Assert it ran.** Every level reports the count of tests or cases that executed, and the run fails
   when it is zero. Set the app's checkout paths explicitly (`SHADOWRUNR_ROOT=...`): from a worktree, a
   sibling default resolves against the worktree root.
3. **The level-1 cases are fixed**: pairing (meta, toggle pressed, relay lists the catalogue, the shell's
   manifest accepted with no `problems`, the registered origin not gated, the unregistered one first
   sight), orientation (`where_am_i` then `go_to`, the hash moved), one walkthrough read with `show`, one
   approved write (exactly once, on scratch, backup), one decline (nothing), one AUTO action, opt-out
   (zero tools), and the real tree untouched.
4. **The level-2 report is the instrument.** Per case: turns, every tool call with args and ok/error, the
   hashes visited, cards filed and approved, the final answer, wall time, the ledger's cost, the calls
   before the first content-bearing call, and any unknown tool named. A case fails only when the page
   never navigated (unless it `stays`), a call hit an unknown tool, or no answer arrived; everything else
   is reported. Run it before and after each fix wave and compare the tables.
5. **Level 3 is two modes** (walkthrough-operations): launch an isolated build (its own identifier,
   rebuilt from a clean tree right before use), or attach to a running instance (raw page-level CDP).
6. **Analysis claims get a deterministic check.** When the agent analyses data through the tools, a
   script over the full data confirms, corrects or extends each claim before anything is published.

## Evidence

- Level 1 alone found the manifest refusal (`maxItems`), 2026-10-23.
- Level 2: run 1 to run 2 after the fix wave, $5.66 to $4.22 total, `start_sim` from 4 failed calls to 1,
  review-walkthrough from 12 calls to 7, shape-malakor from no card to an approved edit (n=1 per case).
- Level 3 alone found per-contract trust, the capability-block cut and two descriptions missing what she
  needed (2026-10-23).
- The character audit (2026-10-24): 8 turns, 68 calls, $18.29; a script over all 260 runs confirmed a gag
  in 140 of 260 runs and corrected the poll cadence (about 88 s, not 150).
- Zero-ran green: from a worktree, `pnpm -C apps/desktop test:e2e:shadowrunr` skipped 13 of 13 and exited
  0 (2026-10-24, `/open` authoring run).

## Registry

`test-harness`: the fidelity ladder ("catch each defect at the cheapest rung that can see it"), a lane
trusted only after green on good and red on bad (the decline and opt-out cases are the negative
controls), and a selection floor because zero selected tests exits green (agrees). `eval-harness`: one
optimized metric (calls before content) and thresholds (cost, unknown tools, no answer); "read the
transcripts" (agrees).
