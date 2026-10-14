# 0087. Main is one scene with depths, and Fathom is the chosen design

## Context

Main is a 36 px module bar over one of five full-width modules, plus her own window. A newcomer
has to learn five tabs and a vocabulary before the first useful thing happens. The
`athena-console` design contest (two seats, three variants each, no judge panel, owner review)
asked whether the complexity could be separated into layers instead of tabs. The owner chose
variant A/1, "Fathom", for the quality of its animation and transitions and for how fast and
alive it felt.

## Decision

Main is redesigned as one scene. The surface is Athena as a drawn, animated bell with a tendril
per app or account she may touch. The five modules become depths below it (Apps, Chores,
Accounts, Voice, Mind), each able to nest one or two levels deeper; Escape rises one level, and a
breadcrumb, a Rise button, a depth gauge and a dock are always visible. Setup is the first act of
the same scene. The plan, the phases and the parity matrix are in `docs/redesign/`.

The contest source is **reference only** and is kept under `docs/redesign/reference/fathom/`. The
port is written from the module contract (model, fixtures, pure view, index), not from it. The
modules' models, selectors, fixtures and tests are kept; their views are replaced. The module bar
and the old views stay live until the cutover phase so every commit leaves a working app.

## Consequences

- No capability may be lost: `docs/redesign/parity.md` lists every one, and a phase is not done
  until its rows carry a proof.
- The palette is the app's own tokens; the contest's literal hex values are replaced by variables.
  The contest cut the light theme, the port keeps it.
- ADR 0088 decides how the scene coexists with the native page rectangle, ADR 0089 the motion and
  performance rules.
- Where she talks (Main versus her own window) is not decided here. The default keeps ADR 0026
  unchanged: Main mirrors her and hands text to her window. Hosting the conversation in Main would
  need its own ADR.
