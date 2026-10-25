# Backlog - scan-sweep --challenge, 2026-10-25

Run: `.claude/scan-sweep/runs/challenge-2026-10-25/` (r1..r6), 56 hosts and 12 riders, 112 cards.
What is left for a person after the build. Each item names its evidence; nothing here is built.

## Owner calls (Lane C)

| # | Item | Evidence | What it waits on |
| - | ---- | -------- | ---------------- |
| C1 | First-paint ceiling raised 165,000 -> 165,412 B by r1 mind-surface/B | 9e8de7e4, `apps/desktop/scripts/first-paint.mjs` header; the ratchet says raising is the owner's | keep the raise, or revert the surface "needs" list to a lazy chunk |
| C2 | voice-waking/B demoted: the first act opens on the step she still needs | `r2/builds/desktop-scenes-voice-waking-B.patch`, 7/7 cases green, 140 B gz over the ceiling | a ceiling raise of ~140 B, or a smaller first frame |
| C3 | art-bell/A demoted: the Bell mirrors her face signal (`Pose` gains `speaking`) | `r5/builds/desktop-art-bell-A.patch`, 8/8 green, 178 B gz over; a lazy split costs ~430 B (a new import() splits the preload helper) | a ceiling raise of ~180 B |
| C4 | avatar/A partial: segment midpoints agree within 0.05 (case 6) | 9f8a932b, todo test; needs mirroring every shape change at ~33 signals/s | loosening ADR 0027's 30 Hz mirror cap |
| C5 | Inline boot script outside the first-paint gauge | f871909a, ADR 0165: +476 B gz per HTML page | accept, or count inline scripts in the gauge |
| C6 | Storyboard stills glob made eager to offset bytes | b4f979f2, ADR 0213: first paint -1,835 B net | accept the eager glob |

## Defects found by the run's instruments (not fixed: outside the finder's write set)

| # | Defect | Evidence |
| - | ------ | -------- |
| D1 | tidycrm: an open pair across two domains is counted twice (blocks show one more pair than `countOpenPairs`) | 0cddf5af - one-op repro committed as a `todo` (`test/model/traces/cross-domain-pair.json`); `examples/tidycrm/lib/blocks/index.ts` |
| D2 | Chores depth: a 76-80 ms long task at "press Enter" - `perf:chores` red on a clean still control | 28770f2e verdict; red at the run base d13abf7a (3/3, 62-67 ms) |

## Follow-ups left by builders

| # | Follow-up | From |
| - | --------- | ---- |
| F1 | "Pick another input above" is wrong in the voice studio, which has no picker | a4d4e129 (r4 voice-ui/B), ADR 0196 |
| F2 | The ledgerbox card still offers Draft on the 14 invoices the chase now refuses | dca80c20 (r4 ledgerbox-domain-lib/B), pinned in `ledgerbox-lanes-ui.test.ts` |
| F3 | A move made before the lazy rise module loads (incl. a reload at depth) no longer focuses the layer | 67909b9f (r4 stage-depth/B) |
| F4 | `index.html` still says the Gauntlet has three surfaces | f8100323 (r3 gauntlet/A) |
| F5 | Live paths not exercised: journey resume (JOURNEY_FROM), narrate synthesis, a real crashing daemon's respawn, a real restart's tab return, High Contrast desktops | r1 journey/B, r3 journey-capture/A-B, r5 shell-rust/A-B, r2/r3/r4 forced-colours cards |
| F6 | `.ai/registry-map.json`: core-gate-and-ledger x hitl-approval is still `deviation`; 8da35cd7 likely resolves it | `/conform` re-judge |

## Flakes seen (attributed to no builder)

- `tests/peer/test_listener.py::test_a_listener_without_the_flag_refuses_a_real_loopback_socket` - WinError 10053; HEAD 1/10; untouched this run. The base control could not run (the scratch worktree would not import `athena`).
