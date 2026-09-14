/**
 * THE ARRIVAL'S NUMBERS, in one place.
 *
 * The L0 -> L1 move used to be written down three times: `LAND`/`SPREAD`/`DRESS`
 * in `useArrival.ts` (when a beat starts), the `--bk-beat-*` tokens in
 * `style/base/tokens.css` (how long its transitions take), and `ARRIVAL_MS` in
 * `tools/BlocksTools.tsx` (what an agent is told the move costs). Three copies of
 * one decision is three chances to change two of them.
 *
 * This module is the decision. The clock imports it, the advertised cost is
 * derived from it, and `test/beats.test.ts` reads `style/base/tokens.css` and
 * fails if a token has drifted from the value here — CSS cannot import a module,
 * so the agreement is asserted rather than shared.
 *
 * THE BUDGET, and why it moved. The move used to run four beats over about three
 * seconds and it could not be interrupted: every zone key was disabled for the
 * duration and Escape at L0 did nothing, so a reader who changed their mind a
 * tenth of a second in still arrived at L1 three seconds later. The beats are now
 * OVERLAPPED rather than shortened past recognition — `spread` starts as soon as
 * the cells have been measured onto the canvas, and `dress` starts as the first
 * cells reach their places rather than after the last one has — which keeps the
 * order the move is legible by (dots arrive, dots travel, blocks acquire names)
 * inside about 1.2 seconds. `DESIGN.md` §8 records the change.
 *
 * Every number is milliseconds.
 */

/* -------------------------------------------------- the clock: when a beat starts */

/**
 * How long the cube's records take to leave the lattice and form the plate.
 *
 * The scene runs this off a duration rather than a per-frame lerp (see
 * `cube/motion.ts`), so the DOM can count on it. It is the first third of the
 * budget and the only part of the move that happens before the level changes.
 */
export const FLATTEN = 420;

/**
 * `land` — the room the cells need to be measured onto the canvas's clusters and
 * painted there once before anything moves. It is invisible by design: two frames
 * is enough for the hand-off, and any longer is a pause in the middle of a move.
 */
export const LAND = 60;

/**
 * `spread` — how long the travel is given before the dressing starts on top of
 * it. Deliberately shorter than `SPREAD_TRANSITION`: `dress` begins as the FIRST
 * cells land rather than after the last one, so the two beats overlap by their
 * stagger instead of queueing.
 */
export const SPREAD = 280;

/**
 * `dress` — long enough for the last cell in the wave to finish its last part.
 * The stylesheet owns the offsets; this only has to outlast them, which
 * `test/beats.test.ts` checks rather than trusting.
 */
export const DRESS = 440;

/* ------------------------------------------- the stylesheet: how long a move takes */

/** `--bk-beat-spread`: one cell's travel from the plate to its place. */
export const SPREAD_TRANSITION = 360;
/** `--bk-beat-dress`: a cell's ground and its rule arriving. */
export const DRESS_TRANSITION = 240;
/** `--bk-beat-dress-text`: lettering is quicker than ground — a word that takes
 *  as long as a rule to appear reads as a fade rather than as writing. */
export const DRESS_TEXT_TRANSITION = 170;
/** `--bk-stagger`: one cell behind its neighbour, on the dressing beat. */
export const STAGGER = 12;
/** `--bk-stagger-tight`: the travel's own stagger, tighter, so twelve blocks
 *  read as a shoal rather than as a queue. */
export const STAGGER_TIGHT = 10;
/** `--bk-dress-name`: how far behind its own cell's ground the lettering is. */
export const DRESS_NAME = 70;
/** `--bk-dress-figures`: and the figures behind that. */
export const DRESS_FIGURES = 130;

/**
 * How many cells the longest zone holds. The stagger is multiplied by a cell's
 * index, so this is what decides whether the LAST cell still finishes inside its
 * beat — which is the only fit that can fail, and the one `test/beats.test.ts`
 * checks. Twelve is the largest zone in the seeded sheet (A, B and C; D holds
 * ten), so it is the worst case the budget has to survive.
 */
export const WIDEST_ZONE = 12;

/* ----------------------------------------------------------------- the total cost */

/** The three beats, once the cube has handed over. */
export const BEATS = LAND + SPREAD + DRESS;

/**
 * A pad on the advertised cost, and the reason there is one.
 *
 * The cube's flatten is a duration but the frame it starts on is not, so a caller
 * told the exact sum can still read a level that is one frame from settled.
 */
export const SETTLE_PAD = 60;

/**
 * What the whole L0 -> L1 move costs, start to settled.
 *
 * `tools/BlocksTools.tsx` reports this to an agent through `open_group`, so a
 * caller waits rather than reading a level that is still assembling. It is
 * derived, never typed.
 */
export const ARRIVAL_MS = FLATTEN + BEATS + SETTLE_PAD;
