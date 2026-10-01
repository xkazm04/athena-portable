# L1 brief (shared). No orchestrator leads are included on purpose: derive everything from the code.

You are one Character walking Athena Portable theoretically (UAT level L1: code only, NO browser, do not launch the app).
Read first: uat/README.md, uat/rubric.md, uat/env.md, uat/accepted-gaps.md, your character file, your journeys,
docs/adr/0026-athena-is-her-own-window-and-main-is-the-workhorse.md, AGENTS.md, README.md sections 1-3.

Product under test: the Tauri desktop app in apps/desktop (src/ TypeScript, src-tauri/src Rust). Two windows: Main
(chrome webview + page webviews; modules in src/modules) and the Athena companion (src/companion, athena.html,
src-tauri/src/companion.rs, tray.rs, hotkeys.rs). Surface bindings are in your character file.

Do, in order:
1. SURFACE MODEL for the surfaces your journeys touch: follow the actual import chain from each affordance to the code that backs it
   (control -> handler -> store/IPC command -> Rust or daemon). Cite file:line for every affordance and gap.
2. REACHABILITY: which of those surfaces can THIS character actually open (first launch hides Main; docked/hidden states;
   engine presence; origin enabled or not). Tag anything outside it `unreachable`.
3. WIRING AUDIT: for every value computed for a user-facing surface (Rust events, store fields, view-model fields), grep that its
   name reaches a view. 0 hits is a finding. Also orphaned modules/components and dead flags. Report declarations vs. uses as a ratio.
4. GROUNDING AUDIT of the turn (the AI surface): score the six canonical sources in uat/rubric.md and name any addition.
5. WALK each journey in character with the rubric questions and your SCORED CRITERIA, identically to how a re-run would. EXECUTE, DON'T EYEBALL:
   when a claim rests on a regex, a reducer branch, a size table or a contrast ratio, run it (vitest, node, python) and cite the reproduction.
   Enumerate EVERY branch of a shared mapping (e.g. all companion states, all snap kinds) and say which are clean.
6. ESTIMATE time saved (minutes, with confidence) for the designed experience.

Write, under uat/runs/2026-10-01-r1/ (do not touch anything else in the repo; do not run git):
- `<id>--L1.md`: per-journey verdict (L1-pass | L1-conditional | L1-fail), the grounding score, time-saved, the wiring ratio, then a candid
  FIRST-PERSON review in your Voice (would I adopt it, what frustrated me, what is missing for MY job, would I tell a peer).
- `<id>.findings.json`: a JSON array of findings: { id (prefix with your id, e.g. mira-1), journey, character, cert_level:"L1", type, severity,
  impact:{frequency,reachability,trust_erosion}, dimension, title, expected, got, evidence:["file:line"], code_check, verdict:"uncertain",
  resolution:"open", ceiling:null, recurrence:1, suggested_acceptance, l2_priority (what L2 must verify live, WITH its environment precondition) }.
  Strength findings are allowed (type "strength"). No finding without file:line evidence. Severity is derived from impact.
Be adversarial about your own findings: read the code twice before claiming something is missing. Return a 10-line summary.
