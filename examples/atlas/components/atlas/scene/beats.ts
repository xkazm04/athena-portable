/**
 * THE TURN'S CLOCK, IN BEATS. Rule 4 ("one clock per level change, in one module") applied to a
 * clock that is not a level change.
 *
 * A turn is eleven stops and ten legs and it has to be scrubbable, so it cannot be a stack of
 * transitions — it needs one monotonic parameter a slider can hold. That parameter is the BEAT:
 * a dimensionless tick whose length in milliseconds is `--at-dur-beat`, read out of the cascade
 * by `components/atlas/motion.ts` like every other duration in this app. Nothing here is a
 * millisecond, and the transport never types one either: it multiplies beats by the token.
 *
 * WHY BEATS AND NOT SECONDS. Three reasons, in the order they mattered.
 *
 *   1. The design law bans a raw `ms` outside `tokens.css` (`design/check-tokens.mjs`), and a
 *      turn script full of `1400` would be the law's largest violation in the app.
 *   2. Reduced motion has to land the turn "as a sequence of stills" (the round-3 brief). With a
 *      beat clock that is one branch: the beat length goes to zero and the transport steps stop
 *      to stop instead of interpolating. Nothing else in the script changes.
 *   3. The owner has to be able to slow the whole turn down to read it. One token does that for
 *      every leg, every dwell and every renderer at once.
 *
 * THE SHAPE OF A STOP. Every stop is `travel` beats of light moving along a pipe, then `dwell`
 * beats of the block lit and its one label up. The gate's stop has a long dwell on purpose: it
 * is the only place in a turn where nothing happens until a human answers, and a turn animation
 * that glides through the gate at the same speed as the rest is drawing the wrong machine.
 */

/** The beats a leg of the turn takes, unless the stop asks for its own. */
export const TRAVEL = 2.2;

/** The beats a stop is lit for, unless the stop asks for its own. */
export const DWELL = 1.6;

/** The gate's wait. Long, and it is the point (README §3.3: "executes only after a decision"). */
export const WAIT = 5;

/** The first stop has no leg to arrive along; the light is simply there. */
export const ARRIVE = 0.6;

/** The token whose value is what one beat costs. The only place a beat becomes a duration. */
export const BEAT_TOKEN = "--at-dur-beat";
