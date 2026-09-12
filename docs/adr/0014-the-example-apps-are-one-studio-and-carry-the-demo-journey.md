# 0014. The example apps are one studio's tabs and carry the demo journey

Date: 2026-09-12

## Context

README §8 lists "any example host app" as a non-goal: real sites are the environment, and a scratch
page proves a claim. That held while the demo was a sketch. The demo now has a script (README §1,
four acts under five minutes) and the script needs three things a real site cannot promise on the
day: a deterministic seed with the defects planted where the story needs them, a tool surface
whose classes are known in advance, and a page that is ours to boot in CI.

The reference repository already had three host apps built for exactly this — Ledgerbox (the
books), Hirelane (the pipeline), Tidycrm (the contact list) — each registering its capabilities on
`document.modelContext` through a shared kit, each shipping without Athena. They were written as
three candidate themes to compare, and they read that way: three products, three seeds that
happened to share a word list, nothing remembered from one tab to the next.

A demo that is three standalone journeys in a row does not show the thing this build exists to
show, which is one user with one agent whose memory survives the tab switch.

## Decision

The three apps move into this repository under `examples/`, together with the kit, and the
non-goal in README §8 is narrowed to "example apps other than the three the demo runs on".

They are rewritten as **one studio's tabs**. `@athena/demo-kit/seed` owns the shared world:
`STUDIO` (Halden Studio, its domain, owner and inbox), the fifteen client companies each with one
billing `contact`, and the named cross-app people and aliases — `KESTREL_APPLICANT`,
`PINEGROVE_ALIAS`, `QUIET_CLIENT`. Every seed reads these; none generates its own version of them.
The threads the journey pulls on are therefore facts of the data, not coincidences of a word list:

- Ledgerbox chases Kestrel Labs in act 1; in act 2 a Kestrel engineer is one of Hirelane's six
  borderline applicants; Tidycrm holds the same person under the same email. Athena may name the
  relationship as context. Nothing in Hirelane can score or move a stage on it.
- Pinegrove Collective pays as `PINEGROVE COOP` on the bank statement (act 1) and is spelled
  `Pinegrove Coop` by some CRM records (act 3). One alias, learned once, cited twice.
- Solstice Partners paid 80% and went quiet. The app exposes the signal; the decision to skip them
  in the chase (act 1) and in the campaign audience (act 3) is Athena's, and it is the same
  decision both times.

Each app keeps its shipped design at the root route and drops its variant directions; the tool
surfaces gain the reads the journey needs and no new gates. Class flags stay derived from the
page's own `reversible` / `side_effects` claims through `gate.js`, exactly as for a real site.

The journey is an automated test, `examples/journey`, that boots the three apps, drives them
through the real bridge in a real Chromium, models the surface's approvals and the two connectors
the demo wants (mail, notes) as in-process fakes with the egress allow-lists README §4 describes,
and asserts the four acts including the cross-app threads. It is the demo's rehearsal, run by a
machine.

## Consequences

- `pnpm typecheck && pnpm lint && pnpm test` now covers four more packages; the journey runs in
  the same gate and needs a Chromium, which the package installs on first run.
- The kit's archived design studies and the CopilotKit layer do not come along; the apps import
  only `db`, `activity`, `seed`, `ui`, `zoom` and `webmcp`.
- Connectors stay out of this repository (README §4). The fakes in the journey are the contract a
  real connector must satisfy at the seam, not a substitute for one; the demo can swap a real
  Gmail in for act 1's sends and the card names it as the thing that will act.
- The apps are demo fixtures. A real site remains the environment the product is judged on, and
  nothing in `src/athena` may import from or special-case an example app.
