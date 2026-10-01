# Recertify (partial, live): backlog wave 1 against run 2026-10-01-r1

Commit under test: working tree on top of ac1488a (nothing committed). Real WebView2 window, debug build rebuilt for this run, fresh store,
Claude Code engine. Journals: `R2-*.journal.json`. This is a targeted pass on the items that were confirmed live in r1, not a re-sweep.

| backlog | r1 finding | r2 live result | resolution | ceiling |
|---|---|---|---|---|
| B1 | mira-4, jonas-6, juror-9, mira-5 | Approve with focus on another app: card kept, refusal in plain words ("this decision belongs to a different app ..."), no "Approved", daemon still pending, nothing sent. The decision orphaned in r1 (`apr_23e30fb6cf68`) was shown as a card on a fresh start. Decline on the right tab then succeeded: "Declined. Nothing was sent.", daemon pending 0. | **resolved-verified** | Found and fixed one more defect in this pass: a decision restored from a previous daemon process was refused even on the right tab (no session until a turn registers the page); `run.answer` now registers the focused page first (test added). Approve-by-keyboard on the happy path was not run. |
| B2 | jonas-1, mira-11 | With the app switched off, the turn's capability list held only the 3 core tools and the model reported it could not see any Ledgerbox tools (r1: it described them as available). | **resolved-verified** (prompt side) | The gate refusing a call the model makes anyway is covered by unit and HTTP tests (agent A), not driven live. The model's wording is its own, not Athena's; the UI does not yet say "you switched this app off". |
| B3 | mira-6, jonas-11, juror-6, priya-12 | Close button reads "Close Athena". | **partial** | Behaviour unchanged (still quits both windows, by decision). The in-place "a decision is waiting, close anyway?" bar was not clicked through. |
| B4 | priya-1, mira-9 | Welcome: "Engine: Claude Code, ready." from a real probe; Setup: "Claude Code 2.1.286" with an engine Check again; no "probe/PATH/daemon" words. | **resolved-verified** for the found arm | The claude-absent and signed-out arms were not built (host CLI cannot be renamed). The remedy sentences are unit-tested only. |
| B5 | priya-5, juror-4 | Browser on first run asks "Type the address of an app you use ... Press Enter to open it." with the engine state under it. | **partial** | "Open your first app" still opens Main without an app; the user types the address. The "Later" way back was not driven. |
| B7 | uat-1 | `lib/time.ts` reads stamps as UTC; 6 + 1 tests across four time zones. | **fixed** (not live) | Not re-observed in the window: that needs a row written and read in a non-UTC host zone. This host is UTC+2, so the r1 symptom would show; it was not re-checked. |
| B6, B8, B12, B13 | various | not re-driven live in this pass | **fixed, unverified live** | Unit and view tests pass (TypeScript 267, Python, Rust 99). |
| B9, B10 | ana-1, mira-2, ana-10 | Rust arrival policy: `athena_show {focus:false}` left the foreground unchanged and a default show took it (agent D, real window). The page now calls it with focus:false on arrival while put away; a chord from a put-away or snoozed state shows the slip and waits for a second press. | **partial** | A card arriving while put away was still not driven (needs M1, a scripted engine). Main sizing at 1080p/150% not measured. |
| B11 | uat-3 | ledgerbox tools accept id or number (agent E, 34 tests). | **fixed** (not live) | Not re-run through a model turn. |

## New findings for the next drain

- **uat-5 (fixed in this pass):** a decision restored after a daemon restart could not be answered on the right tab, because the daemon only learns a page's manifest from a turn. Fixed by registering the page before answering; test added; live decline succeeded.
- **uat-6:** with an app switched off the user is not told, in Athena's own words, that this is why she has no tools there; the explanation comes only from the model. A plain line on the Talk tab ("You told Athena not to act on this app.") would close it. Hypothesis: the daemon could return the omitted origins with the turn.
- **uat-7:** my own checks were again too literal in two places (matched recalled tool names in a reply). Driver hygiene (M4) stands.
