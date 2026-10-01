# UAT run 2026-10-01-r1 - Athena Portable desktop (commit ac1488a)

Five Characters (mira, jonas, priya, ana, juror), five journeys, L1 theoretical for all, L2 live (real WebView2 window,
debug build, throwaway store, real Claude Code engine) for the driveable subset. No panel, no LLM judge. 99 finding rows:
84 defects (23 **confirmed live**, 61 still L1-only) and 15 strengths. `findings.json` is the record; per-Character reports
are `<id>--L1.md`; L2 journals are `L2-*.journal.json`.

## Scorecard

| Journey | L1 | L2 | What decided it |
|---|---|---|---|
| J1 first launch | priya L1-fail, mira/juror conditional | **partial** | exactly one 488x432 window, onboarding persists (strengths); but "Open your first app" opens no app and Setup never shows the engine |
| J2 live with her | conditional (ana: conditional) | **partial** | run loop survives a hide (strength); pill says "working" at rest in the ledger; focus-on-arrival arm NOT exercised |
| J3 decide a card | mira L1-fail, jonas/ana/juror conditional | **conditional, with a critical trust bug** | the slip is right and one key answers it; but a refused approval is stamped "Approved" and the decision is orphaned |
| J4 trust and record | jonas L1-fail | **fail** | per-app Switch off is cosmetic; Record contradicts itself and cannot say which site |
| J5 workday in Main | conditional / ana fail | **conditional** | "Athena stays" quits the app; times shown in UTC as local |

**Time saved (as built, live):** the flagship chore (one overdue reminder) took ~9.5 min wall and ~$1.60 of model calls on the first
real attempt, against Mira's 45 min for ~37 invoices by hand. Once a draft existed the card arrived in 12 s. Per-card cost is
fine; the **first-card cost is not**, and there is no batch. L1 estimates (5-28 min saved) all hold only if the card can be trusted
and the first step does not need two corrections. Confidence low.

## What is confirmed live (impact-ranked; convergence in brackets)

1. **A refused approval is reported as approved and the decision is lost** (mira-4, jonas-6, juror-9 + L2). Focus on another origin, press
   Approve: the screen shows `THE TURN STOPPED foreign_origin ...` and `Approved. Stamped and sent to the record.` together, the card
   disappears, and the daemon still holds the approval pending (`apr_23e30fb6cf68`, a `send_reminder`) with nothing on screen to answer it,
   before and after a restart (mira-5). *Highest trust erosion in the run.*
2. **The per-app "Switch off" does not switch anything off** (jonas-1, mira-11 + L2). The store says `enabled:false`; a turn on that origin
   still ran and described the page's tools. Browser says "nothing runs here".
3. **Closing Main quits the whole app, under a button that says "Athena stays"** (mira-6, jonas-11, juror-6, priya-12; four Characters + L2).
4. **The engine probe never reaches the screen** (priya-1, mira-9 + L2): Setup says "the probe has not answered yet" on a host where
   Claude Code answers. The welcome ticks "Engine: Claude Code" from a stored default (priya-2/juror-1: what a MISSING engine shows is unproven).
5. **The card the user signs omits what is signed** (mira-1, jonas-7 + L2): one parameter (`ID inv_0029`); the recipient's name appears only
   in the model's rationale sentence, the address and body not at all. Downgraded from critical because the name and company are present.
6. **"Open your first app" opens no app** and lands on an empty Browser with no word about the engine (priya-5, juror-4 + L2).
7. **The Record contradicts itself** (jonas-5, juror-11 + L2): "Nothing is missing from this list" above "Nothing has run in this window yet";
   rows have time, engine and cost but no site or tool; it cannot answer "what did she do, on which site".
8. **Main's pill says "Athena is working" while she is idle in the ledger** (juror-3 + L2).
9. **New at L2:** times are UTC shown as local ("2 h ago" for seconds ago; Record clock 2 h off) (uat-1); a second tab of the same app breaks turns in
   internal words (uat-2); the first-card path cost 9.5 min through id-versus-number confusion (uat-3); `ATHENA_STORE` does not isolate the brain (uat-4).

## Strengths worth protecting (guardrails for the backlog)

- The slip: GATED chip, action, rationale, parameter, Approve/Decline with keys, "Nothing runs until you sign", and **one key declines** with
  "Declined. Nothing was sent." Any change must keep the card answerable in one key without Main.
- First launch is one window; the second launch skips it and comes up resting. The size table is real: 92x92 and 488x316, 488x432, 488x656 measured.
- Failures are ledgered (turns stopped at the gate are `$0.0000` rows) and cost per round is visible. Keep both.
- The run loop survives a hide (a turn finished while she was put away).
- Type floor is exactly 12px and measured contrast on paper is 4.87:1 or better (L1 arithmetic; the slip's smallest text measured 12px live).

## Honest ceilings and what was NOT proven

- **Not built:** the claude-absent / Codex-only arm (priya's J1), 150% display scaling (ana-10, ana-14), NVDA (ana-2/3), a native drag-to-snap or
  dock (pill while docked), a microphone or voice backend. These stay `uncertain` with the fixture each needs in `L2-PREFLIGHT.md`.
- **Focus theft on arrival while put away (mira-2, ana-1, the top L1 convergence) is UNPROVEN.** Two live attempts were void (Windows would not
  let Notepad take the foreground; the second turn was refused for focus on a manifest-less tab). The turn did complete while hidden, but no card
  arrived while she was hidden. It needs a scripted engine to produce a card on cue.
- **No Approve-by-keyboard happy path was run** (only decline); nothing was sent anywhere. The one pending approval from the refused Approve was
  left in the throwaway store.
- Everything is one model, one host, one display, a few real turns. Latency and cost are single samples.

## Panel verdict (the voices, L1, adding up)

*"She is the right object and the wrong promise."* The slip, the seal and the one-key answer are what a stranger remembers and what Mira would
keep. What would make Jonas and Priya refuse it is not looks: several controls say something the product does not do ("Athena stays", "switched
off", "Approved", "the probe", "Nothing is missing"), and the one place a user signs something carries the least information. Four of five
Characters said a version of: *a tool that claims a protection it does not give is worse than a missing feature.*

## Methodology lessons (fold into the skill or the overlay)

- **A passing `expect()` can be vacuous and a failing one can be mine.** More than a dozen of my checks were void and are not counted anywhere above: two matched
  the word "off" inside the "Switch off" button; two were a wrong state predicate (`slip` while the card was inline in the open ledger); one read a
  401 response as "no pending decisions"; one read the wrong JSON key; four ran with a false precondition after my own cleanup called `athena_show`.
  Rule for the driver: assert the precondition and print it; never treat a 401/empty result as a pass; never clean up with an action that changes the
  state under test.
- **Page webviews are not CDP targets of the shell's chrome session** (`pages()` listed only chrome and athena). A browsed tab's DOM is reachable only
  through the shell's own commands (`tabs_list`, `bridge_call`). `env.md` said otherwise; corrected.
- **L1 convergence predicted L2 well:** all 19 L1 findings I could drive live were confirmed (none refuted); the
  one that moved was severity (mira-1 critical to high). Most were high or critical at L1. The two converged ones that were not provable (focus theft, 150%) were environment arms, not
  refutations.
- **The fixture I trusted was wrong:** the README's demo ids (INV-118) do not exist in the example app (`LB-2026-xxxx`, ids `inv_xxxx`). Two of my first
  real turns were spent on that. `env.md` now names real ids.
- **A real-engine L2 is minutes per turn, not seconds.** Budget it, and prefer a scripted-engine path (the daemon has `--transcript`; the shell's sidecar
  launcher does not expose it) for anything that only needs a card on cue.
