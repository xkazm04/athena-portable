# Rubric

Seven dimensions per journey: **completion** (can I finish the job), **effort** (steps and detours),
**clarity** (do I know where I am and what she is doing), **trust** (would I let her act; is the gate
visible), **missing** (what the job needs that is absent), **time-saved** (minutes vs the Character's
manual way), **senior-quality** (is the output/decision card what a senior in my role would accept).

Cognitive-walkthrough questions per step: will the user try to achieve the right effect? will they see the
control? will they connect the control to the effect? will they see progress afterwards?

Impact = frequency x reachability x trust_erosion (low|med|high each). Rank by impact, not the severity word.
Finding types: missing-feature | quality-gap | broken-flow | confusion | trust.

Desktop-specific lens (this is not a web app): the window is lived beside other apps for hours; she is
looked past most of the day and looked at for ten seconds when a card arrives; every action has a keyboard
path; nothing readable under 12px; both themes; 100/125/150% scaling; 900x600 to 2560x1440.

**Canonical grounding list (shared denominator for the AI surface, the turn):** (1) the page's own tools,
(2) the focused page's origin, (3) the user's message, (4) the project, (5) a prior fact from the brain,
(6) the gate class of each tool. Score every Character against these six; segment additions are named,
never a new denominator.
**Unit of every count:** a count of "windows" means OS-level windows; "states" means the named companion states
in ADR 0026; "modules" means entries in `src/modules/registry.ts`.

## Chores: honesty and comprehension units

Shared units for J7 and J8 and the chores cast (`uat/chores/pairs.json`); every walker and judge counts with these.

- **NUMBER.** Any figure rendered on a chores surface (catalogue, topic page, studio, practice result, Due,
  Runs): money, minutes, hours, percentages, counts of items. One rendering is one NUMBER.
- **HONEST NUMBER.** A NUMBER whose source is stated next to it - measured on invented data, the author's
  estimate (with its basis), or your own records - AND which agrees with every other rendering of the same
  quantity. A NUMBER missing either half is dishonest. Count: honest / all NUMBERS seen in the journey.
- **JARGON.** A rendered word from the internal vocabulary list used without an explanation on the same
  screen: bench, benched, exceed the bar, trap, world, rehearsal, lane, slot, persona, brief, draft, card,
  claim, ledger, turn, daemon, session, edge. Count each distinct word once per screen.
  A word that is the chore's own field term in its ordinary sense (a claim in a freight-claims chore, a draft
  of a letter the person asked for) is not JARGON; the same word in Athena's internal sense (a card she files,
  a draft revision of the brief) is.
