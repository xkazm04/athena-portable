# UAT run 2026-10-25-challenge-live - desktop live paths left by the challenge run

Level: **L2 (empirical)**, targeted - the three live paths the challenge-2026-10-25 run could only test
offline (backlog item F5). No paid provider calls. Driver: `uat/driver/drive-script.mjs` over CDP into the
real Tauri shell (debug build of HEAD, dev server 1431), plus headless Chromium for the example boards.

| Path | Verdict | Evidence |
| ---- | ------- | -------- |
| 1. A crashed daemon sidecar respawns on its bounded ladder (502ec645, ADR 0206) | **pass** | `p1-respawn`, `p1-bounded` journals |
| 2. A restart lands where you left (768dd76b, ADR 0209) | **pass** | `p2-before`, `p2-after`, `p2-dock-*` journals |
| 3. Forced-colours / prefers-contrast modes hold (hirelane 13674655, ledgerbox 9fd4b303, tidycrm 6f3fbd2d) | **pass with one finding** | `shots/*-forced*.png`, `shots/contrast-report.json` |

## Path 1 - self-healing sidecar

- Killed the daemon process (python, pid from its listening port). The shell reported
  `starting/1 - "the daemon exited; starting it again in 1s (attempt 1 of 5)"` 0.2 s later and was
  `ready/1` on a new port 2.4 s after the kill; `/health` answered 200.
- Bounded: killing it each time it came back gave attempts 1-5 with widening gaps (about 3.5, 5.5, 10, 18 s),
  then `failed` with "the daemon exited 5 times in a row; restart it from Settings". No endless loop.
- A relaunch starts a fresh ladder (`ready`, attempt 0).

## Path 2 - session restore

- Before: tabs for ledgerbox (3001), hirelane (3002), tidycrm (3004); hirelane focused; tidycrm closed;
  ledgerbox's origin switched off through `store_set origins` (the Apps scene's write).
- After a hard quit and relaunch on the same store: only hirelane came back, focused (tab id 4 - no id
  reissued); the closed tab and the since-disallowed origin stayed gone.
- Her dock: a saved free dock at (400, 300) came back - her window at (392, 292), which is the seal point
  minus the 8 px `MARGIN` around the 76 px seal (`companion.rs` MARGIN/SEAL). The first attempt failed only
  because the throwaway store was not onboarded: a first launch deliberately places her for the welcome
  paper and skips the saved dock (`lib.rs` `is_first_launch`). Ceiling: the drag that writes `shell.dock`
  was not driven; the row was written in the shape the shell saves.

## Path 3 - contrast modes (emulated)

Chromium emulation of `forced-colors: active` and `prefers-contrast: more` (WebView2 is Chromium). All three
boards are legible under forced colours: hirelane's columns and counts, ledgerbox's late/credit/disputed
glyphs and pressed chips, tidycrm's database cards. On first load 3/13 (hirelane), 10/14 (ledgerbox) and
4/13 (tidycrm) forced-colours rules match live elements; the rest are state-bound (an open gate, a picked
mark, a connected agent, hover) and were not exercised. Hirelane's `prefers-contrast: more` block: 2/2 rules
match. Ceiling: emulation, not a real Windows High Contrast desktop; tidycrm's 3D volume draws nothing in
headless Chromium (no GPU) in either mode, so the volume's own dots were not seen.

### Finding UAT-CL-1 (L2, minor, trust)

**Tidycrm's volume legend loses its keys under forced colours.** The four keys - graphite (nothing
outstanding), redline (deviates), gold (identity pair no rule may resolve), red wash (a cell holding an
outstanding table) - are told apart only by colour. Under `forced-colors: active` every key computes to the
same white fill and black border (`tidycrm-legend-forced.png`, the probe in `contrast-report` notes), so a
High Contrast user cannot read which dot means what. 6f3fbd2d covered the sheet's cues, not this legend.
Suggested acceptance: under forced colours each legend key carries a distinct non-colour cue (shape, border
style or glyph) and the same cue marks its dots in the volume; a test asserts the four keys compute
distinct border styles or content under the forced-colours media query.

## Residue

Throwaway store under the OS temp directory (not the repo): settings `onboarded`, `shell.dock`,
`shell.session`, an `origins` row for 127.0.0.1:3001 (disabled), tab ids 1-4. Nothing written to a
user store or the repo beyond this run directory.
