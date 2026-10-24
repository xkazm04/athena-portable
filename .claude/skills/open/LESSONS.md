# Lessons - open

Append-only skill memory. One entry per run that taught something a future run should do differently.
Format: `## <version used> - <YYYY-MM-DD> - <project>` followed by `- ` bullets, each one observation
with its measurement. No "no issues" entries: a run that went as the method says writes nothing here.
When a lesson is applied to `SKILL.md` or a technique, say so at the end of its bullet ("applied in
x.y.z: <where>"), and never rewrite an older bullet.

## 1.0.0 - 2026-10-24 - athena-copilot (Overlord/Shadowrunr)

Measured on the Shadowrunr console (25 WebMCP tools) driven by Athena, 2026-10-23/24. Each is already
folded into `references/standard.md` and its techniques.

- **The manifest validator refuses the WHOLE catalogue if any array param lacks `maxItems`.** Found
  only at the seam, on the first scripted run; no tool reached her until it was fixed. Test it
  producer-side: every `type: "array"` property carries a numeric `maxItems`.
- **Tool results are capped at 1,600 chars**, and the cut is silent to the producer: a 12-page document
  read came back truncated and she asked the operator to paste the bible instead. Page reads (at most
  1,200 chars of text plus an outline and `next_offset`), and keep a result guard at 1,500 or less in
  the producer's tests, run at realistic fixture size.
- **The capability block is capped at 12,000 chars**, ordered GATED / READ / AUTO, then by name, and a
  tool past the bound is dropped with every tool after it. A 28-tool, 8,099-char catalogue lost
  `where_am_i` ("40 of 41"). Measure the footprint with a port of Athena's own renderer and keep a
  5,000-char budget test per app. The catalogue went from 28 tools to 25 (4,801 chars) to fit.
- **Trust is per origin AND per contract (ADR 0100).** Tools that registered after the origin was
  trusted all asked for approval, reads included, until the origin was re-trusted (Origins: Disable,
  then Enable). The pairing guide needs that step, and it recurs on every tool change.
- **The app's intro (landing) route stole navigation after the agent had navigated.** The live pilot's
  cold-orientation case never left the page it was moved to only because a fix landed. Open the app with
  its target hash, and fix the app so a landing route never overrides a route that is already set.
- **Descriptions must say what the consumer cannot infer.** `leave_feedback` failed `validator_failed`
  until its description named the legal tags and that only host lines take marks; `get_session` had to
  say why a session failed (`failed_because`). Both were found only by a live run.
- **Bare ids that are ambiguous across containers cost failed calls.** A run id present in two
  tournaments. Make ids unique, or make the error say how to qualify one; here it did, and she recovered
  on the next call.
- **A tool gap shows up as the agent reading the page instead.** No tool returned a show's pick reasons,
  so she used `page_read`, whose line numbers were offset by about 12 from the API's. Cover every view
  the agent needs analytically, with the same line numbering as the page.
- **Playwright `connectOverCDP` crashes on a WebView2 dev build** that runs a blob shared worker without
  a `browserContextId` (an uncatchable assertion inside an event handler kills the process). Attach with
  a raw page-level CDP transport (`apps/desktop/drive/raw-cdp.mjs`).
- **A press that lands as a card appears is dropped by Athena's UI.** Check actionability (present,
  sized, hit by `elementFromPoint`, not disabled, stable over 2 polls) and re-press until the card is
  stamped; once it is answered, extra presses are ignored.
- **A collapsed Main window (144x19) hides the register form.** Call `athena_open_main` first. A
  seal-collapsed companion needs its seal pressed before the ledger exists.
- **An isolated e2e build embeds whatever `dist` the working tree held at build time.** A build taken
  while another session had uncommitted companion-UI changes shipped a UI the driver could not open.
  Rebuild the isolated exe right before each use, from a clean tree, into its own `CARGO_TARGET_DIR`
  (the running dev app locks `src-tauri/target/debug`).
- **Attach mode reuses her persistent conversation, so cost grows per run.** $5.68 attached against $1.38
  isolated for the same 6 tests; her Clear empties only the panel. Use an isolated instance for repeated
  runs, attach only to reproduce what the user sees.
- **A live pilot report turned a diagnosis into a measured comparison.** Calls before content, cards and
  cost per case, run before and after a fix wave: $5.66 to $4.22 in total, `start_sim` from 4 failed
  calls to 1. Keep it for any agent-facing surface.
- **Analysis tasks need focused turns and a deterministic check.** One dimension per turn keeps her
  inside her per-turn step budget, but each turn re-reads the conversation, so 8 turns cost $18.29. Her
  ~25-line samples produced claims that a full-data script then confirmed, corrected or extended (a gag
  in 140 of 260 runs; polls every ~88 s, not 150). Pair her reading with a script over the full data.
- **Scratch data for every walkthrough.** A scratch copy of the app's writable tree, and a digest test
  that the real tree did not move, are what made it safe for the harness to approve every GATED card.

## 1.0.0 - 2026-10-24 - athena-portable (writing /open)

- **From a worktree, the keyless suite skips everything and exits 0.** `OVERLORD` defaults to
  `<repo root>/../overlord`, which from `.claude/worktrees/open-skill` is a path that does not exist:
  13 of 13 skipped, exit 0. With `SHADOWRUNR_ROOT` set: 8 passed. Applied in 1.0.0: `verify` sets every
  checkout path explicitly and fails a level whose passed count is zero (`verification-ladder` rule 2,
  `references/harness.md`).
- **The renderer port reproduces her block exactly, and finds what the producer tests pass.**
  `scripts/catalog-check.mjs` over the 25 tools the built console registers measured 4,801 chars, the
  figure recorded after the fix wave. It also flagged `add_tone_line`, whose description names 3 of the
  12 legal `tags` (an `items` enum her block renders as `tags: array`): the `leave_feedback` defect class,
  still open in Overlord and green in its tests. Applied in 1.0.0: level 0 and `build` step 8 run
  `list-tools` plus `catalog-check` on the built `dist`.
