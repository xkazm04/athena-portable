---
name: open
description: "Open a web or Tauri app to Athena (the athena-portable desktop companion), so she can orient in it, read it and propose every change as a card the person approves. Use when an app should be driven by Athena or its existing Athena exposure needs checking. `survey` reads the app and writes an exposure plan (pages, routes and deep links, the read and write surface, what the orient tools would say, a classed AUTO/GATED catalogue measured against her 240/1,600/12,000-char caps and her manifest validator, the trust and pairing steps, risks). `build` implements it in the app (meta tags, the opt-in toggle, orient, read and write tools, catalogue tests for result size, footprint and maxItems, a pairing guide). `verify` runs the e2e walkthrough (the keyless scripted harness, the live pilot with a per-case report, the real desktop through her UI in launch or attach mode). `lessons` appends what a run taught to the skill's memory. Invoke with `/open survey|build|verify|status|lessons [app path or url] [flags]`."
version: 1.0.0
category: integration
memory: project
argument-hint: "survey <app path|url> | build [app path] | verify [app path] [--level 0|1|2|3] [--attach <cdp url>] | status [app path] | lessons"
---

# /open: expose an app to Athena

Athena hosts web apps in her own tabs and works them through the tools a page registers on
`document.modelContext` (WebMCP). This skill takes an app from "she can open it" to "she orients in one
call, reads what the person means, and every write is a card the person signs", and proves it at four
levels. The standard it builds to is `references/standard.md`; its procedures are the techniques under
`references/techniques/`. The first app opened this way was the Shadowrunr console (Overlord,
2026-10-23/24); its code is the reference implementation, cited by path, never copied blind.

**Read before any mode:** `LESSONS.md` (the skill's memory, newest last), `references/standard.md`
(golden path, Athena's acceptance rules, the technique index, where it meets the registry), and the
techniques the mode names.

## Ground rules

- **Two repositories.** The app's repo (where the tools live) and athena-portable (where the harness and
  driver live). Work in a git worktree of each, off its main branch. Never commit unless the invocation
  says to; never `git add -A`; never stash; never touch another session's index or staged files.
- **Scratch only.** No walkthrough writes to the app's real data. Every level that approves cards runs on
  scratch copies with a digest guard on the real tree (`walkthrough-operations`).
- **No token through the page.** No tool returns, lists or takes a credential; Athena's daemon token never
  leaves her shell.
- **Quota is the person's.** Levels 2 and 3 spend the signed-in CLI's quota (~$1 per pilot case; $1.38 to
  $5.68 for the 6-test desktop suite). Run them only when the invocation asked for that level, or after
  asking.
- **A skip is not a pass.** Every test level reports how many tests ran; zero ran is a failure of the run.
- **Windows host.** Write files with the editor tools, not heredocs, when they hold quotes or backslashes;
  `MSYS_NO_PATHCONV=1` for leading-slash routes in Git Bash; `UV_NO_SYNC=1` while another Athena from
  the same checkout holds its venv.

## Step 0, every mode: refresh Athena's rules

The caps and the validator are the consumer's acceptance rules, and the Shadowrunr scout missed three
of four. Before planning or testing, re-read them from athena-portable's source and compare with the
table in `references/standard.md` section 2:

```bash
A=<athena-portable checkout>
git -C $A log -1 --format=%h
grep -n "^DESCRIPTION_CAP\|^PARAM_TEXT_CAP\|^ENUM_SHOWN\|^_CLASS_ORDER\|^_TOOL_NAME\|^READ_CAP" $A/src/athena/core/catalog.py
grep -n '"capabilities":' $A/src/athena/core/prompt.py
grep -n "^RESULT_CAP" $A/src/athena/lane/turn_frame.py
grep -n "^MAX_TOOLS_PER_MANIFEST\|^MAX_PROPERTIES_PER_TOOL\|^LOOPBACK_PAGE_HOSTS\|needs maxItems" $A/src/athena/contracts/manifest.py
grep -n "CALL_TIMEOUT_MS =" $A/packages/athena-bridge/inject.js
ls $A/docs/adr | tail -5        # a new ADR on origins, trust, the gate or the caps changes the plan
```

If a value moved, or a new ADR touches origins, contracts, the gate, the capability block or results:
update the table, the constants at the top of `scripts/catalog-check.mjs`, and the plan's
`athena_rules_read_at`, and record a lesson. Never plan against a remembered number.

## The overlay: `<app>/.athena/`

| Path | Written by | Holds |
|---|---|---|
| `.athena/open-plan.md` | `survey`, ticked by `build`, appended by `verify` | the exposure plan (`references/plan-template.md`), its build checklist, the verification table and a `## Skill improvement log` |
| `.athena/catalog-draft.json` | `survey` | the proposed tools as `document.modelContext` would hold them, for `scripts/catalog-check.mjs` |
| `.athena/verify/<UTC stamp>/` | `verify` | the cited reports (pilot `report.md`/`report.json`, desktop `run.json`, the catalog-check output) |

The app's pairing guide is tracked documentation, not overlay: `docs/athena.md`, or wherever the app keeps
its guides.

---

## Mode: `survey <app path | url>`

Goal: an exposure plan someone can approve, with every number measured. No app code changes.

1. **Locate the app.** A path: its repo root, its package manager, its frontend build and dev commands.
   A URL alone: load it, record the origin, the meta tags and any tools it already registers, ask for the
   source, and stop before the catalogue (`kind: external`).
2. **Classify it** (`surface-selection`). Web or Tauri (`src-tauri/tauri.conf.json`: `devUrl`,
   `frontendDist`, `identifier`). **Find the data path**: grep the frontend for `invoke(` from
   `@tauri-apps/api` against `fetch`, WebSocket and RPC clients. If every read and write is `invoke()`,
   the UI cannot run in her tab; the plan's first item is the HTTP path it needs, or the plan says the app
   cannot be opened yet. Record how the UI will be served into her tab (dev server or a static `dist` on
   `localhost`, never `127.0.0.1`) and how it is pointed at its backend.
3. **Pages, routes, deep links** (`orient-tools`). Read the router. For every page: its id, route grammar,
   an example deep link, its purpose, the ids in view. List state with no deep link. **Check the landing
   route**: does an intro, splash or route restore navigate (with replace) after load? If so, that is a
   build item (lesson 1.0.0: the intro stole navigation).
4. **The read and write surface.** Enumerate APIs, RPC methods, store actions. For each: read or write,
   reversible or not, does it reach outside the app (a person, a payment, a public URL, another system),
   its source `file:line`. For reads, the largest realistic answer, measured on real fixture data where
   it exists. Note ids that are only unique inside a container.
5. **What the orient tools would say.** Draft `where_am_i` for three representative routes, the
   `app_map{}` index, and the topics.
6. **The catalogue** (`tool-classes`, `description-budget`, `result-budget`, `digest-guarded-edits`).
   Curate: orient tools, the reads the person's jobs need, one allowlisted read router for the long tail,
   named GATED writes. Write it as `.athena/catalog-draft.json` (`name`, `title`, `description`,
   `inputSchema`, `annotations`, `athena`), then measure it:
   ```bash
   node <skill>/scripts/catalog-check.mjs <app>/.athena/catalog-draft.json --app <slug>
   ```
   Iterate until it prints no validator problem and the footprint is at most 5,000. Put the tool table,
   the totals and the footprint in the plan.
7. **Trust and pairing** (`trust-and-pairing`). Does the backend check `Origin`? Where is the allowlist
   (`file:line`), does it admit `http://localhost:*`, does it bind loopback? Is there any token the page
   would have to hold? Write the pairing steps, re-trust included.
8. **Risks**, each with what it would cost and its mitigation: the data path, a landing route, long
   operations over 30 s, ids, writes that spend quota or reach people, the backend's exposure.
9. **Write `<app>/.athena/open-plan.md`** from `references/plan-template.md`, `status: surveyed`.
10. **Close** (below): the chat reply gives the tool count and footprint, the decisions the operator must
    take (scope, which writes, what stays out of reach), and the risks ranked.

## Mode: `build [app path]`

Goal: the plan's catalogue, shipped in the app to the standard, with its tests and its guide.

0. Read the plan. If the app changed since `surveyed` (`git log --since`), re-check the surface it rests
   on before building. Work in a worktree of the app's repo.
1. **Backend prerequisites first**: the Origin allowlist; any read the catalogue needs that has no API; a
   digest-guarded get/set for documents (`digest-guarded-edits`), with its own tests.
2. **Page identity and the opt-in** (`page-identity-and-opt-in`): the meta tags; the detector and the
   stored toggle (default off, rendered only when the registry exists); the catalogue as a dynamic chunk;
   one `AbortController`; `unregisterTool` on abort.
3. **The tool kit**, once: the class table bound from the class; `out()` returning `{content: [{type:
   "text", text: JSON}]}`; `ToolError` as `<code>: <message>`; `bounded()`; the bind `guard` with
   `fitBody` at 1,500; schema builders that emit closed schemas; a context whose `show()` navigates
   through the app's router. Shadowrunr's `apps/console/src/app/agent/tool.ts` is the reference.
4. **Orient tools**, then **reads** (with `show`, bounded, paged), then **writes** (GATED, small readable
   arguments, edit by find/replace against a base digest).
5. **Fix the landing route** if the survey found one.
6. **Tests** (all producer-side, no Athena):
   - the catalogue: exact tool list and classes; both hints and the `athena` block per class; legal names;
     descriptions 41 to 240; closed schemas; at most 24 properties; every array with `maxItems`; enums at
     most 12; `tools_here` names only catalogue tools; `show` on every READ with a view;
   - the footprint: the renderer port of `capability-footprint` with its golden line, total at most 5,000;
   - the size guard: every tool at its largest realistic inputs answers in at most 1,500, over a fake
     backend built from real fixtures, with a test that every tool has a case; the guard's trim, cursor
     drop, refusal and write-done behaviour;
   - the opt-in gate: the two conditions, and abort leaving zero tools;
   - per tool: the refusals (allowlist, mode checks, conflicts, exactly-once matches).
7. **The pairing guide** (`docs/athena.md` or the app's equivalent): when the catalogue is published; the
   pairing steps with re-trust; how she works it (orientation in results, `show`, no ambient selection,
   bounded answers, the result shape and errors); the catalogue table with classes; what stays out of
   reach; how to run the e2e. Shadowrunr's `overlord/docs/guide/athena.md` is the reference.
8. **Gates**: the app's own test, lint, typecheck, build and bundle budget; then the seam check without
   Athena:
   ```bash
   node <skill>/scripts/list-tools.mjs --desktop <athena-portable>/apps/desktop --dist <app>/dist \
     --storage <slug>.athena.drive=1 --query "?<backend param>" > <scratch>/tools.json
   node <skill>/scripts/catalog-check.mjs <scratch>/tools.json
   ```
9. Tick the plan's checklist, `status: built`, and hand over to `verify --level 1`.

## Mode: `verify [app path] [--level 0|1|2|3] [--attach <cdp url>]`

Goal: the e2e walkthrough, level by level (`verification-ladder`). Default: levels 0 and 1; 2 and 3 only
when asked. Each level that fails stops the climb. The harness and the driver are athena-portable's
(`references/harness.md` says what is generic and what is Shadowrunr's).

- **Level 0, producer.** The app's own catalogue, size and footprint tests, then `list-tools` plus
  `catalog-check` on the built `dist`. Copy the catalog-check output to `.athena/verify/<stamp>/`.
- **Level 1, the keyless scripted harness.** Real backend on scratch copies (keyless), the built UI in
  headless Chromium with `inject.js` (`apps/desktop/e2e/support/webmcp-page.ts` `openAppPage`, with the
  opt-in seeded), a real `athena serve` over scripted transcripts (`e2e/support/daemon.ts`), the shell's
  own run loop (`e2e/shadowrunr/support/loop.ts` `wireLoop`). Shadowrunr:
  ```bash
  SHADOWRUNR_ROOT=<overlord checkout> pnpm -C apps/desktop test:e2e:shadowrunr
  ```
  A new app gets `apps/desktop/e2e/<app>/` with the fixed cases of `verification-ladder` rule 3, modelled
  on `e2e/shadowrunr/`; the per-app config of `references/harness.md` is the shape to grow toward, built
  with the second app. **Set every checkout path explicitly** (from a worktree the sibling default points
  nowhere and all 13 Shadowrunr tests skip with exit 0) and fail the level when the passed count is zero.
- **Level 2, the live pilot** (`ATHENA_LIVE=1`, spends quota). Four to six cases, each a fresh
  conversation starting on a different page, prompts that mirror the person's real jobs (cold
  orientation, a walkthrough, a change, an analysis). The report (`e2e/support/pilot.ts`) per case: turns,
  calls, calls before content, first content call, unknown tools, cards filed and approved, cost, wall
  time, the final answer. Copy it to `.athena/verify/<stamp>/`, then **compare it with the previous
  pilot's table** and name every change; a fix wave is not done until a pilot after it shows the delta.
  Read the transcripts of the worst two cases; each failed call is a finding against a technique.
- **Level 3, the real desktop** (`ATHENA_DESKTOP=1`, spends quota), through `apps/desktop/drive/`:
  - *launch* (default): an isolated build with its own identifier. **Rebuild it right before use, from a
    clean tree** (`git status --porcelain apps/desktop/src apps/desktop/src-tauri` empty), into its own
    `CARGO_TARGET_DIR` (`walkthrough-operations` has the commands). Then
    `ATHENA_DESKTOP=1 ATHENA_DESKTOP_EXE=<exe> pnpm -C apps/desktop test:e2e:desktop` for Shadowrunr.
  - *attach* (`--attach http://127.0.0.1:9222`): the user's own instance over raw CDP, once, to reproduce
    what they see. Say first that it leaves the origin row, the conversation and ledger rows in their
    Athena and that cost grows per run.
  - For an app with no desktop suite yet, the same walk through the CLI, every step a person's:
    ```bash
    pnpm -C apps/desktop drive launch --exe <exe>      # or: --cdp <url> on each command to attach
    pnpm -C apps/desktop drive ready && pnpm -C apps/desktop drive onboard
    pnpm -C apps/desktop drive register "http://localhost:<port>/<target hash or ?backend=...>"
    pnpm -C apps/desktop drive hand <tab> page_find '{"query":"Athena"}'     # then page_click the toggle
    pnpm -C apps/desktop drive tools <tab>                                    # the catalogue is listed
    pnpm -C apps/desktop drive retrust localhost:<port>                       # reads AUTO, writes GATED
    pnpm -C apps/desktop drive say "Where are we?"                            # orients without a card
    pnpm -C apps/desktop drive say "<a write on scratch data>"; pnpm -C apps/desktop drive cards
    pnpm -C apps/desktop drive approve <id>   # and one decline
    pnpm -C apps/desktop drive shot athena <out>.png; pnpm -C apps/desktop drive stop
    ```
    Then promote it to `apps/desktop/e2e/desktop/<app>.e2e.test.ts` on `drive/athena-drive.mjs`.
- **After every level**: assert the real trees' digests, clean up (`walkthrough-operations` checklist),
  append a row to the plan's verification table (date, level, result, cost, report path), set `status`.

## Mode: `status [app path]`

Read-only. Print the plan's front matter, the unticked checklist items, the verification table and the
next step. Writes nothing, logs nothing.

## Mode: `lessons`, and the closing step of every mode

Every mode except `status` ends here.

1. **Is there a lesson?** A lesson is an observation from this run that would change how a future run
   behaves: a rule of Athena's that moved, a defect class the method missed or caught late, a step that
   was wrong, missing or wasted, a measurement that contradicts a number in the standard. A run that went
   as the method describes has none. "No issues", a restated step, or a summary of the task is never a
   lesson.
2. **Where it goes.**
   - Method lessons (true for any app): append to this skill's `LESSONS.md` under a heading for the
     version used, `## <version> - <YYYY-MM-DD> - <app or project>`, one bullet per lesson, each with what
     was measured (numbers with their date and n). Never edit an older bullet; when a lesson is applied to
     `SKILL.md`, a technique or a script, end its bullet with "applied in <version>: <where>" and bump the
     version (patch for wording, minor for a step, major for a redesign).
   - App lessons (true for this app only: a fixture, a port, a quirk of its router): one dated line in the
     plan's `## Skill improvement log`.
   - A lesson that would generalize beyond Athena (another host, another agent, another app family):
     also a registry lead (below).
3. **Say it in the reply**: the lessons recorded and where, or plainly that there were none.

## Knowledge sync

The registry is the organization's standard; this skill's standard cites it subject by subject
(`references/standard.md` section 4). Resolve subjects through
`<registry>/knowledge/software-engineering/index.json` -> `subjects[<slug>].file`, never by building a
path. Before a design decision in `survey` or `build`, read the golden path of the subject that governs
it (`mcp-tools`, `tool-result-economy`, `hitl-approval`, `device-pairing`, `agent-browser-control`,
`agent-addressable-ui`, `test-harness`, `eval-harness`). Where the app falls short of the standard, that
is a deviation, recorded in the plan; never lower the standard to the code.

When a change this run made and verified teaches something that generalizes, append one line to
`.ai/registry-leads.jsonl` in the main checkout of the repo the change landed in:
`{"ts":"<ISO>","bundle":"software-engineering","nearest":"<slug or null>","kind":"technique|application|subject","claim":"<when X, do Y, because Z>","because":"<what was measured>","confidence":"low|medium|high","from":"open@<version>"}`.
A lead never edits the registry. Say in the reply whether one was filed.

## Files

| File | Use |
|---|---|
| `references/standard.md` | the golden path, Athena's acceptance rules with sources, the technique index, the registry table |
| `references/techniques/*.md` | one concern each: rule, procedure, checks, evidence, registry |
| `references/plan-template.md` | the shape of `.athena/open-plan.md` |
| `references/harness.md` | the athena-portable harness: what is generic, what is Shadowrunr's, the per-app config proposal |
| `scripts/catalog-check.mjs` | a catalogue (draft or listed) against her validator and renderer: per-tool lines, footprint, problems |
| `scripts/list-tools.mjs` | what a built `dist` registers through `inject.js`, as JSON, with the opt-in seeded |
| `LESSONS.md` | the skill's memory |
