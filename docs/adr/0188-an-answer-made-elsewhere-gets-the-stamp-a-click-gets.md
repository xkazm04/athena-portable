# 0188. An answer made by voice or on a paired device gets the stamp a click gets, and lands on the Record

Date: 2026-10-25

## Context

Her slip (ADR 0026, README section 3.1) confirms an answer with one path: `decide` sends it,
`sent` stamps it, the slip tears at 900ms and she settles at 1500ms, and a screen reader hears
"Approved. Stamped and sent to the record." That path is reached only from her own buttons, keys
and chord. A card answered anywhere else left her window with nothing: a spoken "approve"
(ADR 0027) and an answer on a paired phone (ADR 0140) drop the card from the run store, the runtime
handed the machine only a lower count, the slip unmounted mid-read and nothing was said. The
machine's `By` already named `voice`, but no production code dispatched it. A spoken answer was
also never written to `useRun.answered`, so the Record's "This window" list left it out while its
header claimed nothing was missing.

`docs/BACKLOG.md` declined "Voice-answered cards get a stamp" because there was no voice backend,
and set its re-entry condition: "Re-enters with a backend." That condition is met:
`src/athena/channels/voice` decides a spoken answer itself and sends `decision.resolved` (by
`user`) only for an answer it made, and `stores/voice.ts` receives it. This ADR takes that item up.

## Decision

1. **One stamp path, entered from outside.** The machine gains `resolved {kind, by, where?}`: the
   daemon already has the answer, so the stamp plays with `sending: false` and no `answer` effect,
   and tears and settles on the click's timings. It plays only while the slip is the drawn form;
   put away, snoozed or hidden, she says one sentence ("A decision was approved on Pixel 8.") and
   no slip opens, so an answer on the phone never pops a slip over the person's work. `By` gains
   `peer`, and `Decided` an optional `where` (the device as the peer names itself).
2. **Her own answer wins a race.** `resolved` is ignored while `decided` is set: a click in flight
   and a spoken answer to the same card end in one stamp, the click's, with no second sentence.
3. **The runtime notices which card left.** It keeps the card that headed the stack at the last
   applied change. When that card is gone and she has no `decided` of her own, it asks a new
   optional dep, `departed(id)`. With an answer it holds the card (so the stamp lands on it) and
   dispatches `resolved`; with `null` (expired, reconciled away) it dispatches `gone`, which says
   "That decision is no longer waiting." over an open slip. Without the dep a departure is a lower
   count, as before, which keeps every existing harness unchanged.
4. **`answered` carries how.** `AnsweredDecision.via` is `"voice"` or the peer's name, absent for
   her own answers. `stores/voice.ts` writes the spoken answer's row in the same write that drops
   the card; `remoteDecided` sets `via` to `peer_name`. Both build the row with
   `answeredElsewhere` (stores/run.ts). `live.tsx` answers `departed` from rows with a `via` only,
   so her own answers can never come back as a departure.
5. **The Record says how.** `SessionDecision.via` reaches `decisionRow`, whose result reads
   "approved by voice" or "approved on Pixel 8"; a row with no `via` reads as before.

## Consequences

- Every way of answering ends in the same visible and spoken confirmation: 5 of 5 paths (click,
  key, chord, voice, phone) instead of 3 of 5, and spoken answers are on the Record.
- The first-paint ratchet carries the store half (run.ts and voice.ts ship in the first frame):
  165,356 to 165,410 gzipped bytes against the 165,412 ceiling. The row builder takes a `Date`, not
  a stamp, so `remoteDecided` passes `deps.now?.()` and the default is the wall clock.
- `pages.tsx` uses the Record row's result as a class suffix (`rec-${row.result}`), so a
  multi-word result adds stray class tokens next to `rec-approved`; the styling still matches.
  Giving the row a separate `via` field for the view is a follow-up for the surfaces context.
- Only the head card's departure is stamped or announced; a card further down the stack that is
  answered elsewhere still leaves silently, as the count already shows.
