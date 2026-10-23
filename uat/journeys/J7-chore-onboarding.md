---
id: J7
title: I find a chore for my problem and make it mine
promotion: discovery
characters: the chores cast, see uat/chores/pairs.json
level: LC+L1
---
# J7 - Chore onboarding

**Goal.** I found a chore that matches my problem, understood what it does and what it will cost or save me,
and told Athena about my case in a short conversation until she had a brief I could approve.

**Definition of done.** From the catalogue I found the chore by my problem, not by its internal name. On its
page I could say in my own words what it does, what it will ask me, and what it will never do without me.
Every money or time figure told me where it came from, and the same figure said the same thing on every screen.
In "Make it yours" she asked me only what she could not read herself, one thing at a time, in words I know, and
within a few minutes showed me a brief that described my case as I would describe it. I approved it knowing
what happens next.

**Surface.** `apps/desktop/src/scenes/chores/` catalogue (`catalogue.tsx`), topic page (`topic.tsx`, `facts.ts`),
the "Make it yours" studio (`scenes/chores/adopt/studio.tsx`, `conversation.tsx`, `casepanel.tsx`, `card.tsx`);
the daemon's adopt session (`src/athena/adopt/session.py`, `prompts.py`, `routes.py`, `chores.py`).
**Character pairs.** Every row of `uat/chores/pairs.json`: the playbook is the chore, the Character plays its user.
**Watch for.** Jargon from the internal vocabulary (`rubric.md`, chores units); a number without its basis, or
two renderings of one quantity that disagree; a question she could have answered from what I already gave her;
asking me for something a person in my position would not know (a code, a form number, a system name); a brief
in her words, not mine; an approval whose consequence is not stated.
