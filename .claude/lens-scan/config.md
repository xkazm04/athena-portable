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

Written 2026-10-15 for the performance lens (lens-scan 1.5.1, metrics.md "## performance"). Each probe is the
desktop perf gate (apps/desktop/scripts/perf-gate.mjs, README 3.1, ADR 0089) driving one preview scene by its own
drive module (apps/desktop/scripts/perf-<scene>.drive.mjs, the path `pnpm perf:<scene>` runs and perf-budgets.mjs
judges). `.ai/lens-scan/probes/scene-frames.mjs` only reshapes the gate's output: it builds the preview into its own
gitignored directory, serves it with `vite preview` (a production build), runs the gate's `runPage` with the gate's
init-script probes, and prints the frame intervals the gate judged - three passes pooled, several hundred samples -
as one metrics.md JSON line. The skill computes the p95; the gate's own verdict per pass rides along as `gate`.

probeEnv: local production build, Chrome headless through Playwright at 1600x900 on Windows 11. The gate picks Edge on
Windows, but this machine has no Edge, so every entry names `--channel chrome`; a run on Edge is another series.

companion-window frameP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature companion-window --scene surface --runs 3 --channel chrome
mind-and-first-run frameP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature mind-and-first-run --scene mind --runs 3 --channel chrome
apps-depth frameP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature apps-depth --scene apps --runs 3 --channel chrome
chores-depth frameP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature chores-depth --scene chores --runs 3 --channel chrome
accounts-depth frameP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature accounts-depth --scene accounts --runs 3 --channel chrome
voice-depth frameP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature voice-depth --scene voice --runs 3 --channel chrome
stage-and-depths frameP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature stage-and-depths --scene stage --runs 3 --channel chrome
bell-and-scene-art frameP95Ms: node .ai/lens-scan/probes/scene-frames.mjs --feature bell-and-scene-art --scene bell --runs 3 --channel chrome

What the probes cannot produce, and why (no entry, so the metric stays unmeasured):

- interactionP95Ms, every scene: the drive modules perform inputs (hovers, clicks, keys) but none defines an
  input-to-paint interaction, and the gate records frame intervals and long tasks, not Event Timing. A probe for it
  is a new instrument the repo does not have yet.
- startupMs, every scene: nothing times cold start. preview.html is a harness with no first-interactive mark, and the
  start a person waits for is the Tauri shell's native window, which no browser probe reaches.
- memoryMb, every scene: the gate reads no heap. measureUserAgentSpecificMemory needs a cross-origin-isolated page,
  which the preview is not, and the shipped app's memory is the WebView2 process, not a browser tab.
- bundleKb: no `bundle_stats` with per-feature chunk attribution; never estimated from source size.
- `halo`: no probe for any metric. halo.html is a separate transparent overlay window driven by the shell's frame
  events; the preview has no halo scene and the gate cannot drive it.
- `native-shell`: no probe for any metric. It is the Tauri window itself (Rust, WebView2); a browser measures none of it.
- `desktop-foundations`: no probe of its own. Its stores, IPC client and styles run inside every scene, so their cost
  is already inside each scene's frame p95 and is not separable by feature.
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
