# Fathom parity matrix

README section 3.5; `docs/redesign/fathom.md` section 7. Every capability of today's desktop app,
the file that implements it now, where it lives in the depth model, and the proof that it still
works. **A phase is not done until its rows carry a proof** (a test name, or the hand check that
was performed and when). A row with no proof is a regression. Read off the code at commit
`39c5dcd`; paths are under `apps/desktop/`.

Status: `todo` until its phase lands, then `proved: <test or hand check>`.

## Shell

| Capability | Today | Depth | Status |
|---|---|---|---|
| Presence pill: "N waiting", resting, the one-line step; click summons her | `components/ModuleBar.tsx`, `stores/athena.ts` | D0 dock | proved: Stage.test (dock shows her state and waiting count), surface/view.test (summon to her window); hand check pending |
| Theme toggle writing a definite choice | `app.tsx`, `stores/settings.ts` | D2 look | proved: components/WindowControls, the code the bar used, moved unchanged; hand check pending |
| Window buttons (only with a shell); minimise, maximise | `app.tsx` WindowButtons | stage chrome | proved: components/WindowControls moved unchanged; hand check pending |
| Close asks only when a card waits; Escape cancels; focus on keep | `app.tsx` | stage chrome | proved: moved unchanged; its Escape now marks the key handled so the stage does not also rise; hand check pending |
| App-wide stores started once by the root | `app.tsx` | `chrome.tsx` | proved: console/root.tsx starts the same nine plus depth and the shape seam |
| Drag region on every non-control | `app.tsx`, `ModuleBar.tsx` | stage chrome | proved: Stage top bar and crumbs carry data-tauri-drag-region; hand check pending |

## Browser (Apps)

| Capability | Today | Depth | Status |
|---|---|---|---|
| Tab chips with per-tab close; New tab; address field (Enter navigates, Escape discards) | `modules/browser/view.tsx` | page shape band | todo |
| Tools indicator: count, transport, relay problem verbatim, asking | `modules/browser/view.tsx` | page shape band | todo |
| Register an app by URL; trusts the origin before the page is read | `modules/browser/model.ts` register | D1 apps | todo |
| Standing per app: closed, reading, ready, read only, disabled | `model.ts` appOf | D1 apps | todo |
| Open (focus the existing tab or open one), Details | `model.ts` openApp | D1/D2 app | todo |
| App layer: on/off, Open, Forget with two presses, per-tool overrides pinned GATED, last seen | `view.tsx` | D2 app | todo |
| Tool level of one app | new (depth 3) | D3 tool | todo |
| First-run lead with the engine's standing, opens the register form | `FirstRun.engineLine` | D0 / D1 apps | todo |
| Empty state with no tab owns the whole window | `layout.rs` | scene shape | todo |
| Degraded: tabs not loaded; origins unreadable | `problem`, `appsProblem` | D1 apps | todo |

## Playbooks (Chores)

| Capability | Today | Depth | Status |
|---|---|---|---|
| Hero and totals: N of M benched, $X of $Y found | `modules/playbooks/view.tsx` | D1 chores | todo |
| Map of difficulty against usefulness; points operable with Enter or Space | `view.tsx` | D1 chores | todo |
| Audience filter and sort (hardest first, money, time) | `view.tsx` | D1 chores | todo |
| Verdict per playbook, unbenched word, on the edge flag, speedup | `model.ts` verdictOf | D1 chores | todo |
| Chore layer: chore, portals (each with Open), method, gates, result, runs, traps, replay, evidence | `FacetBody` | D2 chore | todo |
| Replay: play or pause, Back and Next, ArrowLeft and ArrowRight, turn rail, show all | `view.tsx` | D3 run | todo |
| Copy the command; hand it to her (offer + project); open a portal in the Browser | `index.ts` | D2 chore | todo |
| The "simulated" line | `SIMULATED_LINE` | D1 chores | todo |
| Evidence film or thumbnail with currency check | `view.tsx` | D2 chore | todo |

## Connectors (Accounts)

| Capability | Today | Depth | Status |
|---|---|---|---|
| Standing: not connected, connected, needs re-auth, off, broken, unconfirmed | `modules/connectors/model.ts` | D1 accounts | todo |
| Records notice: alert, verbatim, not dismissable, rows read unconfirmed while it stands | `view.tsx` L127 | D1 accounts | todo |
| Connect by token (Enter sends); by OAuth (client id and secret, consent link, phases, failure) | `view.tsx` | D2 account | todo |
| Disconnect with two presses; Keep it | `view.tsx` L541 | D2 account | todo |
| Credential seal sentence (file rung stated as not encrypted); health; Check now | `view.tsx` | D2 account | todo |
| Enable on or off; writes on or off with the approval hint; disabled reason | `view.tsx` | D2 account | todo |
| Tool lists: reads, and writes marked GATED | `isWrite` | D2 account | todo |
| Allow-list editor (draft, Escape cancels, add, remove) | `view.tsx` | D3 allow-list | todo |
| Per-row busy and error ("refused") | `view.tsx` | D2 account | todo |
| Unreadable, unreachable, waiting for the daemon | `problem`, `ready` | D1 accounts | todo |

## Setup (first act, then Mind)

| Capability | Today | Depth | Status |
|---|---|---|---|
| Onboarding letter: engine, first app, microphone, each with a standing | `modules/setup/view.tsx`, `readiness.ts` | D0 setup | proved: waking/view.test (engine remedy, first app address, microphone with its own fact) |
| Finish gated by readiness and explains itself | `isReady`, `notReadyBecause` | D0 setup | proved: waking/view.test (Wake her disabled with the reason; open with an engine and a page, with or without a microphone) |
| Finish selects the Browser and opens the first app | `index.ts`, `companion.rs` after_onboarded | D0 setup | changed: Wake her ends on the surface and selects no module (a stray `browser` would show a page under the scene, ADR 0088); the first app is the one opened in step 2. The welcome in her own window still asks Rust to select `browser`: phase 6 makes the stage follow layout:changed |
| Reopen onboarding from settings | `reopenOnboarding` | D2 | todo |
| Engine: choose (with the probe's remedy as disabled reason), Check again, probe table | `chooseSetupEngine`, `checkEngines` | D2 engine | proved for the first act: waking/view.test; the settings depth is phase 9 |
| Restart notice when the stored engine differs from the running one; Restart | `pendingEngine` | D2 engine | proved for the first act: same note as the letter; settings depth is phase 9 |
| Start-failure card with the reason and Try again on X | `StartFailure` | D2 engine | proved for the first act: waking/view.test renders the model's failure with Try again; settings depth is phase 9 |
| Theme: system, light, dark; text size; miniatures | `ThemePreview` | D2 look | todo |
| Brain path | `setBrainPath` | D2 brain | todo |
| Microphone check (getUserMedia) | `checkMic` | D2 / voice | proved for the first act: waking/view.test (checkMic, its standing); settings depth is phase 9 |
| Store path | `view.tsx` Data | D2 data | todo |

## Voice

| Capability | Today | Depth | Status |
|---|---|---|---|
| Daemon standing: ready, starting, offline, with the plain sentences | `modules/voice/index.ts` | D1 voice | proved: scenes/voice/view.test (the field says ready, off with the config's reason, starting, loading, offline with "Athena's daemon is not running, so her voice cannot be set up yet.", "Athena could not read her voice setup." with Ask again, and the gates stand in front of both places); the selector and connect are `useVoiceModel`, shared with the module |
| Studio steps: engine, install, pick, hear, ready; clickable rail; Restart | `studio.tsx` | D2 studio | proved: scenes/voice/view.test (every step renders with its number, title, her line and dock; the rail goes back to every answered step and not ahead; Restart), interact.test (rail and Restart are wired); changed: "Her card" (the right-hand summary) is folded into the rail's per-step notes and the Ready card, and Start over is called Restart |
| Kokoro install with progress and error; manual option | `installView` | D2 studio | proved: scenes/voice/view.test (64% with its phase and a progress ring round the drawing, the failure with its reason and Try again, manual with both links and Check again, a refused install request) |
| Voice pick with preview toggle | `togglePreview` | D2 studio | proved: scenes/voice/view.test (Play with Space, Stop while playing, her first words, the error phase), keys.test (Space toggles only once her voice is installed), interact.test (one frame loop while she plays, none at rest) |
| Hear: record takes through Whisper and OpenAI side by side; pick one | `sttColumns` | D2 studio | proved: scenes/voice/view.test (both columns with text and milliseconds, pending, failed, refused microphone, a listener that is not ready muted with its reason and a key field, Use this one, "is picked. Press Enter to keep it."), keys.test (1 and 2 pick only a ready listener), interact.test (hold button and Space start and stop a take) |
| OpenAI key field: Enter saves, never shown back; replace, remove, keep | `KeyField` | D2 settings | proved: scenes/voice/interact.test (Replace opens the field, Keep the stored key closes it without saving, Enter saves the trimmed key and the key is never in the page again, Remove is disabled with "Removing the key..." while busy), view.test (a stored key shows no key, an absent one a password field) |
| Whisper models install list | `install("whisper:id")` | D2 settings | proved: scenes/voice/view.test (every model with its standing, Install small.en when the chosen one is missing, the running download with its megabytes) |
| Live meters (spectrum, level, mic) | `waveform.tsx` | D2 studio | proved: scenes/voice/interact.test (no frame is requested by any fixture at rest; a recording take or a playing voice runs exactly one loop and it is cancelled when it ends), view.test (micBins); changed: the hero is the existing Waveform, fed by her spectrum or by the microphone's level (labelled stylised), so the orb's level glow is not drawn separately and the window never runs two loops at once; settings keeps the module's MicMeter on the Test take |
| Studio keys: Enter, B, S, 1, 2, Space (hold to record) | `keyAction` | D2 studio | proved: scenes/voice/keys.test (each key on each step through the module's own table, Space holds and release stops, a text field keeps every key, a button its own Enter and Space, chords and repeats ignored, Escape left to the stage), interact.test (the document takes the keys, stops when the studio goes away and stops a take in progress), model.test (the table); the dock chips are the same keys as buttons |
| Settings: output and input cards, Test take, Refresh, Reopen studio, hotkey hint | `view.tsx` | D2 settings | proved: scenes/voice/view.test (Output and Input panels, Refresh, Reopen studio, the test take naming its listener or saying it is not ready, "hold Ctrl+Shift+Space"), interact.test (Reopen studio reopens and dives, Refresh asks again, the test take's hold button); changed: "Run the studio again" is called Reopen studio and "Check again" on the engine is the one Refresh in the header |

## Companion window (stays its own window; the bell is shared)

| Capability | Today | Where | Status |
|---|---|---|---|
| Seven forms and their sizes, pinned by test against `companion.rs` | `lib/companion.ts` | unchanged | todo |
| Seal: toggle ledger, drag, snap to edge, tab, peek | `views.tsx`, `companion.rs` | unchanged, Bell reused | todo |
| Tape, Hear, Slip (Approve A, Decline D, hold to Speak, refusal keeps the card, stamp, tear) | `views.tsx`, `runtime.ts` | unchanged | todo |
| Capture on a gated proposal (Windows), read back by id | `capture.rs`, `capture.ts` | unchanged | todo |
| Ledger: Talk, Record, Origins; pin; Clear; collapse | `views.tsx` | unchanged | todo |
| Welcome: engine fact, open your first app, later | `Welcome` | hands over to D0 setup | todo |
| Push to talk, chords, Esc, Enter on welcome | `live.tsx`, `hotkeys.rs` | unchanged | todo |
| Halo overlay | `halo/`, `halo.rs` | unchanged, reads the same signal | todo |

## Cross-cutting

| Capability | Proof wanted | Status |
|---|---|---|
| Light and dark both render every scene from tokens only | token test + both-theme screenshots | todo |
| `prefers-reduced-motion` and Calm give the final state, not a faster animation | perf gate + test | proved: layers.test (calm is one layer), bell.test (animation off), motion.test; perf gate under calm pending |
| Every scene renders every fixture in `preview.html` with no Tauri | view tests over `fixtureIds` | todo |
| Hash deep link reaches any depth; unknown ids fall back to D0 | depth tests | proved: depth/model.test (round trip, fallback) and depth/store.test (hash mirror) |
| Escape rises exactly one level from any depth and never closes the window | depth tests | proved: depth/model.test (rise from every place), Stage.test (escapeRises) |
| Rust rectangles for both shapes; `--bar-height` and `--strip-height` match | `layout.rs` tests, tokens test | proved: layout.rs tests (both shapes, shape ids), depth/shape.test (ids equal Rust's) |
| Perf budgets of `fathom.md` section 5 | `pnpm perf` | todo |
