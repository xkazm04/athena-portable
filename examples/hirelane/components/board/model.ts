/**
 * `board` — the view model of The Board, in five parts and one door.
 *
 * Client-safe: types and pure helpers only, no `lib/db` import. The server
 * builds one `BdBoard` per request in `lib/board/index.ts`.
 *
 * WHAT IT BORROWS. The stage vocabulary and the five-step ladder are the
 * sibling hiring product's, because a pipeline that invents its own stage names
 * is comparing a metaphor against nothing.
 *
 * WHAT IT REFUSES TO BORROW. Any number. Every figure on this surface is
 * computed from the seeded rubric in this repo's own database. An unscored
 * applicant stays unscored — never a zero, never an estimate — and sorts after
 * everyone who has a real score, because an absent measurement must not be
 * allowed to tie with, or beat, a genuine low one.
 *
 * This file is the door. Everything importing `./model` keeps working, and the
 * five parts behind it can each be read in one sitting:
 *
 *   stages      what a stage IS, beyond its name
 *   fit         the two floors, and the bands either side of them
 *   candidates  a person, a criterion, a score, and the stage-specific facts
 *   groups      the (stage, role) pair the board opens, encoded and decoded
 *   order       finding one, and the order they compare in
 */
export * from "./model/stages";
export * from "./model/fit";
export * from "./model/candidates";
export * from "./model/groups";
export * from "./model/order";
