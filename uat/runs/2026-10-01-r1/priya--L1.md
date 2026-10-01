# priya - L1 (code only; app not launched)

Journeys: **J1 first launch: L1-fail. J5 workday in Main: L1-conditional.**
Findings: `priya.findings.json` (12 entries: 10 gaps, 2 strengths).

## Surface model (control -> handler -> store/IPC -> Rust/daemon)
- Welcome (athena.html): `Welcome` views.tsx:325 -> `actions.open` live.tsx:254 -> machine `open` machine.ts:413 -> effect `onboard` live.tsx:72 -> `settings.setOnboarded(true)` settings.ts:100 -> `store.rs:943` -> `companion::after_onboarded` companion.rs:668 (Main raised on Browser). `Later` (Esc) machine.ts:413-415: mode auto, Main stays hidden (Main is built `visible(!first_launch)`, lib.rs:279).
- Engine line on welcome: `engineLabel(useSettings.engine)` live.tsx:281 -> views.tsx:339. No probe involved.
- Engine probe: Python `probe()` engines.py:73 (good, never raises) -> **no daemon route, no IPC command** -> Setup `Live` hard-codes `probes: null` (setup/index.ts:85). The comment at index.ts:6-8 says as much ("nothing in the shell asks the daemon for one yet").
- Setup module reachable from the Main bar only; Main is hidden on first launch and, after the welcome, `onboarded` is already true so Setup renders **settings**, not the onboarding letter (model.ts:125).

## Reachability
- First launch: only the welcome seal is visible. Reachable for Priya: welcome, Open, Later, seal, tray. After Open: Main (Browser module), Setup/Connectors tabs.
- Onboarding letter (setup/view.tsx:62): `unreachable` on the first-run path; only through "Show the welcome again" (view.tsx:181).
- Every non-found engine sentence (remedyFor, engineLead, disabledReason, the 'not_found' pill lock): `unreachable` live; reachable only in the preview fixtures (setup/fixtures.ts).
- After Later: Main reachable only via tray "Show Main window" (tray.rs:40).

## Codex-only arm, what words reach the screen
Machine: codex present, claude absent. Python probe_all would say `claude_code available False 'claude is not on PATH'` and codex True (run here with the real probe: both True on this host; with a missing binary: 'X is not on PATH'). None of it reaches the UI:
1. Welcome: green check, "Engine: Claude Code. She never asks for a key." (false for her).
2. Main > Setup: engine row "Claude Code is stored; the probe has not answered yet." Both pills choosable. Start button disabled with "The engine probe has not answered yet." forever; "Skip for now" works.
3. Choosing Codex is allowed and writes the row; "Restart on Codex" appears if daemon is up (only because daemon health is separate).
4. First message: Talk tab, "The turn stopped / `engine_error` FileNotFoundError: ..." or tape "stopped / engine_error: ...". Error code and exception text, no fix.
If the wire existed the text would be: "Install it, or put `claude` on the PATH, and probe again." Still developer words (PATH, probe) and no "check again" button.

## Wiring audit
- `probes`: declared in 3 files (model, readiness, view; ~20 reads) and **1 live producer = null literal**. Live ratio 0 / 1.
- `daemon.lastError`: 1 declaration, 1 write, **0 view reads**.
- Welcome `model.welcome.engine`: 1 declaration, 1 use (views.tsx:339), fed from a settings default, never from a probe.
- `Fact.key` set for engine/page/brain/mic/voice, all rendered. `disabledReason` on engine pills only when `not_found` which cannot occur live.
- No orphaned module found among Browser, Connectors, Setup; Setup's onboarding branch is orphaned in practice (priya-5).

## Grounding (the turn), six canonical sources
(1) page tools: `capabilities` block (prompt.py:258) yes. (2) focused page's origin: `frame.host_state` untrusted fence (prompt.py:305-331) yes. (3) user's message: history in cli_harness `_request` yes. (4) project: `frame.project` prompt.py:363 yes. (5) brain fact: `recall.*` blocks prompt.py:271 yes. (6) gate class: carried through the catalog capabilities block, read not re-verified line by line. Score 6/6 by design, none verified live; no segment addition. The turn is irrelevant to Priya until an engine runs, which is the gap.

## Walk, scored criteria
1. One sentence, no jargon: **partial**. "She works inside the web apps you already have open ... asks before anything that cannot be undone." is good. Ladder "remembers/acts/native/reaches" and "First launch" eyebrow are unexplained.
2. Missing engine named with a fix in plain words: **fail** (priya-1, -2, -4). Not reported at all.
3. "Check again": **fail** for the engine (priya-3); exists only for the microphone (setup/view.tsx:470).
4. Reaches first app without docs: **conditional**. Browser has a large field "invoicing.example.test" and "Register and open" (browser/view.tsx:152-155, 320-340). But "Open your first app" opens an empty Browser, not an app.
5. No internal vocabulary required: **pass to proceed, fail to read** (daemon, origin, hands, bridge appear on screens she passes; priya-8).

J5 branches: status pill / tool pill / Close all enumerated. Tool pill states `tools` pending, `no bridge`, `N tools` all legible. Close says "Athena stays" but lib.rs:301-303 quits the app (priya-12). Connectors offline says `daemon_offline` (jargon).

Commands run: `uv run python` probe with a missing executable (outputs quoted above); greps for `probes:`, `lastError`, `Check again`, `engine_unavailable`. Did not run vitest: no claim here rests on a reducer outcome I did not read directly (machine.ts branches `open`, `later`, `seal`, `esc` read in full).

## Time saved
Designed experience (if the probe were wired): about 15 min saved on first-help-with-invoicing vs her 30 manual, confidence low-medium. As built for a Codex-only user: **negative**, roughly 10 min lost debugging a failed first turn she cannot read, confidence medium.

## In my words
I would like this app. The first screen says "Athena is here" and that she works inside the web apps I already have open, and that she asks before anything that cannot be undone. I understood that. Then it told me, with a green tick, that my engine is Claude Code. I pay for ChatGPT. I do not have Claude Code. Nobody asked me.

I pressed "Open your first app" and got a big empty page with a box that suggests "invoicing.example.test". That part is fine, I know my invoicing site's address. But I never saw anything telling me whether she could actually think on my machine, and when I typed a question the answer was a red box with `engine_error` and some words about a file not found. I do not know what that means and I would close it. There is a "Check again" on the microphone, which I did not ask about, and none for the thing that is actually broken.

What frustrated me: words like daemon, origin, hands, bridge. Pressing Later left me with a tiny round seal and no hint how to get the big window back. Closing the window says "Athena stays" and then she does not.

What is missing for my job: one plain sentence "I could not find ChatGPT's Codex on this computer; install it from here, then press Check again", and a button that works. I would not tell a peer yet. After that fix I would, because the rest of the idea is kind and clear.
