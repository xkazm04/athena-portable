/**
 * THE ARRIVAL'S NUMBERS, in one place.
 *
 * The L0 -> L1 move is written down twice and has to agree: here, where the
 * clock reads it and the cost `open_group` advertises is derived from it, and in
 * `style/base/tokens.css`, where the transitions read it. CSS cannot import a
 * module, so `test/beats.test.ts` parses the token file and fails on any drift.
 *
 * ROUND 3 CUT THE MOVE IN HALF, and the reason is the concept rather than the
 * budget. Rounds 1 and 2 had two pictures: a WebGL L0 and a DOM L1, with a
 * hand-off between them, and the hand-off needed beats of its own — `flatten`
 * (the dots leaving their cells for a published plane), `land` (the DOM cells
 * measured onto that plane before anything moved) and `spread` (the cells
 * travelling from it to their grid). All three existed to make a CUT look like a
 * move. There is one picture now: opening a database is the camera flying into
 * that database's octant, where its tables are already standing, so there is
 * nothing to flatten, nothing to measure and nothing to spread. What is left is
 * the two beats the move always actually had:
 *
 *   flight   the camera travels. The slabs inside the target octant come up and
 *            the other eight recede, in the world, while it does.
 *   dress    the tables acquire the parts they only have at this depth — name,
 *            ident, figures — as DOM projected onto their slabs.
 *
 * Which is rule 3, box then ink, drawn in two technologies: the box is a solid
 * in the scene and the ink is type on the page, and the ink cannot start until
 * the camera has stopped, because type that travels with a perspective divide is
 * type nobody can read.
 *
 * Every number is milliseconds.
 */

/* -------------------------------------------------- the clock: when a beat starts */

/**
 * `flight` — how long the camera takes to fly from the whole cube into one
 * octant, and back out.
 *
 * LONGER THAN A DOM LEVEL CHANGE'S 400 ms BUDGET, on purpose and within the
 * formula's own guardrail: "a canvas arrival may stage longer but must be
 * abortable". A camera crossing eight world units while turning to face a corner
 * is a move with a direction, and at 400 ms it reads as a jump cut with motion
 * blur. At 620 the reader can follow which of the nine they went into, which is
 * the whole claim the level makes. It is abortable on every frame — Escape mid
 * flight is `nav.abort()` and flies straight back.
 */
export const FLIGHT = 620;

/**
 * `dress` — long enough for the last table in the wave to finish its last part.
 * The stylesheet owns the offsets; this only has to outlast them, which
 * `test/beats.test.ts` checks rather than trusting.
 */
export const DRESS = 440;

/* ------------------------------------------- the stylesheet: how long a move takes */

/** `--bk-beat-dress`: a cell's rule and its ground arriving. */
export const DRESS_TRANSITION = 240;
/** `--bk-beat-dress-text`: lettering is quicker than ground — a word that takes
 *  as long as a rule to appear reads as a fade rather than as writing. */
export const DRESS_TEXT_TRANSITION = 170;
/** `--bk-stagger`: one cell behind its neighbour, on the dressing beat. */
export const STAGGER = 12;
/** `--bk-dress-name`: how far behind its own cell's ground the lettering is. */
export const DRESS_NAME = 70;
/** `--bk-dress-figures`: and the figures behind that. */
export const DRESS_FIGURES = 130;

/**
 * How many cells the widest database holds. The stagger is multiplied by a
 * cell's index, so this is what decides whether the LAST cell still finishes
 * inside its beat — which is the only fit that can fail, and the one
 * `test/beats.test.ts` checks.
 *
 * SEVEN is the ceiling of the four-to-seven band `model/databases.ts` commits
 * to rather than the six the current seed happens to produce, so a merge that
 * empties a domain and shifts the deal cannot quietly overrun the beat.
 */
export const WIDEST_DATABASE = 7;

/* ----------------------------------------------------------------- the total cost */

/**
 * A pad on the advertised cost, and the reason there is one.
 *
 * The flight is a duration but the frame it starts on is not, so a caller told
 * the exact sum can still read a level that is one frame from settled.
 */
export const SETTLE_PAD = 60;

/**
 * What the whole L0 -> L1 move costs, start to settled.
 *
 * `tools/BlocksTools.tsx` reports this to an agent through `open_group`, so a
 * caller waits rather than reading a level that is still assembling. It is
 * derived, never typed.
 */
export const ARRIVAL_MS = FLIGHT + DRESS + SETTLE_PAD;
