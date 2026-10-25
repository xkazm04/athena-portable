# 0205. An act is logged by who ran it, and its class is the manifest's

Date: 2026-10-25

Closes the `actor` consequence of ADR 0111. Builds on ADR 0018 (scratch example hosts) and
ADR 0107 (`examples/hirelane/lib/acts.ts`). Parity with `examples/ledgerbox/app/actions.ts`,
which already threads a validated actor.

## Context

Hirelane's agent tools (`components/HostCapabilities.tsx`) call the same server actions as the
person's buttons. Every action wrote its activity row with `actor: "user"`, and `writeStage` wrote
`stage_events.actor` as the SQL literal `'user'`, so a move Athena ran unattended and a click by
the person left identical rows. ADR 0111 shipped the dossier's History band knowing this and chose
to print no actor rather than a wrong one, although the band's stated purpose is letting the
reader find what the agent did.

Separately, each of the seven call sites typed `reversible: true/false` by hand beside
`lib/manifest.ts`'s `isAuto`, which already decides the same class. An AUTO act that forgot its
undo, or a GATED send that logged one (and so drew an Undo on something that reached a person),
was caught only by two tests that each hand-list three names.

## Decision

1. **One chokepoint.** `app/commit.ts` exports `commitAct(tx, {capability, actor, target, summary,
   undo?})`, the only way an action writes its activity row. It looks the capability up on the
   manifest, sets `reversible = isAuto(capability)`, and throws inside the caller's transaction
   when an AUTO act has no undo ("X is AUTO and must log its undo") or a GATED act has one ("X is
   GATED and logs no undo"), so the enclosing `withTx` writes nothing.
2. **A closed actor set, threaded explicitly.** Every action takes a trailing `actor`, `"user"` by
   default, refused before any write unless it is `user` or `athena`. `writeStage` writes it to
   `stage_events`. `HostCapabilities.tsx` passes `"athena"`. `system` stays the seed's.
3. **The undo payload is a type.** `Undo` (`note | stage | slots`) is exported from `commit.ts` and
   `applyUndo` switches over it exhaustively instead of casting.
4. **The History band names who acted.** `applicantHistory` selects the actor, `BdHistoryRow`
   carries `by`, `historyRow` maps it ("Athena", "You", "Hirelane"), and each row reads
   "Athena - Ada Lin: Applied to Screening."

## Consequences

- The actor is caller-supplied, so a page could claim to be Athena. That is acceptable in a
  scratch example host (ADR 0018), where the band is a courtesy and not an audit; ledgerbox made
  the same call.
- Undo rows written by the kit's `undoActivity` still say `user`: only the person's Undo reaches
  it, and the agent has no undo tool.
- A new data capability on the manifest fails `test/commit.test.ts` case 5 until it has a runner,
  and its row's class comes from the manifest with nothing to type.
- No schema change: the CHECKs on `activity.actor` and `stage_events.actor` already admit
  `athena`. Rollback is a `git revert`; the argument is optional and trailing, so reverting
  `HostCapabilities.tsx` alone restores `user` rows.
