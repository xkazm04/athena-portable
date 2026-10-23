---
context_map: context-map.json
standard_lenses: C:/Users/kazda/kiro/bp/docs/standard/lenses
project_slug: athena
project_name: "Athena"
default_lens: development
---

# lens-scan overlay - written by /adopt-bp 1.2.0 on 2026-10-14

The product tree in .ai/lens-scan/app-structure.json is declared (provenance.product_tree: adopt-bp): lens-scan
phase 1 merges into it and never remaps contexts 1:1. Add `## Gates`, `## Harness` and `## Probes` as the
lens-scan SKILL.md overlay table describes; standard_lenses is a machine path to the bp checkout.

## Harness

Written 2026-10-14 for bp's validation run. The desktop companion renders its scenes in a plain browser through
its own preview harness (apps/desktop/src/preview.tsx: preview.html?scene=<name>&theme=light|dark), the same
entry its perf gate drives. Native window capture is a planned follow-up.

command: cd apps/desktop && npx vite --port 1431 --strictPort
url: http://127.0.0.1:1431
ready: /preview.html
sizes: 1600x900
themes: light, dark
theme: query ?theme=
features:
  companion-window: route /preview.html?scene=surface
  mind-and-first-run: route /preview.html?scene=mind
  apps-depth: route /preview.html?scene=apps
  chores-depth: route /preview.html?scene=chores
  accounts-depth: route /preview.html?scene=accounts
  voice-depth: route /preview.html?scene=voice
  stage-and-depths: route /preview.html?scene=stage
  bell-and-scene-art: route /preview.html?scene=bell
  halo: unscreenable "a separate native overlay window (halo.html needs the shell's frame events)"
  native-shell: unscreenable "native window only: the Tauri shell"
  desktop-foundations: unscreenable "no screen of its own: shared stores, IPC and styles, seen through every scene"

## Probes

Written 2026-10-15 for the performance lens (lens-scan 1.5.1, metrics.md "## performance"); extended 2026-10-15
(lens-scan 1.5.3) with the metrics that keep headroom on a smooth page. Each probe is the desktop perf gate
(apps/desktop/scripts/perf-gate.mjs, README 3.1, ADR 0089) driving one preview scene by its own drive module
(apps/desktop/scripts/perf-<scene>.drive.mjs, the path `pnpm perf:<scene>` runs and perf-budgets.mjs judges).
`.ai/lens-scan/probes/scene-frames.mjs` only reshapes the gate's data: it builds the preview into its own gitignored
directory, serves it with `vite preview` (a production build), runs the gate's `runPage` with the gate's init-script
probes, copies the frame and long-task lists out the moment the drive returns, and prints one metrics.md JSON line
per metric over five passes, each in a fresh browser context:

- frameP95Ms: every frame interval while the drive ran, pooled (several hundred samples); the skill takes the p95.
- blockingMs: per pass, the sum over the gate's long tasks of (duration - 50 ms); the skill takes the median.
- jankFrames: per pass, frame intervals over 33.3 ms; the skill takes the median.
- idleWakeups: per pass, the gate's idleFrameRequests (requestAnimationFrame calls in its 1000 ms quiet second after
  the drive, so a count per second); the skill takes the median.
- interactionP95Ms: per interaction the drive performs, its Event Timing duration (the longest event entry sharing an
  interactionId), pooled; the skill takes the p95. Printed only when every interaction counted by
  performance.interactionCount was reported. Event Timing reports nothing under 16 ms, so a partial list would bias
  the p95 upward; an incomplete scene prints `unmeasured` with the counts instead.

One command serves every metric of a feature: the entries below share it, and one run gives all of a feature's lines.
Since 2026-10-15 13:28 the probe pools five passes, not three. frameP95Ms readings before then are another series.

probeEnv: local production build, Chrome headless through Playwright at 1600x900 on Windows 11. The gate picks Edge on
Windows, but this machine has no Edge, so every entry names `--channel chrome`; a run on Edge is another series. In this
browser a trivial page's click reads 32 ms in Event Timing and a key press 16 ms (C:/t calibration, 2026-10-15). That
is the floor under every interactionP95Ms reading here.

companion-window frameP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature companion-window --scene surface --runs 5 --channel chrome
companion-window blockingMs: node .ai/lens-scan/probes/scene-frames.mjs --feature companion-window --scene surface --runs 5 --channel chrome
companion-window jankFrames: node .ai/lens-scan/probes/scene-frames.mjs --feature companion-window --scene surface --runs 5 --channel chrome
companion-window idleWakeups: node .ai/lens-scan/probes/scene-frames.mjs --feature companion-window --scene surface --runs 5 --channel chrome
mind-and-first-run frameP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature mind-and-first-run --scene mind --runs 5 --channel chrome
mind-and-first-run blockingMs: node .ai/lens-scan/probes/scene-frames.mjs --feature mind-and-first-run --scene mind --runs 5 --channel chrome
mind-and-first-run jankFrames: node .ai/lens-scan/probes/scene-frames.mjs --feature mind-and-first-run --scene mind --runs 5 --channel chrome
mind-and-first-run idleWakeups: node .ai/lens-scan/probes/scene-frames.mjs --feature mind-and-first-run --scene mind --runs 5 --channel chrome
mind-and-first-run interactionP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature mind-and-first-run --scene mind --runs 5 --channel chrome
apps-depth frameP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature apps-depth --scene apps --runs 5 --channel chrome
apps-depth blockingMs: node .ai/lens-scan/probes/scene-frames.mjs --feature apps-depth --scene apps --runs 5 --channel chrome
apps-depth jankFrames: node .ai/lens-scan/probes/scene-frames.mjs --feature apps-depth --scene apps --runs 5 --channel chrome
apps-depth idleWakeups: node .ai/lens-scan/probes/scene-frames.mjs --feature apps-depth --scene apps --runs 5 --channel chrome
apps-depth interactionP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature apps-depth --scene apps --runs 5 --channel chrome
chores-depth frameP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature chores-depth --scene chores --runs 5 --channel chrome
chores-depth blockingMs: node .ai/lens-scan/probes/scene-frames.mjs --feature chores-depth --scene chores --runs 5 --channel chrome
chores-depth jankFrames: node .ai/lens-scan/probes/scene-frames.mjs --feature chores-depth --scene chores --runs 5 --channel chrome
chores-depth idleWakeups: node .ai/lens-scan/probes/scene-frames.mjs --feature chores-depth --scene chores --runs 5 --channel chrome
accounts-depth frameP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature accounts-depth --scene accounts --runs 5 --channel chrome
accounts-depth blockingMs: node .ai/lens-scan/probes/scene-frames.mjs --feature accounts-depth --scene accounts --runs 5 --channel chrome
accounts-depth jankFrames: node .ai/lens-scan/probes/scene-frames.mjs --feature accounts-depth --scene accounts --runs 5 --channel chrome
accounts-depth idleWakeups: node .ai/lens-scan/probes/scene-frames.mjs --feature accounts-depth --scene accounts --runs 5 --channel chrome
accounts-depth interactionP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature accounts-depth --scene accounts --runs 5 --channel chrome
voice-depth frameP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature voice-depth --scene voice --runs 5 --channel chrome
voice-depth blockingMs: node .ai/lens-scan/probes/scene-frames.mjs --feature voice-depth --scene voice --runs 5 --channel chrome
voice-depth jankFrames: node .ai/lens-scan/probes/scene-frames.mjs --feature voice-depth --scene voice --runs 5 --channel chrome
voice-depth idleWakeups: node .ai/lens-scan/probes/scene-frames.mjs --feature voice-depth --scene voice --runs 5 --channel chrome
stage-and-depths frameP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature stage-and-depths --scene stage --runs 5 --channel chrome
stage-and-depths blockingMs: node .ai/lens-scan/probes/scene-frames.mjs --feature stage-and-depths --scene stage --runs 5 --channel chrome
stage-and-depths jankFrames: node .ai/lens-scan/probes/scene-frames.mjs --feature stage-and-depths --scene stage --runs 5 --channel chrome
stage-and-depths idleWakeups: node .ai/lens-scan/probes/scene-frames.mjs --feature stage-and-depths --scene stage --runs 5 --channel chrome
stage-and-depths interactionP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature stage-and-depths --scene stage --runs 5 --channel chrome
bell-and-scene-art frameP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature bell-and-scene-art --scene bell --runs 5 --channel chrome
bell-and-scene-art blockingMs: node .ai/lens-scan/probes/scene-frames.mjs --feature bell-and-scene-art --scene bell --runs 5 --channel chrome
bell-and-scene-art jankFrames: node .ai/lens-scan/probes/scene-frames.mjs --feature bell-and-scene-art --scene bell --runs 5 --channel chrome
bell-and-scene-art idleWakeups: node .ai/lens-scan/probes/scene-frames.mjs --feature bell-and-scene-art --scene bell --runs 5 --channel chrome
bell-and-scene-art interactionP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature bell-and-scene-art --scene bell --runs 5 --channel chrome

What the probes cannot produce, and why (no entry, so the metric stays unmeasured):

- interactionP95Ms, companion-window: its drive only hovers (no click, tap or key), so there is no interaction to time.
- interactionP95Ms, voice-depth: Event Timing reported 48 of the drive's 60 interactions (its studio keys run under the
  16 ms floor), so the p95 would be biased. A drive with fewer bare key presses, or a trace-based timer, would fix it.
- chores-depth, every metric: perf-chores.drive.mjs:60 waits for a "Fit it to me" button that c0cb495 removed, so the
  drive times out (`pnpm perf:chores` fails the same way). The entries stay so the series resumes once the drive is updated.
- startupMs, every scene: nothing times cold start. preview.html is a harness with no first-interactive mark, and the
  start a person waits for is the Tauri shell's native window, which no browser probe reaches.
- memoryMb, every scene: the gate reads no heap. measureUserAgentSpecificMemory needs a cross-origin-isolated page,
  which the preview is not, and the shipped app's memory is the WebView2 process, not a browser tab.
- bundleKb: no `bundle_stats` with per-feature chunk attribution; never estimated from source size.
- `halo`: no probe for any metric. halo.html is a separate transparent overlay window driven by the shell's frame
  events; the preview has no halo scene and the gate cannot drive it.
- `native-shell`: no probe for any metric. It is the Tauri window itself (Rust, WebView2); a browser measures none of it.
- `desktop-foundations`: no probe of its own. Its stores, IPC client and styles run inside every scene, so their cost
  is already inside each scene's readings and is not separable by feature.
- Every other feature (the agent core, daemon, connectors, proving ground, example apps, journey, build tooling):
  the gate drives only the desktop preview scenes, so no probe exists.

## Skill improvement log

- 2026-10-14: the registry lens (com.xkazm04.registry) needs `$AI_REGISTRY_DIR` (C:/t/rlv-registry); the sibling ../ai-registry has no scripts/registry-lens.mjs, and without a .ai/manifest.yaml no registry map can be built, so the conform step has nothing to judge until p-ef9773 (registration) lands.

## Skill improvement log

- 2026-10-14 quality baseline: give judges three rules up front so one quality run counts the same way across batches. (1) Opt-in recording specs (`examples/journey/tests/*.take.spec.ts`, which only run with `JOURNEY_TAKE=1` or by name) are not flow tests. (2) Platform-conditional skips are judged on the CI gate (ubuntu-latest). (3) A test whose skip condition is true in that gate counts as skipped for one feature only. This run applied all three unevenly across features; the run notes say where.
- 2026-10-14 design measure: adopt-bp left `design.applicable: false` on five features it had also measured (apps-, chores-, accounts-depth, mind-and-first-run, desktop-packaging), so they read `na` beside real numbers; a design run should clear `applicable` on every feature it writes a reading for, as the scan-block rule already does.
- 2026-10-14: footprint.mjs treats a file holding a literal U+0000 as binary and reports it in missing_files (examples/journey/src/record-page.ts:104), so that file is silently outside secretHits/unsafeSinks for four-act-journey; read missing_files as "check the file", not "file gone".
- 2026-10-14 registry measure (r-20261014112207-b207): registration has landed and the map exists, so the conform step now judges. `/conform` is not an installed skill in a headless session; follow `$AI_REGISTRY_DIR/skills/conform/SKILL.md` directly. Two of six "strong" pairs were name collisions (a "sandbox" context vs untrusted-extension-host, a "Harness" Protocol vs eval-harness): check the subject precondition before spending budget on a strong pair.
- 2026-10-14 registry measure (r-20261014155956-6287): chores-depth's primary context (desktop-scenes-chores) has no subject a budget-1 conform can settle - streaming-output/agent-memory/data-access fail their preconditions and test-harness stays under the half-evidence floor - so give its conform budget to desktop-playbooks-panel next time, or judgedPct stays 0.
- 2026-10-14 registry measure (r-20261014160419-537b): the map's "strong" pairs on desktop-scenes-mind-surface (voice-io, mcp-tools, companion-identity, agent-memory) all fail their precondition - the context is the Setup/Mind settings depth plus the Surface home, and its context-map description ("what Athena remembers") is stale - and proving-hosted-server's only strong pair (mcp-tools) is a "server" collision. Next run: spend proving-worlds' budget on the conform-added eval-harness pair, and for UI contexts expect test-harness to land deviation or unknown only (about 4 of its 24 techniques apply, below the half floor for conformant).
- 2026-10-14 registry measure (r-20261014160833-5488): two map rows mislead the pick - tidycrm-design holds only dead code (build-tokens.mjs retired, tc-scales.css imported by nothing), so judge its design-tokens pair at the live consumer components/blocks/style/**; and tidycrm-domain-lib is not an importer (seed only, CSV is export), so import-normalization is n/a - the next budget for tidycrm-import-and-matching should go to a dedupe/entity-resolution pair, and ledgerbox-invoicing-backend's to data-access (app-shell is n/a there).
- 2026-10-14 registry measure (r-20261014161534-7e30): the mcp-tools pairs on the WebMCP apps are real publishers, not name collisions, and both hirelane and demo-kit-ui-webmcp deviate at one shared door (examples/demo-kit/src/webmcp/hooks.ts:93, no schema check/catch/cap); a propose run should file that once against webmcp-kit-and-template and let each app's own item cover only its manifest (hirelane: optional params published required).
- 2026-10-14 registry measure (r-20261014162135-7ae8): the first log line above is obsolete - ../ai-registry (registry.local) now has scripts/registry-lens.mjs, so no $AI_REGISTRY_DIR is needed. Three more map pairs failed their subject precondition on vocabulary alone: "sidecar" (a build-time Tauri externalBin, not provisioned after install), "art/illustration" (a desktop SVG mascot, not a scroll page) and "perf" (a pre-merge lab gate, not in-product instrumentation). For build/packaging and perf contexts, spend budget on packaging and quality-gates first.
- 2026-10-14 registry execute (r-20261014192943-c5dd): 8 of 10 `deviations -1` items failed on re-judge although each closed every shortfall its verdict named. A conform deviation verdict names the first failing technique(s), not the full list, so the grain rule cannot be met from the evidence line alone. Before proposing a `deviations -1` item, re-judge the pair per technique (all applicable techniques, conform section 3) and put every unrealized one in the Flow. Also: the cut-off run merged builds before re-measuring them, so the failures had to be reverted on main (7 reverts); re-measure in the worktree, then merge.
- 2026-10-15 performance measure (r-20261015105920-70e0): (1) this machine has no Edge, so the probe entries name `--channel chrome`. A run on another machine must keep the channel or note the series break. (2) frameP95Ms reads 16.8 ms, the 60 Hz vsync floor, on every probed scene, so frameP95Ms cannot carry a delta here. A useful performance item needs interactionP95Ms (Event Timing in the drive) or a trace-backed long-frame count. (3) A drive module rots with its scene: perf-chores.drive.mjs has been stale since c0cb495. Run `pnpm perf:<scene>` before trusting a missing reading. (4) The probe wrapper lives in `.ai/lens-scan/probes/`, which `.git/info/exclude` hides, so the entries need that file on the machine.
- 2026-10-15 design execute (r-20261015112211-ab3d, pack k-des-1): (1) the overlay has no `## Gates` and .ai/manifest.yaml declares no capabilities, so gates were chosen per package (tsc, eslint, tests; next build for the example apps). Add a `## Gates` block so an execute does not have to pick. (2) In a pack worktree with junctioned node_modules, `next build` (Turbopack) fails with "Symlink ... points out of the filesystem root"; `next build --webpack` builds, so use it as the example apps' build gate there.
- 2026-10-15 performance measure (r-20261015132844-b364) and k-des-1 shot backfill (r-20261015132209-fab4): (1) in a worktree with junctioned node_modules, pnpm 11's verify-deps-before-run turns `pnpm exec vite build` into a `pnpm install` through the junction (it failed; main's node_modules survived). Run probes there with `pnpm_config_verify_deps_before_run=false`. (2) blockingMs, jankFrames and idleWakeups read 0 on all seven scenes, already at target, so here the headroom metric is interactionP95Ms. Event Timing rounds to 8 ms, this browser's floor is 32 ms per click and 16 ms per key, and baseline p95s vary 80-88 between runs, so an item has to predict a move of 16 ms or more, or test it against bracketing baselines (deferring Stage's focus-on-move did not move it). (3) Every browser's pass 1 holds one 66-200 ms frame from GPU first-use, with no long task; it was the mind scene's 2451 ms. Judge passes by their median and do not chase a pass-1 max frame. (4) The k-des-1 items design failure states, but the harness routes render each scene's default fixture, so their before/after shots show only "no regression". To show the designed state, the item needs a preview fixture that reaches it (a route with `&fixture=<failure>`).
- 2026-10-15 design execute (r-20261015145820-720b, pack k-des-2): (1) another session's `pnpm dev` can hold port 1431 (the Tauri dev port) and serve the main checkout; harness.py's `vite --strictPort` then dies quietly and the ready poll is answered by that server, so a pack's shots silently show main. Before shooting, check the port is free (or shoot a worktree on another port with a copy of this overlay). (2) harness.py's `steps` form always loads `/` first, and `/` is 404 on this preview, so the topic page (`?scene=chores&at=%23/chores/<id>`) plus a click needs a one-off script. (3) The preview's playbook fixtures never touch the clipboard, so a refused copy cannot be shot without a rejecting fixture.
