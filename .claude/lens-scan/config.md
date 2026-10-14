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
