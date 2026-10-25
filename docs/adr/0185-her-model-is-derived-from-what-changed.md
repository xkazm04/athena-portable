# 0185. Her model is derived from what changed: an incremental transcript and a sliced selector

Date: 2026-10-25

## Context

Her window (ADR 0026, README section 3.1) derived its whole model from scratch on every render,
and it rendered on every run-store write: `Live` subscribed to the entire store. A streamed reply
is one transcript entry per delta (`text.delta` pushes one), so every delta walked the whole
session three times (two `buildContext` calls and `translateAll`'s own), re-translated every
message, re-sorted the Record and rebuilt every card. The work per delta grew with the session,
so a session cost the square of its length: her window got slower the longer you talked.

The run store only appends to the transcript (`push` spreads a new array and leaves earlier
entries untouched), except that a late tool answer amends its row in place and Clear empties it.
`buildContext` is a later-wins fold, and its tool-row maps (`byId`, `byEmail`, `drafts`) and its
assistant map (`proposals`) are independent.

## Decision

1. **`companion/memo.ts` holds the incremental derivation; `selectCompanion` stays the plain
   oracle.** `model.ts` splits the selector into `partsOf` (each costly part a named pure
   function: `cardsPart`, `sheetPart`, `tapePart`, `recordPart`, `originsPart`, `welcomePart`)
   and `assembleCompanion`. `selectCompanion(i) = assembleCompanion(i, partsOf(i))`, unchanged in
   output, and still what fixtures, tests and the preview use.
2. **The transcript cache folds one entry at a time.** A new entry's own context
   (`buildContext([entry])`) is laid over the running one; the context is copy-on-write, so the
   turn handed out is the same object while no entry changes it. Messages are translated against
   the merged transcript (a run of deltas is one message), whose proposals are read from the
   joined text and kept apart from the raw ones. When the context a message reads is unchanged,
   only the new or merged tail is translated and every earlier message is the same object; when
   it changed (a new contact, a new proposal) every message is translated again. A transcript that
   is not an extension of the cached one (identity checked entry by entry) is rebuilt whole.
3. **`createCompanionSelector()` keeps each part while the inputs it reads hold still.** It has
   the signature of `selectCompanion` (`(inputs: CompanionInputs) => CompanionModel`), which is
   the public shape a later change calls. **A part that starts reading a new input must add that
   input to its keys in `memo.ts`**: the keys are written beside each part, and the doc comment
   on each `*Part` names what it reads.
4. **Live subscribes to a shallow pick.** `pickRun` names the run fields the model and Live read;
   `stableSlice` returns the last pick while the new one is shallow-equal, so a write to any other
   field (`continuations`, `captureNow`, ...) does not render her. Store methods are read through
   `getState()` in her actions. The tool rows, drifts, trust table and origin views are memoized on
   the store values they read. No zustand helper is imported, so nothing is added to any other
   entry's bundle.

## Consequences

- A streamed delta that proposes nothing costs one context fold, one tail translation and one
  identity scan of the transcript (pointer comparisons, no parsing). The cards, the Record, the
  Origins tab and the welcome are the same objects they were. A tool row that names new records
  still re-translates the session once, which is per tool call, not per delta.
- The net for a part that misses an input is `memo.test.ts`: on every fixture's inputs and at
  every step of a scripted 60-step session (deltas, tool rows, a recovered failure, cards, a
  stamp, a Clear, an amended row) the memoized model deep-equals `selectCompanion`'s. A key
  dropped from the cards, tape or origins part fails it (checked by mutation when written).
- `stepsOfTurn` and the "last thing the person said" are still found by a scan each call; both
  are cheap reads, not parses, and their result is kept by identity so the tape holds still.
- Reverting `live.tsx` to `selectCompanion` and `useRun()` restores the plain path exactly;
  `memo.ts` is additive.
