# 0217. One mirror reader: the generation minted at issue decides which answer is shown

Date: 2026-10-25

Extends ADR 0140 (Pairing + Devices page) and ADR 0143 (device vitals, her sleep), whose stores each
mirror a daemon list with "the bus is a nudge, the read is the state" and left the read discipline
to each store.

## Context

The two mirrors on the Mind depth read the daemon two different ways. The sleep store had one read
at a time, a nudge mid-read read once more after it (at most three in a row), a reconnect read at
most once per 5 s, and holders were counted - all in module globals no other mirror could reuse.
The devices store had none of it: `load()` had no flight and no ordering, four bus kinds, every bus
reconnect (every 15 s on a quiet stream), every act and the open computer's drawer timer each issued
their own `GET /devices`, and whichever answer landed last was shown. A read issued before a person
answered a pairing request and landing after the act's read put the request back: `stampSeen`
restamped it, so Approve disarmed again, and the wizard flipped from Done back to Approve.
`startDevices` was idempotent, not counted, so the first holder's stop ended the follow for all.

## Decision

1. **`lib/mirror.ts` `createMirror` is the one read discipline**, and both stores read through it.
   It knows nothing of a store: `read` issues one read (or `null` when there is no daemon, having
   said so), `apply` and `onFail` put the outcome in the store.
2. **A generation is minted at issue.** An answer is applied, or its failure told, only while its
   generation is the newest issued. Authority is issue order, not arrival order, so the shown state
   never steps back to an answer older than one already issued.
3. **A bus frame coalesces; an act supersedes.** `load()` joins the flight out and `nudge()` during
   a flight reads once more after it, so a burst of frames costs at most two reads. `refresh()`,
   which every act calls after its request settles, issues a fresh read at once even while one is
   out: the act knows the read out was issued before its change, so that answer is dropped.
4. **A reconnect reads at most once per `rereadMinMs`** (5 s for both), measured from the last read
   issued, and **holders are counted** (`hold()`): the bus is followed once and let go with the last.
   `DevicesDeps.follow` gains the `onConnected` argument the sleep deps already had.

## Consequences

- An answered request, a revoked peer or an old room word can no longer come back from a read that
  was already stale when it was issued; GET /devices while the level is open falls to at most two
  per burst of frames, and no reconnect read within 5 s of a read.
- The sleep store's behaviour is unchanged except that an act's read now supersedes a read that is
  out instead of waiting for it and reading again (one read fewer, the same final state).
- A flight that a refresh superseded is still awaited before the flight settles, so an act's promise
  can wait on the slow read whose answer it will drop; reads are bounded by the client's timeouts.
- The next mirror (tasks, connectors) takes the reader instead of hand-rolling it.
