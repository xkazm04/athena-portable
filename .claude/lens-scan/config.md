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
