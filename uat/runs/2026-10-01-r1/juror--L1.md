# juror -- L1 (code only, no browser) -- run 2026-10-01-r1

Lens: claim versus reality. Every sentence the UI shows a stranger, traced to the code that makes it true.

## Verdicts
| Journey | Verdict | Why in one line |
|---|---|---|
| J1 first launch | L1-conditional | The welcome is drawn, not stock, and the idea lands in two sentences. But "Engine: X" is a default, not a probe, "no cloud" is loose, and "Open your first app" opens no app. |
| J2 live with her | L1-conditional | The put-away/summon/tray model is real and tested. Main's pill lies in four of seven states, Main's Close button label is false, and the tray icon is a different mark. |
| J3 decide a card | L1-conditional | The card is honest about parameters and GATED. The stamp and "sent to the record" fire before the daemon has answered; a failed resolve leaves an APPROVED stamp and no card. |

Grounding score (six canonical sources, shell side of the turn): 4 of 6 wired and visible in the shell (page tools, focused origin, user message, gate class). Project: 0 (`project_id` exists on `TurnBody`, `lib/api.ts:169`, but `run.ts` never sets it and nothing calls `setActiveProject`). Prior fact from the brain: not provable from the shell, it is daemon-side (uncertain, L2). Additions named: host_state (tab titles and urls, capped at 12, `run.ts:119-129`), and a `surface` tag.

Wiring ratio (declared vs reached a view or a caller):
- Rust-to-page events: 6 of 6 emitted events are heard (orient, snap, summon, chord, status, store:changed).
- `AthenaStatus` fields: 3 of 4 reach a view; `visible` is stored in `useAthena` (`athena.ts:43`) and read nowhere.
- Machine events (non-timer): 16 of 19 have a producer; `hide`, `show`, `expand` have none, so the `hide` effect and `athenaHide` from her window are unreachable. Her only way to be put away is the tray or closing her window.
- `src/components/`: 10 of 15 used; EmptyState, Facts, PageSection, PushToTalk, Table are orphans.
- `src/assets/athena-mark.png`: 0 of 1 used.
- `activeProjectId`: 0 uses outside its own store; `setActiveProject`: 0 callers.
- Capability `allow-athena-hide` on `chrome` (`capabilities/ui.json`): 0 callers.

Time saved (juror's chore: decide in five minutes whether this is real): about 1 to 2 minutes of the five, low confidence. The identity and the slip let me decide fast; the false-state pill and the stamp-before-answer are what I would spend the saved time re-checking.

## Reproductions run
- `pill.mjs` (scratchpad) copies `isResting` and `pillText` from `src/stores/athena.ts:309-317` and runs them over every state her window reports (`athena_report(form, ...)` at `live.tsx:289-292`). Output: seal -> "Athena is resting"; tape -> "Athena is working"; hear -> "listening"; slip (0 cards) -> "Athena is working"; welcome -> "Athena is working"; ledger -> "Athena is working"; tab -> "Athena is working"; slip with 1 card -> "1 waiting". Clean branches: seal, tape (with a line), hear, slip with a card. Unclean: tab, ledger, welcome, slip without cards. It is a copy of the function, not an import (the module needs the shell), so L2 should read the pill live.
- Visual read of `src-tauri/icons/icon.png` and `src/assets/athena-mark.png`: cyan "A" with a flat crossbar on a near-black rounded square. The in-app mark (`drawing.tsx:19-29`, `ModuleBar.tsx:173-189`) is a dark "A" with a tick crossbar cut from a teal field. Two different marks; the tray (`tray.rs:78-80`, `default_window_icon`) and Main's taskbar entry use the first.

## Surface model, in brief (file:line)
- First window (fresh store): `lib.rs:206-215` builds Main hidden and her window at `welcome`; `companion.rs:433-441` places her near top middle. Control -> `Welcome` (`views.tsx:325-360`) -> `actions.open` -> machine `open` (`machine.ts:407`) -> effect `onboard` -> `settings.setOnboarded` (`live.tsx:72`) -> store write -> `store.rs:943` -> `after_onboarded` (`companion.rs:668`) raises Main and docks her to its right edge.
- "Later (Esc)": `machine.ts:413-416` sets mode auto; `onboarded` stays false; Main stays hidden. Her ledger has no control that opens Main (her capability, `capabilities/athena.json`, has no layout or Main command). Only the tray "Show Main window" (`tray.rs:46-50`) does. The next launch repeats the welcome.
- Card: `run.ts` cards -> `live.tsx:127` -> `cardsChanged` -> machine -> `Slip` (`views.tsx:171-264`). Answer: click/A/D/chord -> `decide` -> effect `answer` (`runtime.ts:93-107`) -> `run.answer` (`run.ts:370`).
- Pill: `athena_report` (`companion.rs:613`) -> `announce` -> `athena:status` -> `useAthena` -> `pillText` (`athena.ts:313-317`) -> `ModuleBar` button (`ModuleBar.tsx:241-252`) -> `athenaShow` (`app.tsx:78`).

## Reachability for this character
Reachable cold: welcome, Later, Open your first app, Main's Browser module, her seal and ledger (Talk, Record, Origins), the tray menu, `Ctrl+Shift+Space`, the pill.
Needs an environment: the decision card (a real GATED turn through the user's own Claude CLI on a registered origin; the composer is blocked with "Open a page first" until an origin is focused, `model.ts:543-548`), the global approve/decline chords (cards > 0), the mic (voice backend), the Codex arm.
`unreachable` for this character: the voice stamp (`by: "voice"` is never dispatched, only drawn at `drawing.tsx:116`; known gap), a docked tab on a second monitor (needs hardware), 125/150% placement.

## Walk
### J1
1. First sight (criterion 1). Housing, a seal, "Athena is here." and: "She works inside the web apps you already have open. She reads one page, decides, acts in another, and asks before anything that cannot be undone." The stamp reads ASKS FIRST / THEN SHE ACTS. The idea lands in three seconds. The cross-app claim ("acts in another") rests on the brain, which I could not verify from the shell.
2. "Engine: Claude Code. She never asks for a key." with a check icon (`views.tsx:337-340`). The value is `settings.engine`, which defaults to `claude_code` (`settings.ts:68`, `engines.ts:53`) and is never compared to a probe. On a Codex-only machine it still reads Claude Code with a tick. Finding juror-1.
3. "Runs on this machine. No account, no cloud, no telemetry." with a lock icon (`views.tsx:344`). The turn is the user's Claude or Codex CLI, a model call to the vendor, and Connectors reach Gmail and Notion. "No cloud" is the phrase a buyer reads literally. Finding juror-2. "She never asks for a key" is true of the model, but Connectors asks for a Notion token and a Google client secret (`connectors/view.tsx:310,378`).
4. The ladder "0 remembers, 1 acts, 2 native, 3 reaches" (`views.tsx:28-33,154-165`): tier 0 is highlighted; it is static. It matches README section 3.4 and nothing says which tier she is at. Low (juror-13).
5. "Open your first app" opens no app: it shows Main on the Browser module with the Register field (`browser/view.tsx:306-342`, "Register and open", placeholder "invoicing.example.test"). The label promises an app and delivers an empty address box with no sample. Finding juror-4.
6. "Later Esc": see surface model; she is left as a seal with Main hidden. Finding juror-5.
7. Nothing I did not ask for opens: true (Main is hidden, no tab until I register).

### J2
1. Rest: a 92px seal captioned "resting" (`model.ts:249`) that dims at 45 s (`machine.ts:34`). Honest.
2. Put away: only the tray ("Put Athena away", `tray.rs:44`) or closing her window hides her. Her surface has no hide control and the machine's `hide`/`show`/`expand` events are never produced. Esc on the ledger puts away the ledger, not her.
3. Summon: `Ctrl+Shift+Space` (`hotkeys.rs:41`) and tray left-click both call `companion::show`; the pill calls `athenaShow`. Real.
4. The pill lies in four states (reproduction above). The most visible: docked as a `tab`, resting, it reads "Athena is working". Finding juror-3.
5. Main close: the button's label is "Close Main window. Athena stays." (`app.tsx:133`). `lib.rs:303-305` calls `handle.exit(0)` on CloseRequested, which ends both windows and the daemon. The label is false. Finding juror-6.
6. Identity (criterion 2): titles are all "Athena" (`lib.rs:282`, `companion.rs:415`, `tray.rs:56`). Marks differ: Main bar `StampMark` (primary field `#06b6d4`, cut `--recessed`), her `Mark` (`--house-glow #22d3ee`, hard-coded cut `#081417` at `views.tsx:60`), and the tray/taskbar icon (flat "A"). The tray dot `#f472b6` is hard-coded (`tray.rs:16`) and equals the dark `--role-human`; the light theme's is `#9d174d` (`app.css:112`). Finding juror-7.
7. Pin defaults on (`machine.ts:149`, `companion.rs:422`) while the only pin control is inside the ledger. Consistent.

### J3
1. Card content: action name, GATED chip, rationale, every param verbatim and uncut (`views.tsx:190-213`, `model.ts:330-348`). Strength. But `CardView` carries no origin or app (`model.ts:90-97`), so a card never says which app it would act in, and "recipient" exists only if a param is named so. Finding juror-8.
2. Strongest moment (criterion 3): the slip is 488x316 with a stamp drawn from SVG with an ink-bleed filter (`drawing.tsx:100-133`). Whether it is the visually strongest is an L2 question. The `Sketch` thumbnail is labelled "page capture, stylised" and only fixtures use it (`cardView` sets `capture: null`, `model.ts:336`): honest, and absent live. Strength.
3. Answer: A, D, click, chord. The stamp shows APPROVED / COUNTERSIGNED BY YOU at once and the screen reader hears "Approved. Stamped and sent to the record." (`machine.ts:293-298`) before `run.answer` has spoken to the daemon. `run.answer` removes the card first (`run.ts:373-375`); on a failed resolve `fail` only sets `error`, shown on the Talk tab (`run.ts:376-384`). The Record tab already lists the decision as "approved" (`runtime.ts:93-99`). Finding juror-9.
4. Mic button: disabled, the reason is a hover title (`views.tsx:226`). Honest but a keyboard or low-vision user never sees it. Finding juror-10.
5. Record tab: "Every call, by app and gate class. Nothing is missing from this list." (`views.tsx:491`) while the first list is this session's transcript, this window only, and the footer "(showing N of N)" is a tautology (`views.tsx:515`). Restart empties it. Finding juror-11.
6. Origins tab: "None yet. A page's tools are off until you say otherwise." is true (origins default off). Strength.
7. Reaching a card in 2 minutes (criterion 3): welcome -> Open -> type an address and Register (the example host must already run) -> click the seal -> type a message that causes a GATED proposal -> wait for the engine. The product offers no sample app or sample prompt, and its suggestions exclude GATED tools on purpose (`model.ts:514-520`), so no suggestion leads to a card. Finding juror-12.

## Candid review (first person)
What is different? She is not a chat box. The drawn seal, the paper slip and the stamp are real craft, and the one idea, "asks before it acts", is on the first screen, in the stamp, before I read a word. I would remember it.

Show me it is real, not a video. Here I stop. The first three claims I read are not wired: the engine is a default with a tick beside it, "no cloud" sits next to a model call, and the button that says "Open your first app" opens a blank address field. Then I park her at the screen edge and the pill in Main says "Athena is working" while she sleeps. I close Main on the strength of a label that says "Athena stays", and she dies. Each is small. Together they are what a juror writes down as "claims do not hold".

What is missing for my job: a sample the product offers me (a demo origin, a first prompt that reaches the card in ninety seconds), and honesty when something fails after the stamp.

Would I adopt it? As an entry I would score taste and original shape high and trust lower. Would I tell a peer? Yes: "look at the decision card, ignore the welcome copy until they fix it."
