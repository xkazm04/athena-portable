# 0179. A studio left mid-interview is parked, not closed

Date: 2026-10-25

Amends the desktop half of [0097](0097-adopting-a-playbook-is-a-conversation-held-outside-the-turn-lock.md)
("leaving closes the session"); its three-place cap and two-hour idle TTL stand. README section 3.5.

## Context

The Chores stage mounts a fresh view at every move, so the Adopt studio unmounted at every detour,
and its session hook DELETEd the session on unmount. A five-round interview, the research lanes and
a rehearsal were thrown away when the person glanced at the chore page, pressed Escape, or followed
the studio's own advice ("Set up a listener in Mind → Voice first"), and coming back paid the
interview and its model calls again.

The daemon already lets a session outlive its view: it keeps one up to two hours idle and resends
every event after a `seq` (ADR 0097). But its event log carries only her side; the person's answers
and composer lines are local reducer acts. A resume that replays from 0 would draw her questions
with no answers under them. Separately, any `events()` failure was retried five times and then
offered a Retry that followed the same sid, so a session the daemon had reaped or lost in a restart
(404 `unknown_ref`) ended in a Retry that could never succeed.

## Decision

1. **Park on unmount when the person said something.** An answered card, a composer line or a sent
   document makes the conversation worth keeping; the hook then leaves the session open on the
   daemon and keeps its id, the last `seq` drawn, the reducer's snapshot, the front-door intro and
   its local key counter in a module store (`adopt/park.ts`), keyed by playbook and case. Nothing
   said, a closed conversation, or a hand-off ("Start for real") closes it as before, and a session
   whose start was still in flight is still closed the moment its id arrives.
2. **Coming back is an offer, not a teleport.** A studio mounting with a parked entry for its key
   starts nothing; it says how far the conversation got (answers given, draft rev) with Continue
   (reducer seeded from the snapshot, follow from the last `seq`) and Start over (close it, start
   fresh).
3. **One parked conversation at most.** A studio for another chore closes the parked one before it
   starts, so the desktop never holds more of the daemon's three places than it did before.
4. **A local limit under the TTL.** An entry parked longer than 90 minutes is closed on return with
   no offer, so the studio never offers a session the daemon has reaped.
5. **A sid the daemon no longer knows is not retried.** A 404 `unknown_ref` from the event stream
   stops the reconnect loop: after Continue it starts a fresh session with the parked intro and
   says the earlier conversation had ended; otherwise the conversation is shown as ended.

## Consequences

- An ordinary detour no longer costs the conversation. A parked session holds one daemon place
  until it is continued, started over, displaced by another chore's studio, or reaped.
- The store is memory only: quitting the app forgets the offer, and the daemon reaps the session
  on its TTL. No user data is written anywhere new.
- Reverting restores close-on-unmount; a session left parked by a reverted build expires on the
  daemon's TTL.
