/**
 * `lanes` — the view model of The Lanes, in three parts and one door.
 *
 * Client-safe: types and pure functions only, no `lib/db` import. The server
 * builds one `LnSheet` per request in `lib/lanes/` and hands it down as plain
 * props, so a level change is a transform and never a fetch.
 *
 * The one thing this direction borrows is `heatOf`, the map from the books to
 * five states. That is deliberate: what it fixes is the JUDGEMENT about which
 * invoices are the trouble, and a direction that re-derived it would be arguing
 * about facts instead of about form.
 *
 * This file is the door. Everything importing `./model` keeps working, and the
 * three parts behind it can each be read in one sitting:
 *
 *   sheet    what the server hands down, and the geometry that is part of it
 *   books    the ledger the tool layer answers from, beside the picture
 *   packing  how many sub-rows a lane needs, decided once for both levels
 *   filters  what the swarm is lit by, and how a lane finds its own marks
 */
export * from "./model/sheet";
export * from "./model/books";
export * from "./model/packing";
export * from "./model/filters";
